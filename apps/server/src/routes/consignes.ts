import { Router } from "express";
import { athleteWriteRateLimit } from "../lib/rateLimit.js";
import { prisma } from "../lib/prisma.js";
import { requireAuth, type AuthedRequest } from "../middleware/auth.js";
import { ah, HttpError } from "../lib/http.js";
import { consignesActives } from "../lib/consignesCoach.js";

/**
 * Ce que le coach a retenu des demandes de l'athlète. Il doit pouvoir le
 * relire et l'effacer : une consigne mal comprise appliquée chaque semaine,
 * sans moyen de la voir, serait pire que pas de mémoire du tout.
 */
export const consignesRouter = Router();
consignesRouter.use(requireAuth);

consignesRouter.get(
  "/",
  ah(async (req: AuthedRequest, res) => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.userId! }, select: { timezone: true } });
    const consignes = await consignesActives(req.userId!, user.timezone);
    res.json({
      consignes: consignes.map((c) => ({ id: c.id, texte: c.texte, jusquAu: c.jusquAu?.toISOString().slice(0, 10) ?? null })),
    });
  })
);

consignesRouter.delete(
  "/:id",
  athleteWriteRateLimit,
  ah(async (req: AuthedRequest, res) => {
    const { count } = await prisma.consigneCoach.deleteMany({ where: { id: req.params.id, userId: req.userId! } });
    if (!count) throw new HttpError(404, "Consigne introuvable.");
    res.status(204).end();
  })
);
