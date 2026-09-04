import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth, type AuthedRequest } from "../middleware/auth.js";
import { askClaude, isAiConfigured, AiNotConfiguredError } from "../lib/anthropic.js";
import { serializeSession, type SessionStructure } from "../lib/session.js";
import { hasStandardAccess } from "../lib/subscription.js";

export const plansRouter = Router();
plansRouter.use(requireAuth);

const VOLUME_INCREASE_CAP = 1.1; // règle des 10% : jamais plus de +10% de volume réalisé d'une semaine à l'autre

function startOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = (day === 0 ? -6 : 1) - day; // recule jusqu'au lundi
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

interface AiSession {
  date: string;
  sport: "natation" | "velo" | "course" | "renfo" | "repos";
  titre: string;
  dureeMin: number;
  distanceKm?: number | null;
  description?: string;
  objectif?: string | null;
  structure?: SessionStructure | null;
}

interface AiPlanResponse {
  sessions: AiSession[];
  debrief?: string | null;
}

interface ProfileForPrompt {
  objectif: string;
  objectifDate: Date;
  tempsNatation: string;
  tempsVelo: string;
  tempsCourse: string;
  heuresSemaine: number;
  contraintes: string;
}

function buildSystemPrompt(includeDebrief: boolean): string {
  const lines = [
    "Tu es un coach de triathlon expérimenté et bienveillant.",
    "Tu conçois des programmes d'entraînement hebdomadaires personnalisés en natation, vélo, course à pied et renforcement.",
    "Tu tiens compte du niveau, de l'objectif, du temps disponible, des blessures/contraintes signalées, et de l'historique récent des séances (charge, ressenti).",
    "Tu réponds UNIQUEMENT avec un JSON valide, sans texte autour, sans balises markdown, au format exact suivant :",
    `{${includeDebrief ? `"debrief":"string",` : ""}"sessions":[{"date":"YYYY-MM-DD","sport":"natation|velo|course|renfo|repos","titre":"string","dureeMin":number,"distanceKm":number|null,"description":"string","objectif":null|"string","structure":null|{"echauffement":{"dureeMin":number,"cible":"string","description":"string"},"corps":{"dureeMin":number,"cible":"string","description":"string","exercices":[{"repetitions":"string","allure":"string","recuperation":"string"}]},"retourCalme":{"dureeMin":number,"cible":"string","description":"string"}}}]}`,
    "Une entrée par jour de la semaine (7 entrées), y compris les jours de repos (sport: repos, dureeMin: 0, objectif: null, structure: null).",
    "",
    "Champ \"objectif\" (obligatoire pour toute séance sport != repos) : explique en 1-2 phrases COURTES (20-30 mots maximum, jamais plus) POURQUOI cette séance précise est programmée maintenant — quelle qualité elle développe et en quoi elle sert l'objectif de l'athlète. Écris directement à l'athlète (\"tu\"), clair et motivant. Respecte STRICTEMENT cette limite de mots, y compris pour un objectif à long terme (ne développe pas plus longuement sous prétexte que l'échéance est lointaine).",
    "",
    "Pour toute séance sport != repos, remplis TOUJOURS \"structure\" avec 3 blocs : échauffement, corps de séance, retour au calme. La somme de leurs dureeMin doit être proche de dureeMin total.",
    "\"cible\" décrit l'intensité concrète du bloc : zone relative (Zone 1 à 5, nommée : endurance fondamentale / endurance active / tempo / seuil / VMA-PMA) ET une allure ou puissance chiffrée cohérente avec les temps de référence de l'athlète (ex: \"Zone 2 endurance fondamentale, ~5:30/km\" pour un coureur dont le 10km est à 4:30/km ; \"Zone 4 seuil, ~150-160W\" pour un cycliste). Calcule ces allures/puissances toi-même à partir des temps de référence fournis (règles d'entraînement classiques : allure seuil ≈ allure 10km +15-20s/km, allure endurance ≈ allure 10km +60-90s/km, etc. pour la course ; logique équivalente pour vélo et natation). N'invente jamais de FC en bpm absolus (FC max inconnue) : reste en zones relatives.",
    "\"corps.exercices\" (uniquement pour le bloc corps de séance, quand la séance comporte du fractionné/intervalles/répétitions) : liste concrète et chiffrée, MAXIMUM 4 lignes, ex: [{\"repetitions\":\"6 x 400m\",\"allure\":\"4:10/km (Zone 4 seuil)\",\"recuperation\":\"90s trot\"}]. Pour une sortie continue sans fractionné (endurance, sortie longue), laisse \"exercices\" vide ou omets-le et décris l'effort dans \"description\".",
    "Le volume hebdomadaire total doit respecter les heures disponibles indiquées par l'athlète.",
    "IMPORTANT — sois très concis partout, sans exception : chaque \"description\" (séance et blocs) fait 15 mots maximum, chaque \"objectif\" fait 20-30 mots maximum. La réponse complète doit rester compacte : pas de phrases superflues, va droit à l'essentiel. Ne jamais tronquer le JSON : si tu manques de place, raccourcis encore les textes plutôt que de laisser une réponse incomplète.",
  ];

  if (includeDebrief) {
    lines.push(
      "",
      "Champ \"debrief\" (obligatoire, en tout premier dans le JSON) : un message écrit directement à l'athlète (\"tu\"), 60-90 mots, qui fait le bilan de LA SEMAINE QUI VIENT DE SE TERMINER (données fournies dans le message utilisateur). Félicite-le pour ses efforts et sa régularité, mentionne 1-2 réussites concrètes (séance clé complétée, régularité, progression de temps/distance/allure si visible), reste honnête et bienveillant si des séances ont été manquées (sans culpabiliser), et termine par une phrase motivante sur la semaine à venir. Ton chaleureux et humain, pas de jargon.",
      "RÈGLE DE SÉCURITÉ ANTI-BLESSURE (stricte, non négociable) : le volume total de la nouvelle semaine (somme des dureeMin des séances sport != repos) NE DOIT JAMAIS dépasser la limite indiquée dans le message utilisateur (\"volume maximum autorisé\"), même si les heures disponibles déclarées par l'athlète permettraient davantage. Si le ressenti ou le nombre de séances manquées la semaine passée suggère de la fatigue, n'augmente pas le volume — maintiens-le ou réduis-le légèrement plutôt que d'aller jusqu'à la limite."
    );
  }

  return lines.join("\n");
}

function buildUserPrompt(
  profile: ProfileForPrompt,
  weekStart: Date,
  recentSessions: { date: Date; sport: string; dureeMin: number; distanceKm: number | null; status: string; ressenti: string | null }[]
): string {
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    return formatDate(d);
  });

  const historyLines = recentSessions.length
    ? recentSessions
        .map(
          (s) =>
            `${formatDate(s.date)} ${s.sport} ${s.dureeMin}min${s.distanceKm ? ` ${s.distanceKm}km` : ""} (${s.status})${s.ressenti ? ` - ressenti: ${s.ressenti}` : ""}`
        )
        .join("; ")
    : "aucun historique disponible";

  return [
    `Objectif de l'athlète : ${profile.objectif}`,
    `Date de l'objectif : ${formatDate(profile.objectifDate)}`,
    `Dernier temps natation : ${profile.tempsNatation || "non renseigné"}`,
    `Dernier temps vélo : ${profile.tempsVelo || "non renseigné"}`,
    `Dernier temps course à pied : ${profile.tempsCourse || "non renseigné"}`,
    `Heures disponibles cette semaine : ${profile.heuresSemaine}h`,
    `Blessures / contraintes : ${profile.contraintes || "aucune"}`,
    `Séances récentes (pour adapter la charge et les zones) : ${historyLines}`,
    `Génère le programme pour les 7 jours suivants (dans cet ordre) : ${days.join(", ")}`,
  ].join("\n");
}

function buildProgressionUserPrompt(
  profile: ProfileForPrompt,
  weekStart: Date,
  pastSessions: { date: Date; sport: string; titre: string; dureeMin: number; distanceKm: number | null; status: string; ressenti: string | null }[],
  stats: { plannedVolumeMin: number; realizedVolumeMin: number; completedCount: number; missedCount: number; totalCount: number; maxVolumeMin: number }
): string {
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    return formatDate(d);
  });

  const pastLines = pastSessions.length
    ? pastSessions
        .map(
          (s) =>
            `${formatDate(s.date)} ${s.sport} "${s.titre}" ${s.dureeMin}min${s.distanceKm ? ` ${s.distanceKm}km` : ""} → ${s.status}${s.ressenti ? ` (ressenti: ${s.ressenti})` : ""}`
        )
        .join("; ")
    : "aucune séance la semaine passée";

  return [
    `Objectif de l'athlète : ${profile.objectif}`,
    `Date de l'objectif : ${formatDate(profile.objectifDate)}`,
    `Dernier temps natation : ${profile.tempsNatation || "non renseigné"}`,
    `Dernier temps vélo : ${profile.tempsVelo || "non renseigné"}`,
    `Dernier temps course à pied : ${profile.tempsCourse || "non renseigné"}`,
    `Heures disponibles cette semaine : ${profile.heuresSemaine}h`,
    `Blessures / contraintes : ${profile.contraintes || "aucune"}`,
    "",
    `Détail de LA SEMAINE QUI VIENT DE SE TERMINER : ${pastLines}`,
    `Bilan chiffré de cette semaine passée : ${stats.completedCount}/${stats.totalCount} séances complétées, ${stats.missedCount} manquée(s), volume réalisé ≈ ${Math.round(stats.realizedVolumeMin)} min (volume prévu était ${Math.round(stats.plannedVolumeMin)} min).`,
    `Volume maximum autorisé pour la nouvelle semaine : ${stats.maxVolumeMin} minutes (règle des +10% maximum, anti-blessure, stricte).`,
    "",
    `Génère le débrief de la semaine passée puis le programme de la nouvelle semaine, pour les 7 jours suivants (dans cet ordre) : ${days.join(", ")}`,
  ].join("\n");
}

function parseAiPlan(raw: string): AiPlanResponse {
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    console.error("Réponse IA sans JSON détectable, contenu brut :", raw);
    throw new Error("Réponse IA invalide (pas de JSON trouvé).");
  }
  let parsed: AiPlanResponse;
  try {
    parsed = JSON.parse(jsonMatch[0]) as AiPlanResponse;
  } catch (err) {
    console.error("Réponse IA JSON invalide/tronquée, contenu brut :", raw);
    throw err;
  }
  if (!Array.isArray(parsed.sessions)) throw new Error("Réponse IA invalide (sessions manquantes).");
  return parsed;
}

async function runGeneration(system: string, userPrompt: string): Promise<{ aiPlan: AiPlanResponse; raw: string }> {
  const attempts = 2;
  let aiPlan: AiPlanResponse | null = null;
  let raw = "";
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= attempts && !aiPlan; attempt++) {
    try {
      raw = await askClaude({
        system,
        messages: [{ role: "user", content: userPrompt }],
        maxTokens: 8192,
      });
      aiPlan = parseAiPlan(raw);
    } catch (err) {
      lastError = err;
      console.error(`Tentative ${attempt}/${attempts} de génération échouée.`);
    }
  }

  if (!aiPlan) {
    throw lastError ?? new Error("Échec de la génération après plusieurs tentatives.");
  }
  return { aiPlan, raw };
}

async function checkAccess(userId: string, res: import("express").Response): Promise<boolean> {
  if (!isAiConfigured()) {
    res.status(503).json({ error: new AiNotConfiguredError().message });
    return false;
  }
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { plan: true, createdAt: true } });
  if (!user) {
    res.status(404).json({ error: "Utilisateur introuvable." });
    return false;
  }
  if (!hasStandardAccess(user)) {
    res.status(402).json({
      error: "Votre semaine d'essai gratuite est terminée. Choisissez une offre pour continuer à générer votre programme.",
      code: "SUBSCRIPTION_REQUIRED",
    });
    return false;
  }
  return true;
}

plansRouter.post("/generate", async (req: AuthedRequest, res) => {
  if (!(await checkAccess(req.userId!, res))) return;

  const profile = await prisma.athleteProfile.findUnique({ where: { userId: req.userId! } });
  if (!profile) {
    res.status(400).json({ error: "Complétez d'abord votre profil (onboarding)." });
    return;
  }

  const weekStart = startOfWeek(new Date());

  const recentSessions = await prisma.session.findMany({
    where: { userId: req.userId!, status: { in: ["faite", "manquee"] } },
    orderBy: { date: "desc" },
    take: 10,
    select: { date: true, sport: true, dureeMin: true, distanceKm: true, status: true, ressenti: true },
  });

  try {
    const { aiPlan, raw } = await runGeneration(
      buildSystemPrompt(false),
      buildUserPrompt(profile, weekStart, recentSessions)
    );

    await prisma.trainingPlan.deleteMany({ where: { userId: req.userId!, weekStart } });

    const plan = await prisma.trainingPlan.create({
      data: {
        userId: req.userId!,
        weekStart,
        rawAiJson: raw,
        sessions: {
          create: aiPlan.sessions.map((s) => ({
            userId: req.userId!,
            date: new Date(s.date),
            sport: s.sport,
            titre: s.titre,
            dureeMin: s.dureeMin,
            distanceKm: s.distanceKm ?? null,
            description: s.description ?? "",
            objectif: s.objectif ?? null,
            structure: s.structure ? JSON.stringify(s.structure) : null,
          })),
        },
      },
      include: { sessions: { orderBy: { date: "asc" } } },
    });

    res.status(201).json({ ...plan, sessions: plan.sessions.map(serializeSession) });
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: "Échec de la génération du programme par l'IA. Réessayez." });
  }
});

plansRouter.get("/previous", async (req: AuthedRequest, res) => {
  const weekStart = startOfWeek(new Date());
  const previous = await prisma.trainingPlan.findFirst({
    where: { userId: req.userId!, weekStart: { lt: weekStart } },
    orderBy: { weekStart: "desc" },
  });
  res.json({ exists: Boolean(previous) });
});

plansRouter.post("/next", async (req: AuthedRequest, res) => {
  if (!(await checkAccess(req.userId!, res))) return;

  const profile = await prisma.athleteProfile.findUnique({ where: { userId: req.userId! } });
  if (!profile) {
    res.status(400).json({ error: "Complétez d'abord votre profil (onboarding)." });
    return;
  }

  const weekStart = startOfWeek(new Date());

  const previousPlan = await prisma.trainingPlan.findFirst({
    where: { userId: req.userId!, weekStart: { lt: weekStart } },
    orderBy: { weekStart: "desc" },
    include: { sessions: { orderBy: { date: "asc" } } },
  });

  if (!previousPlan) {
    res.status(400).json({ error: "Aucune semaine précédente trouvée pour établir une progression." });
    return;
  }

  const nonRestSessions = previousPlan.sessions.filter((s) => s.sport !== "repos");
  const plannedVolumeMin = nonRestSessions.reduce((sum, s) => sum + s.dureeMin, 0);
  const realizedVolumeMin = nonRestSessions
    .filter((s) => s.status === "faite")
    .reduce((sum, s) => sum + s.dureeMin, 0);
  const completedCount = nonRestSessions.filter((s) => s.status === "faite").length;
  const missedCount = nonRestSessions.filter((s) => s.status === "manquee").length;

  const baseVolumeMin =
    realizedVolumeMin > 0 ? realizedVolumeMin : plannedVolumeMin > 0 ? plannedVolumeMin : profile.heuresSemaine * 60;
  const maxVolumeMin = Math.round(baseVolumeMin * VOLUME_INCREASE_CAP);

  const stats = {
    plannedVolumeMin,
    realizedVolumeMin,
    completedCount,
    missedCount,
    totalCount: nonRestSessions.length,
    maxVolumeMin,
  };

  try {
    const { aiPlan, raw } = await runGeneration(
      buildSystemPrompt(true),
      buildProgressionUserPrompt(profile, weekStart, nonRestSessions, stats)
    );

    await prisma.trainingPlan.deleteMany({ where: { userId: req.userId!, weekStart } });

    const plan = await prisma.trainingPlan.create({
      data: {
        userId: req.userId!,
        weekStart,
        rawAiJson: raw,
        debrief: aiPlan.debrief ?? null,
        sessions: {
          create: aiPlan.sessions.map((s) => ({
            userId: req.userId!,
            date: new Date(s.date),
            sport: s.sport,
            titre: s.titre,
            dureeMin: s.dureeMin,
            distanceKm: s.distanceKm ?? null,
            description: s.description ?? "",
            objectif: s.objectif ?? null,
            structure: s.structure ? JSON.stringify(s.structure) : null,
          })),
        },
      },
      include: { sessions: { orderBy: { date: "asc" } } },
    });

    res.status(201).json({ ...plan, sessions: plan.sessions.map(serializeSession) });
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: "Échec de la génération du programme par l'IA. Réessayez." });
  }
});

plansRouter.get("/current", async (req: AuthedRequest, res) => {
  const weekStart = startOfWeek(new Date());
  const plan = await prisma.trainingPlan.findFirst({
    where: { userId: req.userId!, weekStart },
    include: { sessions: { orderBy: { date: "asc" } } },
    orderBy: { generatedAt: "desc" },
  });
  if (!plan) {
    res.json(null);
    return;
  }
  res.json({ ...plan, sessions: plan.sessions.map(serializeSession) });
});
