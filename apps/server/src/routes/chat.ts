import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth, type AuthedRequest } from "../middleware/auth.js";
import { askClaude, isAiConfigured, AiNotConfiguredError, MODEL } from "../lib/anthropic.js";
import { recordAiCall } from "../lib/aiUsage.js";
import { CHAT_DAILY_LIMIT, isPremium } from "../lib/subscription.js";
import { ah, HttpError } from "../lib/http.js";
import { chatRateLimit } from "../lib/rateLimit.js";
import { startOfLocalDay } from "../lib/week.js";
import { computeTrainingZones, formatZonesForPrompt, periodization } from "../lib/training.js";
import { parseZoneOverrides } from "../lib/zoneOverrides.js";
import { describeActivity } from "../lib/activityMatching.js";

export const chatRouter = Router();
chatRouter.use(requireAuth);

/** Nombre de messages du fil renvoyés au modèle comme contexte. */
const HISTORY_WINDOW = 20;

const historyQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  /** Date du plus ancien message déjà affiché, pour remonter le fil. */
  before: z.string().datetime().optional(),
});

/**
 * Le fil est renvoyé par tranches, du plus récent au plus ancien puis remis
 * dans l'ordre : une conversation de plusieurs centaines de messages ne doit
 * pas être rechargée entièrement à chaque ouverture.
 */
chatRouter.get(
  "/",
  ah(async (req: AuthedRequest, res) => {
    const parsed = historyQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw new HttpError(400, "Paramètres de conversation invalides.");
    }
    const { limit, before } = parsed.data;

    const recent = await prisma.chatMessage.findMany({
      where: {
        userId: req.userId!,
        ...(before ? { createdAt: { lt: new Date(before) } } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: limit + 1,
    });

    const hasMore = recent.length > limit;
    const page = hasMore ? recent.slice(0, limit) : recent;

    res.json({
      messages: page.reverse(),
      hasMore,
      oldestAt: page[0]?.createdAt ?? null,
    });
  })
);

chatRouter.delete(
  "/",
  ah(async (req: AuthedRequest, res) => {
    await prisma.chatMessage.deleteMany({ where: { userId: req.userId! } });
    res.json({ ok: true });
  })
);

const sendSchema = z.object({
  content: z.string().trim().min(1, "Message vide.").max(4000, "Message trop long (4000 caractères maximum)."),
});

chatRouter.post(
  "/",
  chatRateLimit,
  ah(async (req: AuthedRequest, res) => {
    if (!isAiConfigured()) {
      throw new HttpError(503, new AiNotConfiguredError().message);
    }

    const parsed = sendSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Message invalide." });
      return;
    }
    const content = parsed.data.content;

    const user = await prisma.user.findUnique({
      where: { id: req.userId! },
      select: { plan: true, timezone: true },
    });
    if (!user) {
      throw new HttpError(404, "Utilisateur introuvable.");
    }

    if (!isPremium(user)) {
      // Le quota se compte sur la journée de l'athlète, pas sur celle du serveur.
      const startOfDay = startOfLocalDay(new Date(), user.timezone);
      const todayCount = await prisma.chatMessage.count({
        where: { userId: req.userId!, role: "user", createdAt: { gte: startOfDay } },
      });
      if (todayCount >= CHAT_DAILY_LIMIT) {
        throw new HttpError(
          402,
          `Vous avez atteint votre quota de ${CHAT_DAILY_LIMIT} messages aujourd'hui. Passez à l'offre Premium pour des réponses illimitées.`,
          "SUBSCRIPTION_REQUIRED"
        );
      }
    }

    const [profile, recentSessions, recentMessages, recentActivities] = await Promise.all([
      prisma.athleteProfile.findUnique({ where: { userId: req.userId! } }),
      prisma.session.findMany({ where: { userId: req.userId! }, orderBy: { date: "desc" }, take: 10 }),
      // Les DERNIERS messages, pas les premiers : trié en ascendant, `take` renvoyait
      // les 20 plus anciens et le coach perdait le fil au bout de 20 échanges.
      prisma.chatMessage.findMany({
        where: { userId: req.userId! },
        orderBy: { createdAt: "desc" },
        take: HISTORY_WINDOW,
      }),
      prisma.activity.findMany({
        where: { userId: req.userId!, startedAt: { gte: new Date(Date.now() - 21 * 24 * 3600 * 1000) } },
        orderBy: { startedAt: "desc" },
        take: 15,
      }),
    ]);

    const history = [...recentMessages].reverse();

    const zones = profile
      ? computeTrainingZones({
          tempsCourse: profile.tempsCourse,
          tempsNatation: profile.tempsNatation,
          tempsVelo: profile.tempsVelo,
          ftpWatts: profile.ftpWatts,
          overrides: parseZoneOverrides(profile.customZones),
        })
      : null;
    const phase = profile ? periodization(new Date(), profile.objectifDate) : null;

    const system = [
      "Tu es le coach personnel de triathlon de cet athlète, dans un chat continu.",
      "Réponds de façon concise, concrète et bienveillante, en français.",
      profile
        ? `Profil athlète : objectif=${profile.objectif}, date objectif=${profile.objectifDate.toISOString().slice(0, 10)}, heures/semaine=${profile.heuresSemaine}, contraintes=${profile.contraintes || "aucune"}, dernier temps natation=${profile.tempsNatation || "n/a"}, dernier temps vélo=${profile.tempsVelo || "n/a"}, dernier temps course=${profile.tempsCourse || "n/a"}`
        : "L'athlète n'a pas encore rempli son profil.",
      phase ? `Phase de préparation actuelle : ${phase.label} (objectif dans ${phase.weeksToGoal} semaine(s)). ${phase.guidance}` : "",
      zones ? `Zones d'entraînement (à reprendre telles quelles) :\n${formatZonesForPrompt(zones)}` : "",
      recentActivities.length
        ? `Séances réellement effectuées et mesurées (montre/Strava), les plus fiables :\n${recentActivities
            .map((a) => `- ${describeActivity(a)}`)
            .join("\n")}`
        : "",
      recentSessions.length
        ? `Séances planifiées récentes : ${recentSessions
            .map((s) => `${s.date.toISOString().slice(0, 10)} ${s.sport} ${s.dureeMin}min (${s.status})`)
            .join("; ")}`
        : "Aucune séance enregistrée pour le moment.",
    ]
      .filter(Boolean)
      .join("\n");

    let reply: string;
    try {
      const response = await askClaude({
        system,
        messages: [
          ...history.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
          { role: "user", content },
        ],
        maxTokens: 1000,
      });
      reply = response.text;
      await recordAiCall({ userId: req.userId!, kind: "chat", response, succeeded: Boolean(reply.trim()) });
    } catch (err) {
      await recordAiCall({ userId: req.userId!, kind: "chat", model: MODEL, succeeded: false });
      console.error("Réponse du coach IA impossible :", err);
      throw new HttpError(502, "Le coach IA n'a pas pu répondre. Réessayez.");
    }

    if (!reply.trim()) {
      throw new HttpError(502, "Le coach IA n'a pas pu répondre. Réessayez.");
    }

    // Les deux messages sont enregistrés ensemble, après la réponse : en cas
    // d'échec, la question n'est pas conservée et ne consomme pas le quota.
    // Les horodatages sont explicites car, dans une même transaction, le
    // CURRENT_TIMESTAMP de Postgres est identique pour les deux lignes — le fil
    // serait alors trié dans un ordre arbitraire au rechargement.
    const askedAt = new Date();
    const [, saved] = await prisma.$transaction([
      prisma.chatMessage.create({
        data: { userId: req.userId!, role: "user", content, createdAt: askedAt },
      }),
      prisma.chatMessage.create({
        data: {
          userId: req.userId!,
          role: "assistant",
          content: reply,
          createdAt: new Date(askedAt.getTime() + 1),
        },
      }),
    ]);

    res.status(201).json(saved);
  })
);
