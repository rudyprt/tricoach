import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth, type AuthedRequest } from "../middleware/auth.js";
import { isPremium } from "../lib/subscription.js";

export const insightsRouter = Router();
insightsRouter.use(requireAuth);

async function requirePremium(req: AuthedRequest, res: import("express").Response): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: req.userId! }, select: { plan: true } });
  if (!user || !isPremium(user)) {
    res.status(403).json({ error: "Fonctionnalité réservée à l'offre Premium.", code: "PREMIUM_REQUIRED" });
    return false;
  }
  return true;
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

insightsRouter.get("/overtraining", async (req: AuthedRequest, res) => {
  if (!(await requirePremium(req, res))) return;

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
});

insightsRouter.get("/hr-zones", async (req: AuthedRequest, res) => {
  if (!(await requirePremium(req, res))) return;

  const since = new Date();
  since.setDate(since.getDate() - 30);

  const sessions = await prisma.session.findMany({
    where: { userId: req.userId!, status: "faite", date: { gte: since }, structure: { not: null } },
  });

  const zoneMinutes = new Map<string, number>();
  const zoneRegex = /zone\s*([1-5])/i;

  for (const s of sessions) {
    if (!s.structure) continue;
    try {
      const structure = JSON.parse(s.structure) as Record<string, { dureeMin: number; cible: string }>;
      for (const block of Object.values(structure)) {
        const match = block.cible?.match(zoneRegex);
        const zone = match ? `Zone ${match[1]}` : "Non classée";
        zoneMinutes.set(zone, (zoneMinutes.get(zone) ?? 0) + (block.dureeMin ?? 0));
      }
    } catch {
      // ignore malformed structure
    }
  }

  const zones = Array.from(zoneMinutes.entries())
    .map(([zone, minutes]) => ({ zone, minutes }))
    .sort((a, b) => a.zone.localeCompare(b.zone));

  res.json({ zones, windowDays: 30 });
});
