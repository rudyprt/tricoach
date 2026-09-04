import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth, type AuthedRequest } from "../middleware/auth.js";

export const profileRouter = Router();
profileRouter.use(requireAuth);

const profileSchema = z.object({
  objectif: z.string().min(1, "Indiquez votre objectif."),
  objectifDate: z.string().min(1, "Indiquez une date."),
  tempsNatation: z.string().optional().default(""),
  tempsVelo: z.string().optional().default(""),
  tempsCourse: z.string().optional().default(""),
  heuresSemaine: z.number().positive("Indiquez un nombre d'heures positif."),
  contraintes: z.string().optional().default(""),
});

profileRouter.get("/", async (req: AuthedRequest, res) => {
  const profile = await prisma.athleteProfile.findUnique({ where: { userId: req.userId! } });
  res.json(profile);
});

profileRouter.put("/", async (req: AuthedRequest, res) => {
  const parsed = profileSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Données invalides." });
    return;
  }
  const data = parsed.data;
  const profile = await prisma.athleteProfile.upsert({
    where: { userId: req.userId! },
    create: { ...data, objectifDate: new Date(data.objectifDate), userId: req.userId! },
    update: { ...data, objectifDate: new Date(data.objectifDate) },
  });
  res.json(profile);
});
