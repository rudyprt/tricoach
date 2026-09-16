import { Router } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { requireAuth, type AuthedRequest } from "../middleware/auth.js";
import { isPremium } from "../lib/subscription.js";
import { ah, HttpError } from "../lib/http.js";
import { sessionStructureSchema } from "../lib/session.js";
import { bilanDeCharge } from "../lib/trainingLoad.js";
import { bilanRegularite, recordsPersonnels } from "../lib/regularite.js";

export const insightsRouter = Router();
insightsRouter.use(requireAuth);

async function requirePremium(userId: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { plan: true } });
  if (!user || !isPremium(user)) {
    throw new HttpError(403, "Fonctionnalité réservée à l'offre Premium.", "PREMIUM_REQUIRED");
  }
}

const NEGATIVE_KEYWORDS = [
  "fatigue",
  "fatigué",
  "épuisé",
  "épuisée",
  "lourd",
  "lourde",
  "douleur",
  "mal",
  "difficile",
  "dur",
  "essoufflé",
  "courbatur",
  "kc",
  "raide",
  "blessure",
];

insightsRouter.get(
  "/overtraining",
  ah(async (req: AuthedRequest, res) => {
    await requirePremium(req.userId!);

    const since = new Date();
    since.setDate(since.getDate() - 14);

    const sessions = await prisma.session.findMany({
      where: { userId: req.userId!, date: { gte: since }, sport: { not: "repos" } },
      orderBy: { date: "asc" },
    });

    const completed = sessions.filter((s) => s.status === "faite" || s.status === "manquee");
    const reasons: string[] = [];

    const missed = completed.filter((s) => s.status === "manquee").length;
    const missedRate = completed.length > 0 ? missed / completed.length : 0;
    if (missedRate > 0.3) reasons.push("Beaucoup de séances manquées récemment.");
    else if (missedRate > 0.15) reasons.push("Quelques séances manquées récemment.");

    const negativeCount = completed.filter(
      (s) => s.ressenti && NEGATIVE_KEYWORDS.some((k) => s.ressenti!.toLowerCase().includes(k))
    ).length;
    if (negativeCount >= 3) reasons.push("Plusieurs ressentis évoquent fatigue ou douleur.");
    else if (negativeCount >= 1) reasons.push("Un ressenti récent évoque fatigue ou douleur.");

    const midpoint = new Date();
    midpoint.setDate(midpoint.getDate() - 7);
    const lastWeekVolume = completed
      .filter((s) => s.status === "faite" && s.date >= midpoint)
      .reduce((sum, s) => sum + s.dureeMin, 0);
    const prevWeekVolume = completed
      .filter((s) => s.status === "faite" && s.date < midpoint)
      .reduce((sum, s) => sum + s.dureeMin, 0);
    const volumeIncreasePct = prevWeekVolume > 0 ? ((lastWeekVolume - prevWeekVolume) / prevWeekVolume) * 100 : 0;
    if (volumeIncreasePct > 40) reasons.push("Le volume d'entraînement a fortement augmenté par rapport à la semaine précédente.");
    else if (volumeIncreasePct > 25) reasons.push("Le volume d'entraînement a nettement augmenté.");

    let risk: "low" | "moderate" | "high" = "low";
    if (missedRate > 0.3 || (volumeIncreasePct > 40 && negativeCount >= 2)) risk = "high";
    else if (reasons.length > 0) risk = "moderate";

    res.json({
      risk,
      reasons,
      stats: {
        missedRate: Math.round(missedRate * 100),
        volumeIncreasePct: Math.round(volumeIncreasePct),
        lastWeekVolumeMin: lastWeekVolume,
        prevWeekVolumeMin: prevWeekVolume,
        windowDays: 14,
      },
    });
  })
);

// Les cibles générées s'écrivent "Z3 tempo" ou "Zone 3 tempo" selon les
// versions du prompt : les deux formes doivent être reconnues.
const ZONE_REGEX = /\b(?:zone\s*|z)([1-5])\b/i;

insightsRouter.get(
  "/hr-zones",
  ah(async (req: AuthedRequest, res) => {
    await requirePremium(req.userId!);

    const since = new Date();
    since.setDate(since.getDate() - 30);

    const sessions = await prisma.session.findMany({
      where: { userId: req.userId!, status: "faite", date: { gte: since }, structure: { not: Prisma.DbNull } },
    });

    const zoneMinutes = new Map<string, number>();

    for (const s of sessions) {
      const parsed = sessionStructureSchema.safeParse(s.structure);
      if (!parsed.success) continue;
      for (const block of Object.values(parsed.data)) {
        const match = block.cible?.match(ZONE_REGEX);
        const zone = match ? `Zone ${match[1]}` : "Non classée";
        zoneMinutes.set(zone, (zoneMinutes.get(zone) ?? 0) + (block.dureeMin ?? 0));
      }
    }

    const zones = Array.from(zoneMinutes.entries())
      .map(([zone, minutes]) => ({ zone, minutes }))
      .sort((a, b) => a.zone.localeCompare(b.zone));

    res.json({ zones, windowDays: 30 });
  })
);

/**
 * Charge, forme et fraîcheur. Contrairement aux autres analyses, celle-ci est
 * ouverte à tous : c'est le garde-fou anti-surentraînement, et le réserver à
 * l'offre payante reviendrait à vendre la sécurité de l'athlète.
 */
insightsRouter.get(
  "/charge",
  ah(async (req: AuthedRequest, res) => {
    res.json(await bilanDeCharge(req.userId!));
  })
);

/**
 * Régularité, jalons et records. Ouvert à tous : c'est ce qui donne envie de
 * revenir, pas un argument de vente.
 */
insightsRouter.get(
  "/regularite",
  ah(async (req: AuthedRequest, res) => {
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: req.userId! },
      select: { timezone: true },
    });

    const [bilan, records] = await Promise.all([
      bilanRegularite(req.userId!, user.timezone),
      recordsPersonnels(req.userId!),
    ]);

    res.json({ ...bilan, records });
  })
);
