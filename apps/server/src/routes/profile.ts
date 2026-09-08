import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth, type AuthedRequest } from "../middleware/auth.js";
import { ah, HttpError } from "../lib/http.js";
import { computeTrainingZones, periodization } from "../lib/training.js";
import { startOfWeek } from "../lib/week.js";

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
    const { objectifDate, ftpWatts, ...rest } = parsed.data;
    const data = { ...rest, ftpWatts: ftpWatts ?? null, objectifDate: new Date(`${objectifDate}T00:00:00.000Z`) };

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

    const zones = computeTrainingZones({
      tempsCourse: profile.tempsCourse,
      tempsNatation: profile.tempsNatation,
      tempsVelo: profile.tempsVelo,
      ftpWatts: profile.ftpWatts,
    });
    const phase = periodization(startOfWeek(new Date(), user?.timezone ?? undefined), profile.objectifDate);

    res.json({
      zones,
      periodization: { phase: phase.phase, label: phase.label, weeksToGoal: phase.weeksToGoal },
    });
  })
);
