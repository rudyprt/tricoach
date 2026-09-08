import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth, type AuthedRequest } from "../middleware/auth.js";
import { serializeSession } from "../lib/session.js";
import { ah, HttpError } from "../lib/http.js";

export const sessionsRouter = Router();
sessionsRouter.use(requireAuth);

sessionsRouter.get(
  "/",
  ah(async (req: AuthedRequest, res) => {
    const sessions = await prisma.session.findMany({
      where: { userId: req.userId! },
      orderBy: { date: "asc" },
    });
    res.json(sessions.map(serializeSession));
  })
);

const completeSchema = z.object({
  status: z.enum(["planifiee", "faite", "manquee"]),
  ressenti: z.string().max(1000, "Ressenti trop long (1000 caractères maximum).").optional(),
});

sessionsRouter.patch(
  "/:id",
  ah(async (req: AuthedRequest, res) => {
    const parsed = completeSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Données invalides." });
      return;
    }

    // La mise à jour porte sur l'identifiant ET le propriétaire : impossible de
    // modifier la séance d'un autre athlète, même en cas de course entre requêtes.
    const { count } = await prisma.session.updateMany({
      where: { id: req.params.id, userId: req.userId! },
      data: {
        status: parsed.data.status,
        ressenti: parsed.data.ressenti,
        completedAt: parsed.data.status === "faite" ? new Date() : null,
      },
    });
    if (count === 0) {
      throw new HttpError(404, "Séance introuvable.");
    }

    const updated = await prisma.session.findUniqueOrThrow({ where: { id: req.params.id } });
    res.json(serializeSession(updated));
  })
);

const swapSchema = z.object({
  sessionIdA: z.string().min(1),
  sessionIdB: z.string().min(1),
});

sessionsRouter.post(
  "/swap",
  ah(async (req: AuthedRequest, res) => {
    const parsed = swapSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Données invalides." });
      return;
    }
    const { sessionIdA, sessionIdB } = parsed.data;
    if (sessionIdA === sessionIdB) {
      res.status(400).json({ error: "Sélectionnez deux séances différentes." });
      return;
    }

    const owned = await prisma.session.findMany({
      where: { id: { in: [sessionIdA, sessionIdB] }, userId: req.userId! },
    });
    const a = owned.find((s) => s.id === sessionIdA);
    const b = owned.find((s) => s.id === sessionIdB);
    if (!a || !b) {
      throw new HttpError(404, "Séance introuvable.");
    }

    const [updatedA, updatedB] = await prisma.$transaction([
      prisma.session.update({ where: { id: a.id }, data: { date: b.date } }),
      prisma.session.update({ where: { id: b.id }, data: { date: a.date } }),
    ]);

    res.json([serializeSession(updatedA), serializeSession(updatedB)]);
  })
);
