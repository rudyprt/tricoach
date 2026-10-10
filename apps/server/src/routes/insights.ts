import { Router } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { requireAuth, type AuthedRequest } from "../middleware/auth.js";
import { isPremium } from "../lib/subscription.js";
import { ah, HttpError } from "../lib/http.js";
import { sessionStructureSchema } from "../lib/session.js";
import { bilanDeCharge } from "../lib/trainingLoad.js";
import { bilanRegularite, recordsPersonnels } from "../lib/regularite.js";
import { addDays, startOfWeek } from "../lib/week.js";

export const insightsRouter = Router();
insightsRouter.use(requireAuth);

async function requirePremium(userId: string): Promise<{ plan: string; timezone: string }> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { plan: true, timezone: true } });
  if (!user || !isPremium(user)) {
    throw new HttpError(403, "Fonctionnalité réservée à l'offre Premium.", "PREMIUM_REQUIRED");
  }
  return user;
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
    const user = await requirePremium(req.userId!);

    /*
     * Deux semaines CALENDAIRES révolues, et non deux fenêtres glissantes.
     *
     * L'alerte comparait [aujourd'hui-7, aujourd'hui] à [aujourd'hui-14,
     * aujourd'hui-7]. La première moitié tombait donc dans la semaine en
     * cours, encore incomplète : un lundi, le « volume de la semaine » ne
     * valait qu'une séance, et la comparaison annonçait un effondrement ou
     * une explosion selon le jour où l'athlète ouvrait l'application.
     *
     * Pire, le débrief affiché juste au-dessus parle, lui, de la dernière
     * semaine calendaire terminée. Les deux encadrés se contredisaient en
     * décrivant des périodes différentes. Ils parlent désormais de la même.
     */
    const semaineEnCours = startOfWeek(new Date(), user.timezone);
    const derniereTerminee = addDays(semaineEnCours, -7);
    const avantDerniere = addDays(semaineEnCours, -14);

    const sessions = await prisma.session.findMany({
      where: {
        userId: req.userId!,
        date: { gte: avantDerniere, lt: semaineEnCours },
        sport: { not: "repos" },
      },
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

    // Le volume réellement fait, durées corrigées comprises : c'est celui que
    // l'athlète lit partout ailleurs dans l'application.
    const volumeRealise = (debut: Date, fin: Date) =>
      completed
        .filter((s) => s.status === "faite" && s.date >= debut && s.date < fin)
        .reduce((sum, s) => sum + (s.dureeReelleMin ?? s.dureeMin), 0);

    const lastWeekVolume = volumeRealise(derniereTerminee, semaineEnCours);
    const prevWeekVolume = volumeRealise(avantDerniere, derniereTerminee);
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
        /** Les deux semaines comparées, pour que l'écran puisse les nommer. */
        derniereSemaine: derniereTerminee.toISOString().slice(0, 10),
        avantDerniereSemaine: avantDerniere.toISOString().slice(0, 10),
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

      /*
       * Les durées des blocs sont celles du programme. Quand l'athlète a
       * corrigé la durée réelle, il a fait une version plus courte ou plus
       * longue de la même séance : les blocs suivent dans la même proportion.
       * Sans ce report, une sortie de 90 minutes écourtée à 60 pesait toujours
       * 90 dans la répartition, et le graphique décrivait le programme plutôt
       * que l'entraînement.
       */
      const facteur = s.dureeReelleMin && s.dureeMin > 0 ? s.dureeReelleMin / s.dureeMin : 1;

      for (const block of Object.values(parsed.data)) {
        const match = block.cible?.match(ZONE_REGEX);
        const zone = match ? `Zone ${match[1]}` : "Non classée";
        zoneMinutes.set(zone, (zoneMinutes.get(zone) ?? 0) + (block.dureeMin ?? 0) * facteur);
      }
    }

    const zones = Array.from(zoneMinutes.entries())
      .map(([zone, minutes]) => ({ zone, minutes: Math.round(minutes) }))
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
