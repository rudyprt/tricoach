import { Router } from "express";
import { athleteWriteRateLimit, byUser, rateLimit } from "../lib/rateLimit.js";
import { askClaude, isAiConfigured, AiNotConfiguredError } from "../lib/anthropic.js";
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

function serialize(course: {
  id: string;
  nom: string;
  date: Date;
  format: string;
  priorite: string;
  lieu: string;
  objectifTemps: string;
}) {
  return {
    ...course,
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
      const response = await askClaude({ system, messages: [{ role: "user", content: userPrompt }], maxTokens: 4000 });
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
