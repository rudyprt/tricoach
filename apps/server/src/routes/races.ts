import { Router } from "express";
import { athleteWriteRateLimit, byUser, rateLimit } from "../lib/rateLimit.js";
import { askClaude, isAiConfigured, AiNotConfiguredError } from "../lib/anthropic.js";
import { MAX_TOKENS, MODELE_PLAN_COURSE } from "../lib/modeles.js";
import {
  CONSIGNES_ANALYSE,
  buildAnalyseUserPrompt,
  chiffresCourse,
  parseAnalyse,
  parseAnalyseResponse,
  parseResultat,
  resultatSchema,
} from "../lib/analyseCourse.js";
import { isPremium } from "../lib/subscription.js";
import { localCalendarDate } from "../lib/week.js";
import { describeActivity } from "../lib/activityMatching.js";
import { fcCourseTexte } from "../lib/fcCourses.js";
import { resumeAthlete } from "../lib/resumeAthlete.js";
import { recordAiCall } from "../lib/aiUsage.js";
import { computeTrainingZones } from "../lib/training.js";
import { buildZoneInputs } from "../lib/zoneInputs.js";
import {
  buildRacePlanSystemPrompt,
  buildRacePlanUserPrompt,
  parseRacePlan,
  parseRacePlanResponse,
} from "../lib/racePlan.js";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth, type AuthedRequest } from "../middleware/auth.js";
import { ah, HttpError } from "../lib/http.js";
import {
  FORMATS,
  LIBELLES_FORMAT,
  LIBELLES_PRIORITE,
  PRIORITES,
  synchroniserObjectif,
  type FormatCourse,
  type PrioriteCourse,
} from "../lib/races.js";

export const racesRouter = Router();
racesRouter.use(requireAuth);
racesRouter.use(athleteWriteRateLimit);

const courseSchema = z.object({
  nom: z.string().trim().min(1, "Donnez un nom à votre course.").max(120, "Nom trop long."),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date attendue au format AAAA-MM-JJ."),
  format: z.enum(FORMATS).default("autre"),
  priorite: z.enum(PRIORITES).default("A"),
  lieu: z.string().trim().max(120, "Lieu trop long.").default(""),
  objectifTemps: z.string().trim().max(40, "Temps visé trop long.").default(""),
});

function serialize({
  resultat: _resultat,
  analyse,
  ...course
}: {
  id: string;
  nom: string;
  date: Date;
  format: string;
  priorite: string;
  lieu: string;
  objectifTemps: string;
  resultat?: unknown;
  analyse?: unknown;
}) {
  return {
    ...course,
    // Le détail se lit sur sa propre route : la liste dit seulement s'il existe.
    analysee: Boolean(analyse),
    date: course.date.toISOString().slice(0, 10),
    formatLabel: LIBELLES_FORMAT[course.format as FormatCourse] ?? course.format,
    prioriteLabel: LIBELLES_PRIORITE[course.priorite as PrioriteCourse] ?? course.priorite,
  };
}

/** Une limite évite qu'un athlète inscrive une saison entière de cinquante dossards. */
const MAX_COURSES = 30;

racesRouter.get(
  "/",
  ah(async (req: AuthedRequest, res) => {
    const courses = await prisma.race.findMany({
      where: { userId: req.userId! },
      orderBy: { date: "asc" },
      take: MAX_COURSES + 10,
    });
    res.json({ courses: courses.map(serialize) });
  })
);

racesRouter.post(
  "/",
  ah(async (req: AuthedRequest, res) => {
    const userId = req.userId!;
    const parsed = courseSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message ?? "Course invalide.");

    if ((await prisma.race.count({ where: { userId } })) >= MAX_COURSES) {
      throw new HttpError(400, `Votre calendrier est limité à ${MAX_COURSES} courses.`);
    }

    const date = new Date(`${parsed.data.date}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime())) throw new HttpError(400, "Date invalide.");

    const course = await prisma.race.create({ data: { ...parsed.data, date, userId } });
    await synchroniserObjectif(userId);

    res.status(201).json(serialize(course));
  })
);

racesRouter.patch(
  "/:id",
  ah(async (req: AuthedRequest, res) => {
    const userId = req.userId!;
    const parsed = courseSchema.partial().safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message ?? "Course invalide.");

    // updateMany plutôt que update : la clause sur userId empêche de modifier
    // la course d'un autre athlète, ce qu'un update par identifiant seul
    // n'interdirait pas.
    const { date, ...reste } = parsed.data;
    const maj = await prisma.race.updateMany({
      where: { id: req.params.id, userId },
      data: { ...reste, ...(date ? { date: new Date(`${date}T00:00:00.000Z`) } : {}) },
    });
    if (maj.count === 0) throw new HttpError(404, "Course introuvable.");

    await synchroniserObjectif(userId);
    const course = await prisma.race.findUniqueOrThrow({ where: { id: req.params.id } });
    res.json(serialize(course));
  })
);

racesRouter.delete(
  "/:id",
  ah(async (req: AuthedRequest, res) => {
    const userId = req.userId!;
    const suppression = await prisma.race.deleteMany({ where: { id: req.params.id, userId } });
    if (suppression.count === 0) throw new HttpError(404, "Course introuvable.");

    await synchroniserObjectif(userId);
    res.json({ ok: true });
  })
);

/**
 * Plan de course : allures, nutrition, hydratation, transitions.
 *
 * Généré à la demande puis conservé : c'est un document que l'athlète relit la
 * veille, pas une réponse jetable. Le régénérer est possible, mais l'appel au
 * modèle coûte, d'où la limitation dédiée.
 */
const planCourseRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: "Trop de plans de course générés en une heure. Réessayez plus tard.",
  keyFor: byUser,
});

racesRouter.post(
  "/:id/plan",
  planCourseRateLimit,
  ah(async (req: AuthedRequest, res) => {
    const userId = req.userId!;
    if (!isAiConfigured()) throw new HttpError(503, new AiNotConfiguredError().message);

    const course = await prisma.race.findFirst({ where: { id: req.params.id, userId } });
    if (!course) throw new HttpError(404, "Course introuvable.");

    const profile = await prisma.athleteProfile.findUnique({ where: { userId } });
    const zones = profile ? computeTrainingZones(await buildZoneInputs(userId, profile)) : null;

    // « Première fois sur la distance » change tout le conseil : on le déduit
    // des courses passées plutôt que de le demander à l'athlète.
    const dejaCourue = await prisma.race.count({
      where: { userId, format: course.format, date: { lt: new Date() }, id: { not: course.id } },
    });

    const system = buildRacePlanSystemPrompt();
    const userPrompt = buildRacePlanUserPrompt({
      nom: course.nom,
      date: course.date,
      format: course.format,
      lieu: course.lieu,
      objectifTemps: course.objectifTemps,
      priorite: course.priorite,
      zones,
      contraintes: profile?.contraintes ?? "",
      premiereFois: dejaCourue === 0,
    });

    let plan;
    try {
      const response = await askClaude({
        modele: MODELE_PLAN_COURSE,
        etiquette: "plan_course",
        system,
        messages: [{ role: "user", content: userPrompt }],
        maxTokens: MAX_TOKENS.planCourse,
      });
      // L'appel est enregistré avant la validation : une réponse mal formée a
      // été facturée quand même, et le coût affiché doit rester fidèle.
      try {
        plan = parseRacePlanResponse(response.text);
        await recordAiCall({ userId, kind: "plan_course", response, succeeded: true });
      } catch (erreur) {
        await recordAiCall({ userId, kind: "plan_course", response, succeeded: false });
        throw erreur;
      }
    } catch (erreur) {
      console.error("Plan de course impossible :", erreur);
      throw new HttpError(502, "Le coach n'a pas pu produire votre plan de course. Réessayez dans un instant.");
    }

    await prisma.race.update({
      where: { id: course.id },
      data: { planCourse: plan, planGenereLe: new Date() },
    });

    res.json({ plan, genereLe: new Date().toISOString() });
  })
);

racesRouter.get(
  "/:id/plan",
  ah(async (req: AuthedRequest, res) => {
    const course = await prisma.race.findFirst({
      where: { id: req.params.id, userId: req.userId! },
      select: { planCourse: true, planGenereLe: true },
    });
    if (!course) throw new HttpError(404, "Course introuvable.");

    res.json({
      plan: parseRacePlan(course.planCourse),
      genereLe: course.planGenereLe?.toISOString() ?? null,
    });
  })
);

/* ------------------------------------------------------------------ */
/* Analyse d'une course disputée (offre Premium)                       */
/* ------------------------------------------------------------------ */

const analyseRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: "Trop d'analyses demandées en une heure. Réessayez plus tard.",
  keyFor: byUser,
});

racesRouter.get(
  "/:id/analyse",
  ah(async (req: AuthedRequest, res) => {
    const course = await prisma.race.findFirst({
      where: { id: req.params.id, userId: req.userId! },
      select: { format: true, objectifTemps: true, resultat: true, analyse: true, analyseLe: true },
    });
    if (!course) throw new HttpError(404, "Course introuvable.");

    const resultat = parseResultat(course.resultat);
    res.json({
      resultat,
      chiffres: resultat ? chiffresCourse(resultat, course.format, course.objectifTemps) : null,
      analyse: parseAnalyse(course.analyse),
      genereLe: course.analyseLe?.toISOString() ?? null,
    });
  })
);

racesRouter.post(
  "/:id/analyse",
  analyseRateLimit,
  ah(async (req: AuthedRequest, res) => {
    const userId = req.userId!;
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { plan: true, timezone: true } });
    if (!user || !isPremium(user)) {
      throw new HttpError(403, "L'analyse de course est réservée à l'offre Premium.", "PREMIUM_REQUIRED");
    }
    if (!isAiConfigured()) throw new HttpError(503, new AiNotConfiguredError().message);

    const course = await prisma.race.findFirst({ where: { id: req.params.id, userId } });
    if (!course) throw new HttpError(404, "Course introuvable.");
    if (course.date.toISOString().slice(0, 10) > localCalendarDate(new Date(), user.timezone)) {
      throw new HttpError(400, "Cette course n'a pas encore eu lieu : son analyse se fera une fois la ligne franchie.");
    }

    const parsed = resultatSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message ?? "Résultat invalide.");
    const resultat = parsed.data;

    // Le résultat est conservé même si l'analyse échoue : l'athlète ne le
    // ressaisira pas pour réessayer.
    await prisma.race.update({ where: { id: course.id }, data: { resultat } });

    const profile = await prisma.athleteProfile.findUnique({ where: { userId } });
    const zones = profile ? computeTrainingZones(await buildZoneInputs(userId, profile)) : null;
    const lendemain = new Date(course.date.getTime() + 24 * 3600 * 1000);
    const [activites, preparation] = await Promise.all([
      prisma.activity.findMany({
        where: { userId, startedAt: { gte: course.date, lt: lendemain } },
        orderBy: { startedAt: "asc" },
        take: 6,
      }),
      resumeAthlete(userId, {
        avecProfil: false,
        refs: { ftpWatts: profile?.ftpWatts ?? null, fcSeuil: profile?.fcSeuil ?? null, fcMax: profile?.fcMax ?? null },
        maintenant: course.date,
      }),
    ]);

    const chiffres = chiffresCourse(resultat, course.format, course.objectifTemps);
    const userPrompt = buildAnalyseUserPrompt({
      nom: course.nom,
      date: course.date,
      format: course.format,
      priorite: course.priorite,
      objectifTemps: course.objectifTemps,
      resultat,
      chiffres,
      zones,
      chronos: profile
        ? [
            profile.tempsNatation && `natation ${profile.tempsNatation}${fcCourseTexte(profile.fcMoyNatation, profile.fcMaxNatation)}`,
            profile.tempsVelo && `vélo ${profile.tempsVelo}${fcCourseTexte(profile.fcMoyVelo, profile.fcMaxVelo)}`,
            profile.tempsCourse && `course ${profile.tempsCourse}${fcCourseTexte(profile.fcMoyCourse, profile.fcMaxCourse)}`,
          ].filter((x): x is string => Boolean(x))
        : [],
      plan: parseRacePlan(course.planCourse),
      activitesDuJour: activites.map(describeActivity),
      preparation,
    });

    let analyse;
    try {
      const response = await askClaude({
        modele: MODELE_PLAN_COURSE,
        etiquette: "analyse_course",
        system: CONSIGNES_ANALYSE,
        messages: [{ role: "user", content: userPrompt }],
        maxTokens: MAX_TOKENS.analyseCourse,
      });
      try {
        analyse = parseAnalyseResponse(response.text);
        await recordAiCall({ userId, kind: "analyse_course", response, succeeded: true });
      } catch (erreur) {
        await recordAiCall({ userId, kind: "analyse_course", response, succeeded: false });
        throw erreur;
      }
    } catch (erreur) {
      console.error("Analyse de course impossible :", erreur);
      throw new HttpError(502, "Le coach n'a pas pu analyser votre course. Réessayez dans un instant.");
    }

    const genereLe = new Date();
    await prisma.race.update({ where: { id: course.id }, data: { analyse, analyseLe: genereLe } });
    res.json({ resultat, chiffres, analyse, genereLe: genereLe.toISOString() });
  })
);
