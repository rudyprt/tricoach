import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth, type AuthedRequest } from "../middleware/auth.js";
import { serializeSession } from "../lib/session.js";

export const sessionsRouter = Router();
sessionsRouter.use(requireAuth);

sessionsRouter.get("/", async (req: AuthedRequest, res) => {
  const sessions = await prisma.session.findMany({
    where: { userId: req.userId! },
    orderBy: { date: "asc" },
  });
  res.json(sessions.map(serializeSession));
});

const completeSchema = z.object({
  status: z.enum(["planifiee", "faite", "manquee"]),
  ressenti: z.string().optional(),
});

sessionsRouter.patch("/:id", async (req: AuthedRequest, res) => {
  const parsed = completeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Données invalides." });
    return;
  }

  const session = await prisma.session.findUnique({ where: { id: req.params.id } });
  if (!session || session.userId !== req.userId) {
    res.status(404).json({ error: "Séance introuvable." });
    return;
  }

  const updated = await prisma.session.update({
    where: { id: req.params.id },
    data: {
      status: parsed.data.status,
      ressenti: parsed.data.ressenti,
      completedAt: parsed.data.status === "faite" ? new Date() : null,
    },
  });
  res.json(serializeSession(updated));
});

const swapSchema = z.object({
  sessionIdA: z.string().min(1),
  sessionIdB: z.string().min(1),
});

sessionsRouter.post("/swap", async (req: AuthedRequest, res) => {
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

  const [a, b] = await Promise.all([
    prisma.session.findUnique({ where: { id: sessionIdA } }),
    prisma.session.findUnique({ where: { id: sessionIdB } }),
  ]);

  if (!a || !b || a.userId !== req.userId || b.userId !== req.userId) {
    res.status(404).json({ error: "Séance introuvable." });
    return;
  }

  const [updatedA, updatedB] = await prisma.$transaction([
    prisma.session.update({ where: { id: a.id }, data: { date: b.date } }),
    prisma.session.update({ where: { id: b.id }, data: { date: a.date } }),
  ]);

  res.json([serializeSession(updatedA), serializeSession(updatedB)]);
});
