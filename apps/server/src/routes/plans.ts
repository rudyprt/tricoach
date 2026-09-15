import { Router } from "express";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { requireAuth, type AuthedRequest } from "../middleware/auth.js";
import { askClaude, isAiConfigured, AiNotConfiguredError, MODEL } from "../lib/anthropic.js";
import { recordAiCall, type AiCallKind } from "../lib/aiUsage.js";
import { serializeSession, sessionStructureSchema } from "../lib/session.js";
import { hasStandardAccess } from "../lib/subscription.js";
import { ah, HttpError } from "../lib/http.js";
import { generationRateLimit } from "../lib/rateLimit.js";
import { addDays, formatDate, localCalendarDate, startOfWeek, weekDays } from "../lib/week.js";
import {
  computeTrainingZones,
  formatZonesForPrompt,
  periodization,
  type Periodization,
  type TrainingZones,
} from "../lib/training.js";
import { buildZoneInputs } from "../lib/zoneInputs.js";
import { planWeeklyTest, testPromptLines } from "../lib/testScheduling.js";
import {
  dernierePauseTerminee,
  etatDeReprise,
  pauseEnCours,
  reprisePromptLines,
} from "../lib/pause.js";
import { coursesDeLAthlete, coursesPromptLines, facteurVolumeCourses } from "../lib/races.js";
import { describeActivity } from "../lib/activityMatching.js";

export const plansRouter = Router();
plansRouter.use(requireAuth);

const VOLUME_INCREASE_CAP = 1.1; // règle des 10% : jamais plus de +10% de volume réalisé d'une semaine à l'autre

const aiSessionSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date au format YYYY-MM-DD attendue"),
  sport: z.enum(["natation", "velo", "course", "renfo", "repos"]),
  titre: z.string().min(1).max(120),
  dureeMin: z.number().int().min(0).max(600),
  distanceKm: z.number().min(0).max(500).nullable().optional(),
  description: z.string().max(2000).optional(),
  objectif: z.string().max(2000).nullable().optional(),
  structure: sessionStructureSchema.nullable().optional(),
});

const aiPlanSchema = z.object({
  debrief: z.string().max(4000).nullable().optional(),
  sessions: z.array(aiSessionSchema).min(1).max(14),
});

type AiPlanResponse = z.infer<typeof aiPlanSchema>;

interface ProfileForPrompt {
  objectif: string;
  objectifDate: Date;
  tempsNatation: string;
  tempsVelo: string;
  tempsCourse: string;
  heuresSemaine: number;
  contraintes: string;
  ftpWatts: number | null;
  seuilCourseSecParKm: number | null;
  cssSecPer100m: number | null;
  fcSeuil: number | null;
  fcMax: number | null;
  customZones: unknown;
}

function buildSystemPrompt(includeDebrief: boolean, phase: Periodization): string {
  const lines = [
    "Tu es un coach de triathlon expérimenté et bienveillant.",
    "Tu conçois des programmes d'entraînement hebdomadaires personnalisés en natation, vélo, course à pied et renforcement.",
    "Tu tiens compte du niveau, de l'objectif, du temps disponible, des blessures/contraintes signalées, et de l'historique récent des séances (charge, ressenti).",
    "Tu réponds UNIQUEMENT avec un JSON valide, sans texte autour, sans balises markdown, au format exact suivant :",
    `{${includeDebrief ? `"debrief":"string",` : ""}"sessions":[{"date":"YYYY-MM-DD","sport":"natation|velo|course|renfo|repos","titre":"string","dureeMin":number,"distanceKm":number|null,"description":"string","objectif":null|"string","structure":null|{"echauffement":{"dureeMin":number,"cible":"string","description":"string"},"corps":{"dureeMin":number,"cible":"string","description":"string","exercices":[{"repetitions":"string","allure":"string","recuperation":"string"}]},"retourCalme":{"dureeMin":number,"cible":"string","description":"string"}}}]}`,
    "Une entrée par jour de la semaine (7 entrées), y compris les jours de repos (sport: repos, dureeMin: 0, objectif: null, structure: null).",
    "",
    `PHASE DE PRÉPARATION — ${phase.label} (objectif dans ${phase.weeksToGoal} semaine(s)). ${phase.guidance}`,
    "Cette phase prime sur toute autre considération de contenu : la semaine générée doit être cohérente avec elle.",
    "",
    "Champ \"objectif\" (obligatoire pour toute séance sport != repos) : explique en 1-2 phrases COURTES (20-30 mots maximum, jamais plus) POURQUOI cette séance précise est programmée maintenant — quelle qualité elle développe et en quoi elle sert l'objectif de l'athlète. Écris directement à l'athlète (\"tu\"), clair et motivant. Respecte STRICTEMENT cette limite de mots, y compris pour un objectif à long terme (ne développe pas plus longuement sous prétexte que l'échéance est lointaine).",
    "",
    "Pour toute séance sport != repos, remplis TOUJOURS \"structure\" avec 3 blocs : échauffement, corps de séance, retour au calme. La somme de leurs dureeMin doit être proche de dureeMin total.",
    "\"cible\" décrit l'intensité concrète du bloc : la zone (Z1 à Z5, nommée) ET l'allure ou la puissance chiffrée correspondante. Les zones de l'athlète sont fournies dans le message utilisateur : REPRENDS EXACTEMENT ces valeurs, ne les recalcule pas. N'invente jamais de FC en bpm absolus (FC max inconnue) : reste en zones relatives.",
    "\"corps.exercices\" (uniquement pour le bloc corps de séance, quand la séance comporte du fractionné/intervalles/répétitions) : liste concrète et chiffrée, MAXIMUM 4 lignes, ex: [{\"repetitions\":\"6 x 400m\",\"allure\":\"4:10/km (Z4 seuil)\",\"recuperation\":\"90s trot\"}]. Pour une sortie continue sans fractionné (endurance, sortie longue), laisse \"exercices\" vide ou omets-le et décris l'effort dans \"description\".",
    "Le volume hebdomadaire total doit respecter les heures disponibles indiquées par l'athlète ET la limite de volume donnée dans le message utilisateur.",
    "IMPORTANT — sois très concis partout, sans exception : chaque \"description\" (séance et blocs) fait 15 mots maximum, chaque \"objectif\" fait 20-30 mots maximum. La réponse complète doit rester compacte : pas de phrases superflues, va droit à l'essentiel. Ne jamais tronquer le JSON : si tu manques de place, raccourcis encore les textes plutôt que de laisser une réponse incomplète.",
  ];

  if (includeDebrief) {
    lines.push(
      "",
      "Champ \"debrief\" (obligatoire, en tout premier dans le JSON) : un message écrit directement à l'athlète (\"tu\"), 60-90 mots, qui fait le bilan de LA SEMAINE QUI VIENT DE SE TERMINER (données fournies dans le message utilisateur). Félicite-le pour ses efforts et sa régularité, mentionne 1-2 réussites concrètes (séance clé complétée, régularité, progression de temps/distance/allure si visible), reste honnête et bienveillant si des séances ont été manquées (sans culpabiliser), et termine par une phrase motivante sur la semaine à venir. Ton chaleureux et humain, pas de jargon."
    );
  }

  lines.push(
    "",
    "RÈGLE DE SÉCURITÉ ANTI-BLESSURE (stricte, non négociable) : le volume total de la nouvelle semaine (somme des dureeMin des séances sport != repos) NE DOIT JAMAIS dépasser la limite indiquée dans le message utilisateur (\"volume maximum autorisé\"), même si les heures disponibles déclarées par l'athlète permettraient davantage. Si le ressenti ou le nombre de séances manquées la semaine passée suggère de la fatigue, n'augmente pas le volume — maintiens-le ou réduis-le légèrement plutôt que d'aller jusqu'à la limite."
  );

  return lines.join("\n");
}

/**
 * Activités réellement effectuées, mesurées par la montre de l'athlète. C'est
 * la donnée la plus fiable dont dispose le coach : elle dit ce qui a été fait,
 * là où le reste du contexte dit ce qui était prévu ou ressenti.
 */
async function measuredActivityLines(userId: string, since: Date): Promise<string[]> {
  const activities = await prisma.activity.findMany({
    where: { userId, startedAt: { gte: since } },
    orderBy: { startedAt: "asc" },
    take: 30,
  });
  if (activities.length === 0) return [];

  return [
    "",
    "Séances réellement effectuées, mesurées (source : montre/Strava). Ces chiffres priment sur toute estimation :",
    activities.map((a) => `- ${describeActivity(a)}`).join("\n"),
    "Compare ces données aux allures prévues : si l'athlète court systématiquement plus vite que la zone demandée, dis-le lui et corrige. S'il est plus lent, adapte plutôt que d'insister.",
  ];
}

function profileLines(
  profile: ProfileForPrompt,
  phase: Periodization,
  maxVolumeMin: number,
  zones: TrainingZones
): string[] {

  return [
    `Objectif de l'athlète : ${profile.objectif}`,
    `Date de l'objectif : ${formatDate(profile.objectifDate)} (dans ${phase.weeksToGoal} semaine(s))`,
    `Phase de préparation : ${phase.label}`,
    `Dernier temps natation : ${profile.tempsNatation || "non renseigné"}`,
    `Dernier temps vélo : ${profile.tempsVelo || "non renseigné"}`,
    `Dernier temps course à pied : ${profile.tempsCourse || "non renseigné"}`,
    `Heures disponibles cette semaine : ${profile.heuresSemaine}h`,
    `Volume maximum autorisé pour cette semaine : ${maxVolumeMin} minutes (limite stricte, anti-blessure).`,
    `Blessures / contraintes : ${profile.contraintes || "aucune"}`,
    "",
    "Zones d'entraînement de l'athlète (calculées à partir de ses temps de référence — à reprendre telles quelles) :",
    formatZonesForPrompt(zones),
  ];
}

function buildFirstWeekPrompt(
  profile: ProfileForPrompt,
  weekStart: Date,
  phase: Periodization,
  maxVolumeMin: number,
  recentSessions: { date: Date; sport: string; dureeMin: number; distanceKm: number | null; status: string; ressenti: string | null }[],
  mesurees: string[],
  zones: TrainingZones,
  testLines: string[]
): string {
  const historyLines = recentSessions.length
    ? recentSessions
        .map(
          (s) =>
            `${formatDate(s.date)} ${s.sport} ${s.dureeMin}min${s.distanceKm ? ` ${s.distanceKm}km` : ""} (${s.status})${s.ressenti ? ` - ressenti: ${s.ressenti}` : ""}`
        )
        .join("; ")
    : "aucun historique disponible";

  return [
    ...profileLines(profile, phase, maxVolumeMin, zones),
    ...mesurees,
    ...testLines,
    "",
    `Séances récentes (pour adapter la charge et les zones) : ${historyLines}`,
    `Génère le programme pour les 7 jours suivants (dans cet ordre) : ${weekDays(weekStart).join(", ")}`,
  ].join("\n");
}

function buildProgressionPrompt(
  profile: ProfileForPrompt,
  weekStart: Date,
  phase: Periodization,
  pastSessions: { date: Date; sport: string; titre: string; dureeMin: number; distanceKm: number | null; status: string; ressenti: string | null }[],
  stats: { plannedVolumeMin: number; realizedVolumeMin: number; completedCount: number; missedCount: number; totalCount: number; maxVolumeMin: number },
  mesurees: string[],
  zones: TrainingZones,
  testLines: string[]
): string {
  const pastLines = pastSessions.length
    ? pastSessions
        .map(
          (s) =>
            `${formatDate(s.date)} ${s.sport} "${s.titre}" ${s.dureeMin}min${s.distanceKm ? ` ${s.distanceKm}km` : ""} → ${s.status}${s.ressenti ? ` (ressenti: ${s.ressenti})` : ""}`
        )
        .join("; ")
    : "aucune séance la semaine passée";

  return [
    ...profileLines(profile, phase, stats.maxVolumeMin, zones),
    ...mesurees,
    ...testLines,
    "",
    `Détail de LA SEMAINE QUI VIENT DE SE TERMINER : ${pastLines}`,
    `Bilan chiffré de cette semaine passée : ${stats.completedCount}/${stats.totalCount} séances complétées, ${stats.missedCount} manquée(s), volume réalisé ≈ ${Math.round(stats.realizedVolumeMin)} min (volume prévu était ${Math.round(stats.plannedVolumeMin)} min).`,
    "",
    `Génère le débrief de la semaine passée puis le programme de la nouvelle semaine, pour les 7 jours suivants (dans cet ordre) : ${weekDays(weekStart).join(", ")}`,
  ].join("\n");
}

function buildAdjustmentSystemPrompt(phase: Periodization, joursRestants: string[]): string {
  return [
    buildSystemPrompt(false, phase),
    "",
    "SITUATION PARTICULIÈRE — RÉAJUSTEMENT EN COURS DE SEMAINE.",
    `Tu ne régénères PAS la semaine entière : tu produis uniquement les ${joursRestants.length} jour(s) restant(s), à ces dates exactes : ${joursRestants.join(", ")}. N'inclus aucune autre date.`,
    "Le début de semaine est déjà vécu et ne peut pas être refait : tiens compte de ce qui a été réalisé ou manqué (détaillé dans le message utilisateur) pour redistribuer intelligemment ce qu'il reste.",
    "Ne cherche pas à rattraper tout le volume perdu : c'est le meilleur moyen de blesser un athlète. Priorise les séances les plus utiles à l'objectif, quitte à en abandonner définitivement certaines. Une semaine allégée assumée vaut mieux qu'une semaine surchargée.",
    "Si l'athlète explique pourquoi il n'a pas pu s'entraîner (fatigue, maladie, blessure, imprévu), prends-le au sérieux : en cas de douleur ou de maladie, propose du repos ou de la récupération active plutôt que de maintenir l'intensité.",
  ].join("\n");
}

function buildAdjustmentUserPrompt(
  profile: ProfileForPrompt,
  phase: Periodization,
  joursRestants: string[],
  dejaVecu: { date: Date; sport: string; titre: string; dureeMin: number; status: string; ressenti: string | null }[],
  maxVolumeMin: number,
  motif: string | null,
  mesurees: string[],
  zones: TrainingZones,
  testLines: string[]
): string {
  const bilan = dejaVecu.length
    ? dejaVecu
        .map(
          (s) =>
            `${formatDate(s.date)} ${s.sport} "${s.titre}" ${s.dureeMin}min → ${s.status}${s.ressenti ? ` (ressenti: ${s.ressenti})` : ""}`
        )
        .join("; ")
    : "aucune séance sur le début de semaine";

  const faites = dejaVecu.filter((s) => s.status === "faite");
  const manquees = dejaVecu.filter((s) => s.status === "manquee");

  return [
    ...profileLines(profile, phase, maxVolumeMin, zones),
    ...mesurees,
    ...testLines,
    "",
    `Début de semaine déjà vécu : ${bilan}`,
    `Bilan : ${faites.length} séance(s) réalisée(s) pour ${faites.reduce((sum, s) => sum + s.dureeMin, 0)} min, ${manquees.length} manquée(s).`,
    motif
      ? `L'athlète explique : « ${motif} »`
      : "L'athlète n'a pas précisé de raison.",
    "",
    `Réorganise uniquement les jours restants, à ces dates : ${joursRestants.join(", ")}`,
  ].join("\n");
}

/**
 * La réponse du modèle n'est jamais consommée telle quelle : sans validation,
 * une date absente ou mal formée produit un `Invalid Date` qui fait échouer
 * l'insertion Prisma bien plus loin, avec un message incompréhensible.
 */
export function parseAiPlan(raw: string, allowedDates: string[]): AiPlanResponse {
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("Réponse IA invalide (pas de JSON trouvé).");
  }

  let json: unknown;
  try {
    json = JSON.parse(jsonMatch[0]);
  } catch {
    throw new Error("Réponse IA invalide (JSON illisible ou tronqué).");
  }

  const parsed = aiPlanSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(`Réponse IA invalide (${parsed.error.issues[0]?.message ?? "format inattendu"}).`);
  }

  const allowed = new Set(allowedDates);
  const sessions = parsed.data.sessions.filter((s) => allowed.has(s.date));
  if (sessions.length === 0) {
    throw new Error("Réponse IA invalide (aucune séance sur la semaine demandée).");
  }

  return { ...parsed.data, sessions };
}

async function runGeneration(
  userId: string,
  kind: AiCallKind,
  system: string,
  userPrompt: string,
  allowedDates: string[]
): Promise<{ aiPlan: AiPlanResponse; raw: string }> {
  const attempts = 2;
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    let raw = "";
    try {
      const response = await askClaude({
        system,
        messages: [{ role: "user", content: userPrompt }],
        maxTokens: 8192,
      });
      raw = response.text;
      const aiPlan = parseAiPlan(raw, allowedDates);
      // Une tentative facturée compte, qu'elle aboutisse ou non : c'est ce qui
      // rend le coût affiché dans l'admin fidèle à la facture Anthropic.
      await recordAiCall({ userId, kind, response, succeeded: true });
      return { aiPlan, raw };
    } catch (err) {
      lastError = err;
      await recordAiCall({ userId, kind, model: MODEL, succeeded: false });
      console.error(
        `Tentative ${attempt}/${attempts} de génération échouée :`,
        err instanceof Error ? err.message : err,
        raw ? `\nRéponse brute (${raw.length} caractères) : ${raw.slice(0, 1000)}` : ""
      );
    }
  }

  throw lastError ?? new Error("Échec de la génération après plusieurs tentatives.");
}

async function loadUserContext(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { plan: true, createdAt: true, timezone: true },
  });
  if (!user) throw new HttpError(404, "Utilisateur introuvable.");
  return user;
}

async function requireGenerationAccess(userId: string) {
  if (!isAiConfigured()) {
    throw new HttpError(503, new AiNotConfiguredError().message);
  }
  const user = await loadUserContext(userId);
  if (!hasStandardAccess(user)) {
    throw new HttpError(
      402,
      "Votre période d'essai gratuite est terminée. Choisissez une offre pour continuer à générer votre programme.",
      "SUBSCRIPTION_REQUIRED"
    );
  }
  return user;
}

async function requireProfile(userId: string): Promise<ProfileForPrompt> {
  const profile = await prisma.athleteProfile.findUnique({ where: { userId } });
  if (!profile) {
    throw new HttpError(400, "Complétez d'abord votre profil (onboarding).");
  }
  return profile;
}

/**
 * Régénérer une semaine ne doit jamais effacer ce que l'athlète a déjà vécu :
 * seules les séances encore planifiées sont remplacées. Les séances faites ou
 * manquées restent rattachées à leur plan d'origine et donc à l'historique.
 */
export async function replacePlannedSessions(
  tx: Prisma.TransactionClient,
  userId: string,
  weekStart: Date,
  /** Ne remplacer qu'à partir de ce jour : sert au réajustement en cours de semaine. */
  fromDate?: Date
): Promise<void> {
  const existingPlans = await tx.trainingPlan.findMany({
    where: { userId, weekStart },
    select: { id: true },
  });
  if (existingPlans.length === 0) return;

  const planIds = existingPlans.map((p) => p.id);
  await tx.session.deleteMany({
    where: {
      planId: { in: planIds },
      status: "planifiee",
      ...(fromDate ? { date: { gte: fromDate } } : {}),
    },
  });

  const stillUsed = await tx.session.findMany({
    where: { planId: { in: planIds } },
    select: { planId: true },
    distinct: ["planId"],
  });
  const keep = new Set(stillUsed.map((s) => s.planId));
  const emptyPlanIds = planIds.filter((id) => !keep.has(id));
  if (emptyPlanIds.length > 0) {
    await tx.trainingPlan.deleteMany({ where: { id: { in: emptyPlanIds } } });
  }
}

async function persistPlan(params: {
  userId: string;
  weekStart: Date;
  raw: string;
  aiPlan: AiPlanResponse;
  phase: Periodization;
  replaceFrom?: Date;
}) {
  const { userId, weekStart, raw, aiPlan, phase, replaceFrom } = params;

  return prisma.$transaction(async (tx) => {
    await replacePlannedSessions(tx, userId, weekStart, replaceFrom);

    return tx.trainingPlan.create({
      data: {
        userId,
        weekStart,
        rawAiJson: raw,
        debrief: aiPlan.debrief ?? null,
        phase: phase.phase,
        sessions: {
          create: aiPlan.sessions.map((s) => ({
            userId,
            date: new Date(`${s.date}T00:00:00.000Z`),
            sport: s.sport,
            titre: s.titre,
            dureeMin: s.dureeMin,
            distanceKm: s.distanceKm ?? null,
            description: s.description ?? "",
            objectif: s.objectif ?? null,
            structure: s.structure ?? undefined,
          })),
        },
      },
      include: { sessions: { orderBy: { date: "asc" } } },
    });
  });
}

function planPayload(plan: { sessions: Parameters<typeof serializeSession>[0][] }, phase: Periodization) {
  return {
    ...plan,
    sessions: plan.sessions.map(serializeSession),
    periodization: { phase: phase.phase, label: phase.label, weeksToGoal: phase.weeksToGoal },
  };
}

/* ------------------------------------------------------------------ */
/* Génération en tâche de fond                                         */
/* ------------------------------------------------------------------ */

export type JobKind = "premiere_semaine" | "semaine_suivante" | "ajustement_semaine";

/** Au-delà, une tâche encore "en_cours" est considérée comme perdue. */
const JOB_STALE_MS = 10 * 60 * 1000;

interface PreparedGeneration {
  weekStart: Date;
  phase: Periodization;
  system: string;
  userPrompt: string;
  aiKind: AiCallKind;
  /** Jours que la génération est autorisée à produire. */
  allowedDates: string[];
  /** Borne de remplacement : les séances antérieures sont conservées. */
  replaceFrom?: Date;
}

/**
 * Réajustement en cours de semaine : seuls les jours à venir sont reconstruits.
 * Ce qui a déjà été vécu — réalisé comme manqué — est conservé, et sert
 * précisément à décider de la suite.
 */
async function prepareAdjustment(
  userId: string,
  timezone: string,
  profile: ProfileForPrompt,
  weekStart: Date,
  phase: Periodization,
  motif: string | null,
  zones: TrainingZones,
  facteurContexte: number,
  lignesContexte: string[]
): Promise<PreparedGeneration> {
  const aujourdHui = localCalendarDate(new Date(), timezone);
  const joursRestants = weekDays(weekStart).filter((jour) => jour >= aujourdHui);

  if (joursRestants.length <= 1) {
    throw new HttpError(
      400,
      "Il ne reste pas assez de jours cette semaine pour réajuster. Générez la semaine suivante lundi."
    );
  }

  const debutRestant = new Date(`${joursRestants[0]}T00:00:00.000Z`);
  const sessions = await prisma.session.findMany({
    where: { userId, date: { gte: weekStart, lt: addDays(weekStart, 7) } },
    orderBy: { date: "asc" },
  });
  if (sessions.length === 0) {
    throw new HttpError(400, "Aucun programme à réajuster cette semaine. Générez-en un d'abord.");
  }

  const dejaVecu = sessions.filter((s) => s.date < debutRestant && s.sport !== "repos");
  const volumeRealise = dejaVecu
    .filter((s) => s.status === "faite")
    .reduce((sum, s) => sum + s.dureeMin, 0);

  // Le volume restant est celui de la semaine moins ce qui a déjà été fait :
  // réajuster ne doit pas devenir un prétexte à s'entraîner davantage.
  const volumeSemaine = Math.round(profile.heuresSemaine * 60 * phase.volumeFactor * facteurContexte);
  const maxVolumeMin = Math.max(30, volumeSemaine - volumeRealise);

  const test = await planWeeklyTest(userId, weekStart, phase, profile, joursRestants);

  return {
    weekStart,
    phase,
    allowedDates: joursRestants,
    replaceFrom: debutRestant,
    aiKind: "plan_generation",
    system: buildAdjustmentSystemPrompt(phase, joursRestants),
    userPrompt: buildAdjustmentUserPrompt(
      profile,
      phase,
      joursRestants,
      dejaVecu,
      maxVolumeMin,
      motif,
      await measuredActivityLines(userId, weekStart),
      zones,
      [...(test ? testPromptLines(test) : []), ...lignesContexte]
    ),
  };
}

/**
 * Tout ce qui peut échouer immédiatement (abonnement, profil manquant, absence
 * de semaine précédente) est vérifié avant de créer la tâche : l'athlète reçoit
 * une erreur claire tout de suite, pas au bout de deux minutes d'attente.
 */
async function prepareGeneration(
  userId: string,
  kind: JobKind,
  motif: string | null = null
): Promise<PreparedGeneration> {
  const user = await requireGenerationAccess(userId);
  const profile = await requireProfile(userId);

  // Produire une semaine d'entraînement à quelqu'un qui s'est déclaré blessé
  // serait pire qu'inutile : c'est exactement ce qu'un coach ne ferait pas.
  const interruption = await pauseEnCours(userId);
  if (interruption) {
    throw new HttpError(
      400,
      "Votre entraînement est en pause. Indiquez que vous reprenez pour recevoir une nouvelle semaine, adaptée à votre retour.",
      "TRAINING_PAUSED"
    );
  }

  const weekStart = startOfWeek(new Date(), user.timezone);
  const phase = periodization(weekStart, profile.objectifDate);
  // Les zones sont calculées une seule fois, à partir du profil et de ce que
  // les séances importées révèlent (fréquence cardiaque maximale observée).
  const zones = computeTrainingZones(await buildZoneInputs(userId, profile));

  // Après un arrêt, le volume ne repart pas d'où il s'était arrêté : il remonte
  // par paliers sur quelques semaines.
  const dernierePause = await dernierePauseTerminee(userId, weekStart);
  const reprise = dernierePause ? etatDeReprise(dernierePause, weekStart) : null;
  const facteurReprise = reprise?.facteurVolume ?? 1;
  const lignesReprise = reprise ? reprisePromptLines(reprise, dernierePause?.detail ?? "") : [];

  // Le calendrier ne remplace pas la périodisation, il s'y insère : la phase
  // reste pilotée par la prochaine course A, et les courses B et C de la
  // semaine ajoutent leurs propres consignes.
  const courses = await coursesDeLAthlete(userId, weekStart);
  const lignesCourses = coursesPromptLines(courses, weekStart);
  const facteurCourses = facteurVolumeCourses(courses, weekStart) ?? 1;
  const facteurContexte = facteurReprise * facteurCourses;
  const lignesContexte = [...lignesReprise, ...lignesCourses];

  if (kind === "premiere_semaine") {
    const maxVolumeMin = Math.round(profile.heuresSemaine * 60 * phase.volumeFactor * facteurContexte);
    const recentSessions = await prisma.session.findMany({
      where: { userId, status: { in: ["faite", "manquee"] } },
      orderBy: { date: "desc" },
      take: 10,
      select: { date: true, sport: true, dureeMin: true, distanceKm: true, status: true, ressenti: true },
    });

    const test = await planWeeklyTest(userId, weekStart, phase, profile, weekDays(weekStart));

    return {
      weekStart,
      phase,
      allowedDates: weekDays(weekStart),
      aiKind: "plan_generation",
      system: buildSystemPrompt(false, phase),
      userPrompt: buildFirstWeekPrompt(
        profile,
        weekStart,
        phase,
        maxVolumeMin,
        recentSessions,
        await measuredActivityLines(userId, addDays(weekStart, -21)),
        zones,
        [...(test ? testPromptLines(test) : []), ...lignesContexte]
      ),
    };
  }

  if (kind === "ajustement_semaine") {
    return prepareAdjustment(userId, user.timezone, profile, weekStart, phase, motif, zones, facteurContexte, lignesContexte);
  }

  const previousPlan = await prisma.trainingPlan.findFirst({
    where: { userId, weekStart: { lt: weekStart } },
    orderBy: { weekStart: "desc" },
    include: { sessions: { orderBy: { date: "asc" } } },
  });
  if (!previousPlan) {
    throw new HttpError(400, "Aucune semaine précédente trouvée pour établir une progression.");
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
  // La progression de charge est plafonnée à +10%, puis la phase de
  // périodisation peut encore la réduire (affûtage, semaine de course).
  const maxVolumeMin = Math.round(baseVolumeMin * VOLUME_INCREASE_CAP * phase.volumeFactor * facteurContexte);

  const test = await planWeeklyTest(userId, weekStart, phase, profile, weekDays(weekStart));

  return {
    weekStart,
    phase,
    allowedDates: weekDays(weekStart),
    aiKind: "plan_progression",
    system: buildSystemPrompt(true, phase),
    userPrompt: buildProgressionPrompt(profile, weekStart, phase, nonRestSessions, {
      plannedVolumeMin,
      realizedVolumeMin,
      completedCount,
      missedCount,
      totalCount: nonRestSessions.length,
      maxVolumeMin,
    }, await measuredActivityLines(userId, addDays(weekStart, -14)), zones, [
    ...(test ? testPromptLines(test) : []),
    ...lignesContexte,
  ]),
  };
}

/**
 * Exécute la génération hors du cycle requête/réponse. Aucune exception ne doit
 * en sortir : l'échec est enregistré sur la tâche, que l'athlète consulte.
 */
async function processJob(jobId: string, userId: string, prepared: PreparedGeneration): Promise<void> {
  try {
    await prisma.generationJob.update({
      where: { id: jobId },
      data: { status: "en_cours", startedAt: new Date() },
    });

    const { aiPlan, raw } = await runGeneration(
      userId,
      prepared.aiKind,
      prepared.system,
      prepared.userPrompt,
      prepared.allowedDates
    );

    const plan = await persistPlan({
      userId,
      weekStart: prepared.weekStart,
      raw,
      aiPlan,
      phase: prepared.phase,
      replaceFrom: prepared.replaceFrom,
    });

    await prisma.generationJob.update({
      where: { id: jobId },
      data: { status: "reussie", planId: plan.id, endedAt: new Date() },
    });
  } catch (err) {
    console.error(`Génération ${jobId} échouée :`, err);
    await prisma.generationJob
      .update({
        where: { id: jobId },
        data: {
          status: "echouee",
          error:
            err instanceof HttpError
              ? err.message
              : "Le coach IA n'a pas réussi à produire un programme valide. Réessayez.",
          endedAt: new Date(),
        },
      })
      .catch((updateErr) => console.error("Impossible d'enregistrer l'échec de génération :", updateErr));
  }
}

function jobPayload(job: {
  id: string;
  kind: string;
  status: string;
  planId: string | null;
  error: string | null;
  createdAt: Date;
  startedAt: Date | null;
  endedAt: Date | null;
}) {
  // Une tâche laissée "en_cours" par un redémarrage du serveur ne se terminera
  // jamais : passé le délai, elle est présentée comme échouée plutôt que de
  // faire attendre l'athlète indéfiniment.
  const stale =
    (job.status === "en_cours" || job.status === "en_attente") &&
    Date.now() - (job.startedAt ?? job.createdAt).getTime() > JOB_STALE_MS;

  return {
    id: job.id,
    kind: job.kind,
    status: stale ? "echouee" : job.status,
    planId: job.planId,
    error: stale ? "La génération a été interrompue. Relancez-la." : job.error,
    createdAt: job.createdAt,
    endedAt: job.endedAt,
  };
}

async function findRunningJob(userId: string) {
  const job = await prisma.generationJob.findFirst({
    where: { userId, status: { in: ["en_attente", "en_cours"] } },
    orderBy: { createdAt: "desc" },
  });
  if (!job) return null;
  return jobPayload(job).status === "echouee" ? null : job;
}

async function launchGeneration(
  req: AuthedRequest,
  res: import("express").Response,
  kind: JobKind,
  motif: string | null = null
) {
  const userId = req.userId!;

  // Une seule génération à la fois : un double appui sur le bouton ne doit pas
  // déclencher deux appels facturés au modèle.
  const running = await findRunningJob(userId);
  if (running) {
    res.status(202).json(jobPayload(running));
    return;
  }

  const prepared = await prepareGeneration(userId, kind, motif);
  const job = await prisma.generationJob.create({ data: { userId, kind } });

  // Volontairement sans await : la réponse part immédiatement.
  void processJob(job.id, userId, prepared);

  res.status(202).json(jobPayload(job));
}

plansRouter.post(
  "/generate",
  generationRateLimit,
  ah(async (req: AuthedRequest, res) => launchGeneration(req, res, "premiere_semaine"))
);

plansRouter.post(
  "/next",
  generationRateLimit,
  ah(async (req: AuthedRequest, res) => launchGeneration(req, res, "semaine_suivante"))
);

const adjustSchema = z.object({
  motif: z.string().trim().max(300, "300 caractères maximum.").optional(),
});

/**
 * Réajuste les jours restants de la semaine en cours. Répond au cas le plus
 * fréquent de la vie réelle : l'athlète a manqué des séances et attendait
 * jusqu'ici le lundi suivant pour repartir sur un programme cohérent.
 */
plansRouter.post(
  "/adjust",
  generationRateLimit,
  ah(async (req: AuthedRequest, res) => {
    const parsed = adjustSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      throw new HttpError(400, parsed.error.issues[0]?.message ?? "Motif invalide.");
    }
    return launchGeneration(req, res, "ajustement_semaine", parsed.data.motif ?? null);
  })
);

/** Avancement de la dernière génération lancée : ce que le client interroge. */
plansRouter.get(
  "/jobs/latest",
  ah(async (req: AuthedRequest, res) => {
    const job = await prisma.generationJob.findFirst({
      where: { userId: req.userId! },
      orderBy: { createdAt: "desc" },
    });
    res.json(job ? jobPayload(job) : null);
  })
);

plansRouter.get(
  "/jobs/:id",
  ah(async (req: AuthedRequest, res) => {
    const job = await prisma.generationJob.findUnique({ where: { id: req.params.id } });
    if (!job || job.userId !== req.userId) {
      throw new HttpError(404, "Génération introuvable.");
    }
    res.json(jobPayload(job));
  })
);

plansRouter.get(
  "/previous",
  ah(async (req: AuthedRequest, res) => {
    const user = await loadUserContext(req.userId!);
    const weekStart = startOfWeek(new Date(), user.timezone);
    const previous = await prisma.trainingPlan.findFirst({
      where: { userId: req.userId!, weekStart: { lt: weekStart } },
      orderBy: { weekStart: "desc" },
    });
    res.json({ exists: Boolean(previous) });
  })
);

plansRouter.get(
  "/current",
  ah(async (req: AuthedRequest, res) => {
    const user = await loadUserContext(req.userId!);
    const weekStart = startOfWeek(new Date(), user.timezone);
    const weekEnd = addDays(weekStart, 7);

    const plan = await prisma.trainingPlan.findFirst({
      where: { userId: req.userId!, weekStart },
      orderBy: { generatedAt: "desc" },
    });
    if (!plan) {
      res.json(null);
      return;
    }

    // Les séances sont chargées par semaine et non par plan : une régénération
    // ou un réajustement laisse les séances déjà réalisées rattachées au plan
    // d'origine, et elles doivent rester visibles.
    const sessions = await prisma.session.findMany({
      where: { userId: req.userId!, date: { gte: weekStart, lt: weekEnd } },
      orderBy: { date: "asc" },
    });

    const profile = await prisma.athleteProfile.findUnique({
      where: { userId: req.userId! },
      select: { objectifDate: true },
    });
    const phase = profile
      ? periodization(weekStart, profile.objectifDate)
      : { phase: "base" as const, label: "Fondation aérobie", weeksToGoal: 0, volumeFactor: 1, guidance: "" };

    res.json(planPayload({ ...plan, sessions }, phase));
  })
);
