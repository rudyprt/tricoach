import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth, type AuthedRequest } from "../middleware/auth.js";
import { athleteWriteRateLimit } from "../lib/rateLimit.js";
import { ah, HttpError } from "../lib/http.js";
import { isPremium } from "../lib/subscription.js";
import { FORMATS_RAVITO, calculerRavitaillement, tauxSudation } from "../lib/nutrition.js";
import { chargerProfilRavito, journalSchema, objectifDigestif } from "../lib/nutritionDonnees.js";
import { addDays } from "../lib/week.js";
import type { SessionStructure } from "../lib/session.js";

/**
 * Nutrition autour de l'effort (offre Premium) : préférences, tests de
 * sudation, ravitaillement de chaque séance et journal de tolérance.
 */
export const nutritionRouter = Router();
nutritionRouter.use(requireAuth);
nutritionRouter.use(athleteWriteRateLimit);

// Toute la nutrition est réservée à l'offre Premium : le contrôle est ici,
// pas seulement dans l'interface.
nutritionRouter.use(
  ah(async (req: AuthedRequest, _res, next) => {
    const user = await prisma.user.findUnique({ where: { id: req.userId! }, select: { plan: true } });
    if (!user || !isPremium(user)) {
      throw new HttpError(403, "La nutrition est réservée à l'offre Premium.", "PREMIUM_REQUIRED");
    }
    next();
  })
);

const profilSchema = z.object({
  poidsKg: z.number().min(30, "Poids trop faible.").max(200, "Poids trop élevé.").nullable().optional(),
  formats: z.array(z.enum(FORMATS_RAVITO)).max(FORMATS_RAVITO.length).default([]),
  cafeine: z.boolean().default(false),
  sueurSalee: z.boolean().default(false),
});

const testSchema = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date attendue au format AAAA-MM-JJ."),
    sport: z.enum(["course", "velo", "natation"]),
    dureeMin: z.number().int().min(30, "Le test doit durer au moins 30 minutes.").max(600),
    poidsAvantKg: z.number().min(30).max(200),
    poidsApresKg: z.number().min(30).max(200),
    boissonMl: z.number().int().min(0).max(10000).default(0),
    temperatureC: z.number().int().min(-20).max(50).nullable().optional(),
  })
  .refine((t) => t.poidsAvantKg - t.poidsApresKg < 5, "Une perte de plus de 5 kg n'est pas plausible : vérifiez les pesées.")
  .refine((t) => t.poidsApresKg - t.poidsAvantKg < 1, "Le poids d'après ne peut pas dépasser nettement celui d'avant : vérifiez les pesées.");

nutritionRouter.get(
  "/",
  ah(async (req: AuthedRequest, res) => {
    const userId = req.userId!;
    const [profil, tests, ravito] = await Promise.all([
      prisma.profilNutrition.findUnique({ where: { userId } }),
      prisma.testSudation.findMany({ where: { userId }, orderBy: { date: "desc" }, take: 20 }),
      chargerProfilRavito(userId),
    ]);
    res.json({
      profil: {
        poidsKg: profil?.poidsKg ?? null,
        formats: profil?.formats ?? [],
        cafeine: profil?.cafeine ?? false,
        sueurSalee: profil?.sueurSalee ?? false,
      },
      tests: tests.map((t) => ({ ...t, date: t.date.toISOString().slice(0, 10) })),
      sudation: ravito.sudation,
      toleranceGH: ravito.toleranceGH,
      limiteGH: ravito.limiteGH,
    });
  })
);

nutritionRouter.put(
  "/profil",
  ah(async (req: AuthedRequest, res) => {
    const parsed = profilSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message ?? "Profil invalide.");
    const data = { ...parsed.data, poidsKg: parsed.data.poidsKg ?? null };
    const profil = await prisma.profilNutrition.upsert({
      where: { userId: req.userId! },
      create: { ...data, userId: req.userId! },
      update: data,
    });
    res.json(profil);
  })
);

nutritionRouter.post(
  "/tests-sudation",
  ah(async (req: AuthedRequest, res) => {
    const parsed = testSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message ?? "Test invalide.");
    const { date, ...test } = parsed.data;
    const cree = await prisma.testSudation.create({
      data: {
        ...test,
        temperatureC: test.temperatureC ?? null,
        date: new Date(`${date}T00:00:00.000Z`),
        tauxMlH: tauxSudation(test),
        userId: req.userId!,
      },
    });
    res.status(201).json({ ...cree, date });
  })
);

nutritionRouter.delete(
  "/tests-sudation/:id",
  ah(async (req: AuthedRequest, res) => {
    const { count } = await prisma.testSudation.deleteMany({ where: { id: req.params.id, userId: req.userId! } });
    if (count === 0) throw new HttpError(404, "Test introuvable.");
    res.status(204).end();
  })
);

/** Le ravitaillement d'une séance : avant, pendant, après. */
nutritionRouter.get(
  "/seance/:id",
  ah(async (req: AuthedRequest, res) => {
    const userId = req.userId!;
    const seance = await prisma.session.findFirst({ where: { id: req.params.id, userId } });
    if (!seance) throw new HttpError(404, "Séance introuvable.");

    const lendemain = addDays(seance.date, 1);
    const [profil, objectif, suivante] = await Promise.all([
      chargerProfilRavito(userId),
      objectifDigestif(userId, seance.date),
      prisma.session.count({
        where: { userId, date: { gt: seance.date, lte: lendemain }, sport: { not: "repos" } },
      }),
    ]);

    res.json({
      ravitaillement: calculerRavitaillement(
        {
          sport: seance.sport,
          titre: seance.titre,
          dureeMin: seance.dureeMin,
          structure: seance.structure as SessionStructure | null,
        },
        profil,
        { objectifDigestif: objectif, seanceLeLendemain: suivante > 0 }
      ),
      journal: journalSchema.safeParse(seance.nutritionPrise).data ?? null,
    });
  })
);

/** Ce que l'athlète a pris pendant la séance, et comment il l'a toléré. */
nutritionRouter.put(
  "/seance/:id/journal",
  ah(async (req: AuthedRequest, res) => {
    const parsed = journalSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message ?? "Journal invalide.");
    const { count } = await prisma.session.updateMany({
      where: { id: req.params.id, userId: req.userId! },
      data: { nutritionPrise: parsed.data },
    });
    if (count === 0) throw new HttpError(404, "Séance introuvable.");
    res.json({ journal: parsed.data });
  })
);
