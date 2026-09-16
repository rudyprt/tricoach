import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { requireAuth, type AuthedRequest } from "../middleware/auth.js";
import { ah, HttpError } from "../lib/http.js";
import { computeTrainingZones, periodization } from "../lib/training.js";
import { parseZoneOverrides, zoneOverridesSchema } from "../lib/zoneOverrides.js";
import { buildZoneInputs, suggestFtp } from "../lib/zoneInputs.js";
import { startOfWeek } from "../lib/week.js";
import { disponibilitesSchema, materielSchema } from "../lib/disponibilites.js";

export const profileRouter = Router();
profileRouter.use(requireAuth);

const profileSchema = z.object({
  objectif: z.string().trim().min(1, "Indiquez votre objectif.").max(200),
  objectifDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Date au format AAAA-MM-JJ attendue.")
    .refine((v) => !Number.isNaN(new Date(`${v}T00:00:00.000Z`).getTime()), "Date invalide."),
  tempsNatation: z.string().max(100).optional().default(""),
  tempsVelo: z.string().max(100).optional().default(""),
  tempsCourse: z.string().max(100).optional().default(""),
  heuresSemaine: z.number().positive("Indiquez un nombre d'heures positif.").max(40, "40 heures maximum par semaine."),
  contraintes: z.string().max(1000).optional().default(""),
  ftpWatts: z.number().int().min(50).max(600).nullable().optional(),
  // Bornes larges mais physiologiquement plausibles : elles écartent les fautes
  // de frappe sans contraindre les extrêmes réels.
  seuilCourseSecParKm: z.number().int().min(150, "Allure trop rapide.").max(900, "Allure trop lente.").nullable().optional(),
  cssSecPer100m: z.number().int().min(50, "Allure trop rapide.").max(300, "Allure trop lente.").nullable().optional(),
  fcSeuil: z.number().int().min(100).max(220).nullable().optional(),
  fcMax: z.number().int().min(120).max(230).nullable().optional(),
  disponibilites: disponibilitesSchema,
  materiel: materielSchema,
});

profileRouter.get(
  "/",
  ah(async (req: AuthedRequest, res) => {
    const profile = await prisma.athleteProfile.findUnique({ where: { userId: req.userId! } });
    res.json(profile);
  })
);

profileRouter.put(
  "/",
  ah(async (req: AuthedRequest, res) => {
    const parsed = profileSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Données invalides." });
      return;
    }
    const { objectifDate, ftpWatts, seuilCourseSecParKm, cssSecPer100m, fcSeuil, fcMax, disponibilites, materiel, ...rest } =
      parsed.data;
    const data = {
      ...rest,
      // Prisma distingue « absent » de « null » sur une colonne JSON : sans
      // DbNull, effacer ses créneaux écrirait le littéral JSON null.
      disponibilites: disponibilites ?? Prisma.DbNull,
      materiel: materiel ?? Prisma.DbNull,
      ftpWatts: ftpWatts ?? null,
      seuilCourseSecParKm: seuilCourseSecParKm ?? null,
      cssSecPer100m: cssSecPer100m ?? null,
      fcSeuil: fcSeuil ?? null,
      fcMax: fcMax ?? null,
      objectifDate: new Date(`${objectifDate}T00:00:00.000Z`),
    };

    const profile = await prisma.athleteProfile.upsert({
      where: { userId: req.userId! },
      create: { ...data, userId: req.userId! },
      update: data,
    });
    res.json(profile);
  })
);

/**
 * Les zones sont calculées côté serveur (une seule source de vérité, partagée
 * avec les prompts) et exposées pour que l'athlète voie sur quelles allures son
 * programme est construit.
 */
profileRouter.get(
  "/zones",
  ah(async (req: AuthedRequest, res) => {
    const [profile, user] = await Promise.all([
      prisma.athleteProfile.findUnique({ where: { userId: req.userId! } }),
      prisma.user.findUnique({ where: { id: req.userId! }, select: { timezone: true } }),
    ]);
    if (!profile) {
      throw new HttpError(400, "Complétez d'abord votre profil (onboarding).");
    }

    const inputs = await buildZoneInputs(req.userId!, profile);
    const phase = periodization(startOfWeek(new Date(), user?.timezone ?? undefined), profile.objectifDate);

    res.json({
      zones: computeTrainingZones(inputs),
      // Les zones purement calculées sont renvoyées en plus : l'écran de
      // modification doit pouvoir montrer la valeur d'origine à côté de la
      // valeur corrigée, et proposer d'y revenir.
      computedZones: computeTrainingZones({ ...inputs, overrides: null }),
      overrides: inputs.overrides ?? {},
      // Proposition de FTP tirée des séances importées, jamais appliquée seule.
      ftpSuggere: await suggestFtp(req.userId!),
      periodization: { phase: phase.phase, label: phase.label, weeksToGoal: phase.weeksToGoal },
    });
  })
);

/**
 * Enregistre les corrections manuelles. Une zone laissée vide revient au
 * calcul automatique, ce qui évite d'avoir à tout ressaisir pour annuler une
 * seule valeur.
 */
profileRouter.put(
  "/zones",
  ah(async (req: AuthedRequest, res) => {
    const parsed = zoneOverridesSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Zones invalides." });
      return;
    }

    const profile = await prisma.athleteProfile.findUnique({ where: { userId: req.userId! } });
    if (!profile) {
      throw new HttpError(400, "Complétez d'abord votre profil (onboarding).");
    }

    const overrides = parseZoneOverrides(parsed.data);
    await prisma.athleteProfile.update({
      where: { userId: req.userId! },
      data: { customZones: overrides ?? Prisma.DbNull },
    });

    res.json({
      zones: computeTrainingZones({
        tempsCourse: profile.tempsCourse,
        tempsNatation: profile.tempsNatation,
        tempsVelo: profile.tempsVelo,
        ftpWatts: profile.ftpWatts,
        overrides,
      }),
      overrides: overrides ?? {},
    });
  })
);

/** Revient entièrement au calcul automatique. */
profileRouter.delete(
  "/zones",
  ah(async (req: AuthedRequest, res) => {
    const profile = await prisma.athleteProfile.findUnique({ where: { userId: req.userId! } });
    if (!profile) {
      throw new HttpError(400, "Complétez d'abord votre profil (onboarding).");
    }

    await prisma.athleteProfile.update({
      where: { userId: req.userId! },
      data: { customZones: Prisma.DbNull },
    });

    res.json({
      zones: computeTrainingZones({
        tempsCourse: profile.tempsCourse,
        tempsNatation: profile.tempsNatation,
        tempsVelo: profile.tempsVelo,
        ftpWatts: profile.ftpWatts,
      }),
      overrides: {},
    });
  })
);
