import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth, type AuthedRequest } from "../middleware/auth.js";
import { askClaude, isAiConfigured, AiNotConfiguredError } from "../lib/anthropic.js";
import { CHAT_DAILY_LIMIT, isPremium } from "../lib/subscription.js";

export const chatRouter = Router();
chatRouter.use(requireAuth);

chatRouter.get("/", async (req: AuthedRequest, res) => {
  const messages = await prisma.chatMessage.findMany({
    where: { userId: req.userId! },
    orderBy: { createdAt: "asc" },
  });
  res.json(messages);
});

const sendSchema = z.object({
  content: z.string().min(1),
});

chatRouter.post("/", async (req: AuthedRequest, res) => {
  if (!isAiConfigured()) {
    res.status(503).json({ error: new AiNotConfiguredError().message });
    return;
  }

  const parsed = sendSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Message invalide." });
    return;
  }

  const user = await prisma.user.findUnique({ where: { id: req.userId! }, select: { plan: true } });
  if (!user) {
    res.status(404).json({ error: "Utilisateur introuvable." });
    return;
  }

  if (!isPremium(user)) {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const todayCount = await prisma.chatMessage.count({
      where: { userId: req.userId!, role: "user", createdAt: { gte: startOfDay } },
    });
    if (todayCount >= CHAT_DAILY_LIMIT) {
      res.status(402).json({
        error: `Vous avez atteint votre quota de ${CHAT_DAILY_LIMIT} messages aujourd'hui. Passez à l'offre Premium pour des réponses illimitées.`,
        code: "SUBSCRIPTION_REQUIRED",
      });
      return;
    }
  }

  const [profile, recentSessions, history] = await Promise.all([
    prisma.athleteProfile.findUnique({ where: { userId: req.userId! } }),
    prisma.session.findMany({
      where: { userId: req.userId! },
      orderBy: { date: "desc" },
      take: 10,
    }),
    prisma.chatMessage.findMany({
      where: { userId: req.userId! },
      orderBy: { createdAt: "asc" },
      take: 20,
    }),
  ]);

  await prisma.chatMessage.create({
    data: { userId: req.userId!, role: "user", content: parsed.data.content },
  });

  const contextLines = [
    "Tu es le coach personnel de triathlon de cet athlète, dans un chat continu.",
    "Réponds de façon concise, concrète et bienveillante, en français.",
    profile
      ? `Profil athlète : objectif=${profile.objectif}, date objectif=${profile.objectifDate.toISOString().slice(0, 10)}, heures/semaine=${profile.heuresSemaine}, contraintes=${profile.contraintes || "aucune"}, dernier temps natation=${profile.tempsNatation || "n/a"}, dernier temps vélo=${profile.tempsVelo || "n/a"}, dernier temps course=${profile.tempsCourse || "n/a"}`
      : "L'athlète n'a pas encore rempli son profil.",
    recentSessions.length
      ? `Séances récentes : ${recentSessions
          .map((s) => `${s.date.toISOString().slice(0, 10)} ${s.sport} ${s.dureeMin}min (${s.status})`)
          .join("; ")}`
      : "Aucune séance enregistrée pour le moment.",
  ].join("\n");

  try {
    const reply = await askClaude({
      system: contextLines,
      messages: [
        ...history.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
        { role: "user", content: parsed.data.content },
      ],
      maxTokens: 1000,
    });

    const saved = await prisma.chatMessage.create({
      data: { userId: req.userId!, role: "assistant", content: reply },
    });
    res.status(201).json(saved);
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: "Le coach IA n'a pas pu répondre. Réessayez." });
  }
});
