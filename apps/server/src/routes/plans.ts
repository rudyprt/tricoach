import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { requireAuth, type AuthedRequest } from "../middleware/auth.js";
import { askClaude, isAiConfigured, AiNotConfiguredError } from "../lib/anthropic.js";
import { MAX_TOKENS, MODELE_PLAN } from "../lib/modeles.js";
import { resumeAthlete } from "../lib/resumeAthlete.js";
import { analysePromptLines } from "../lib/analyseCourse.js";
import { fcCourseTexte } from "../lib/fcCourses.js";
import { recordAiCall, type AiCallKind } from "../lib/aiUsage.js";
import { serializeSession, sessionStructureSchema } from "../lib/session.js";
import { hasStandardAccess } from "../lib/subscription.js";
import { ah, HttpError } from "../lib/http.js";
import { generationRateLimit } from "../lib/rateLimit.js";
import { addDays, formatDate, jourLocal, localCalendarDate, startOfWeek, weekDays } from "../lib/week.js";
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
import { bilanDeCharge, chargePromptLines } from "../lib/trainingLoad.js";
import { ajouterFrequencesCardiaques, corrigerCibles, rafraichirCibles } from "../lib/cibles.js";
import {
  disciplinesImposees,
  disponibilitesPromptLines,
  joursIndisponibles,
  materielPromptLines,
  parseDisponibilites,
  parseMateriel,
  volumeAtteignableMin,
} from "../lib/disponibilites.js";
import { DESCRIPTION_REPOS_DECLARE } from "../lib/reposDeclare.js";
import { describeActivity } from "../lib/activityMatching.js";
import { renfoPhaseLigne, renfoReglesLines } from "../lib/renforcement.js";
import { consignesActives, consignesPromptLines } from "../lib/consignesCoach.js";

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

/** Exporté pour le banc d'essai : il doit construire le prompt de production. */
export interface ProfileForPrompt {
  objectif: string;
  objectifDate: Date;
  objectifTemps?: string;
  objectifFinir?: boolean;
  tempsNatation: string;
  tempsVelo: string;
  tempsCourse: string;
  heuresSemaine: number;
  contraintes: string;
  ftpWatts: number | null;
  fcMoyNatation?: number | null;
  fcMaxNatation?: number | null;
  fcMoyVelo?: number | null;
  fcMaxVelo?: number | null;
  fcMoyCourse?: number | null;
  fcMaxCourse?: number | null;
  seuilCourseSecParKm: number | null;
  cssSecPer100m: number | null;
  fcSeuil: number | null;
  fcMax: number | null;
  customZones: unknown;
  disponibilites: unknown;
  materiel: unknown;
}

/**
 * Consignes de construction d'une semaine, les mêmes pour tous les athlètes et
 * toutes les phases : elles sont mises en cache. La phase, le débrief et tout
 * ce qui est propre à l'athlète arrivent après.
 */
export const CONSIGNES_PLAN = [
  "Tu es un coach de triathlon expérimenté et bienveillant. Tu construis des semaines d'entraînement personnalisées (natation, vélo, course à pied, renforcement) selon le niveau, l'objectif, le temps disponible, les blessures ou contraintes et l'historique récent de l'athlète.",
  "",
  "FORMAT — réponds UNIQUEMENT par un JSON valide, sans texte autour ni balises markdown :",
  `{"sessions":[{"date":"YYYY-MM-DD","sport":"natation|velo|course|renfo|repos","titre":"string","dureeMin":number,"distanceKm":number|null,"description":"string","objectif":null|"string","structure":null|{"echauffement":{"dureeMin":number,"cible":"string","description":"string"},"corps":{"dureeMin":number,"cible":"string","description":"string","exercices":[{"nom":"string","repetitions":"string","allure":"string","recuperation":"string","consigne":"string"}]},"retourCalme":{"dureeMin":number,"cible":"string","description":"string"}}}]}`,
  "Une entrée par date demandée dans le message utilisateur, ni plus ni moins, jours de repos compris (sport: repos, dureeMin: 0, objectif: null, structure: null).",
  "",
  "SÉANCES (sport != repos) :",
  "- \"objectif\" : 20 à 30 mots maximum, jamais plus, même pour une échéance lointaine. Écrit à l'athlète (« tu »), clair et motivant : pourquoi cette séance maintenant, quelle qualité elle développe, en quoi elle sert son objectif.",
  "- \"structure\" toujours remplie de 3 blocs : échauffement, corps de séance, retour au calme ; la somme de leurs dureeMin est proche de dureeMin.",
  "- \"cible\" : la zone (Z1 à Z5, nommée) ET sa valeur chiffrée, REPRISES EXACTEMENT des zones du message utilisateur, jamais recalculées ni inventées (le renforcement se dose en RPE, voir plus bas).",
  "- UNITÉS, sans jamais les mélanger : natation en temps aux 100 m (1:44/100m) ; course en allure au km (4:08/km) ; vélo selon les zones fournies — watts si une FTP est connue, sinon fréquence cardiaque, sinon km/h avec la sensation. Une allure au km dans un bassin ou des watts sans capteur sont inexécutables. Vaut aussi pour le champ \"allure\" des exercices.",
  "- UNE SEULE valeur chiffrée par cible, celle de la discipline : n'ajoute pas la fréquence cardiaque à une allure ou à une puissance, deux chiffres qui ne coïncident pas font douter des deux. La fréquence cardiaque n'est la cible que pour le vélo sans FTP.",
  "- \"corps.exercices\", seulement pour du fractionné (intervalles, répétitions) : 4 lignes maximum (sauf renforcement), concrètes et chiffrées, ex : [{\"repetitions\":\"6 x 400m\",\"allure\":\"4:10/km (Z4 seuil)\",\"recuperation\":\"90s trot\"}] ; \"nom\" et \"consigne\" sont réservés au renforcement. Sortie continue (endurance, sortie longue) : pas d'exercices, l'effort est décrit dans \"description\".",
  "- CONCISION partout : chaque \"description\" (séance et blocs) fait 15 mots maximum. Ne tronque jamais le JSON : si la place manque, raccourcis encore les textes.",
  "",
  "VOLUME — RÈGLE DE SÉCURITÉ ANTI-BLESSURE, stricte et non négociable : la somme des dureeMin des séances sport != repos respecte les heures disponibles et NE DÉPASSE JAMAIS le « volume maximum autorisé » du message utilisateur, même si l'athlète a déclaré davantage d'heures. Si son ressenti ou ses séances manquées suggèrent de la fatigue, n'augmente pas le volume : maintiens-le ou réduis-le légèrement.",
  ...renfoReglesLines(),
  "",
  "La PHASE DE PRÉPARATION indiquée ci-dessous prime sur toute autre considération de contenu : la semaine doit être cohérente avec elle.",
].join("\n");

/** Ce qui varie d'une génération à l'autre dans le prompt système : placé après le cache. */
export function contextePlan(includeDebrief: boolean, phase: Periodization): string {
  const lignes = [
    `PHASE DE PRÉPARATION — ${phase.label} (objectif dans ${phase.weeksToGoal} semaine(s)). ${phase.guidance}`,
    `Renforcement dans cette phase : ${renfoPhaseLigne(phase.phase)}`,
  ];
  if (includeDebrief) {
    lignes.push(
      "DÉBRIEF : ajoute en tout premier dans le JSON la clé \"debrief\" (string) : un message à l'athlète (« tu »), 60 à 90 mots, qui fait le bilan de LA SEMAINE QUI VIENT DE SE TERMINER (données du message utilisateur). Félicite ses efforts et sa régularité, cite 1 ou 2 réussites concrètes (séance clé, régularité, progrès visible), reste honnête et bienveillant sur les séances manquées sans culpabiliser, et finis par une phrase motivante sur la semaine à venir. Ton chaleureux, sans jargon."
    );
  }
  return lignes.join("\n");
}

/** Le prompt système complet, tel que le modèle le lit. */
export function buildSystemPrompt(includeDebrief: boolean, phase: Periodization): string {
  return `${CONSIGNES_PLAN}\n${contextePlan(includeDebrief, phase)}`;
}

/**
 * L'entraînement récent de l'athlète, résumé. Les séances ne partent plus une à
 * une : le volume, la tendance, les points faibles, le ressenti et les séances
 * clés mesurées en disent l'essentiel, en moins de 300 tokens.
 */
async function historiqueLines(userId: string, profile: ProfileForPrompt): Promise<string[]> {
  const resume = await resumeAthlete(userId, {
    avecProfil: false,
    refs: { ftpWatts: profile.ftpWatts, fcSeuil: profile.fcSeuil, fcMax: profile.fcMax },
  });
  return [
    "",
    "HISTORIQUE D'ENTRAÎNEMENT (calculé à partir des séances réalisées ; les mesures de la montre priment sur toute estimation) :",
    resume,
    "Si ses séances clés montrent qu'il va systématiquement plus vite ou plus lentement que la zone prévue, dis-le-lui et adapte.",
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
    /*
     * Terminer et viser un chrono ne s'entraînent pas pareil : le premier
     * demande de tenir la distance, le second du travail d'allure. Sans cette
     * ligne, le coach suppose un objectif de temps et prescrit des séances
     * dont l'athlète n'a pas besoin.
     */
    profile.objectifFinir
      ? "Intention sur cette course : LA TERMINER, sans objectif de temps. Construis l'entraînement autour de l'endurance et de la capacité à tenir la distance ; ne prescris pas de travail d'allure cible, et ne parle pas de chrono."
      : profile.objectifTemps
        ? `Temps visé sur cette course : ${profile.objectifTemps}. Oriente les séances spécifiques vers cette allure, et dis-lui quand une séance sert directement cet objectif.`
        : "Aucun temps visé renseigné : ne suppose pas de chrono, et reste sur une progression générale.",
    `Phase de préparation : ${phase.label}`,
    `Dernier temps natation : ${profile.tempsNatation || "non renseigné"}${fcCourseTexte(profile.fcMoyNatation, profile.fcMaxNatation)}`,
    `Dernier temps vélo : ${profile.tempsVelo || "non renseigné"}${fcCourseTexte(profile.fcMoyVelo, profile.fcMaxVelo)}`,
    `Dernier temps course à pied : ${profile.tempsCourse || "non renseigné"}${fcCourseTexte(profile.fcMoyCourse, profile.fcMaxCourse)}`,
    `Heures disponibles cette semaine : ${profile.heuresSemaine}h`,
    `Volume maximum autorisé pour cette semaine : ${maxVolumeMin} minutes (limite stricte, anti-blessure).`,
    `Blessures / contraintes : ${profile.contraintes || "aucune"}`,
    "",
    "Zones d'entraînement de l'athlète (calculées à partir de ses temps de référence — à reprendre telles quelles) :",
    formatZonesForPrompt(zones),
  ];
}

/**
 * Les dates de la toute première semaine.
 *
 * Elle commence le jour de l'inscription, pas le lundi : un athlète inscrit un
 * vendredi recevait un programme du lundi au dimanche dont quatre jours étaient
 * déjà passés — une semaine à moitié périmée, et deux jours d'essai dépensés
 * pour rien.
 *
 * Le dimanche fait exception : une « semaine » d'un seul jour ne montre rien du
 * produit, et c'est la semaine suivante qui est produite.
 */
export function fenetrePremiereSemaine(
  weekStart: Date,
  aujourdHui: string
): { debut: Date; dates: string[] } {
  const restants = weekDays(weekStart).filter((jour) => jour >= aujourdHui);
  if (restants.length >= 2 && restants.length < 7) {
    return { debut: weekStart, dates: restants };
  }
  const debut = restants.length === 7 ? weekStart : addDays(weekStart, 7);
  return { debut, dates: weekDays(debut) };
}

export function buildFirstWeekPrompt(
  profile: ProfileForPrompt,
  dates: string[],
  phase: Periodization,
  maxVolumeMin: number,
  historique: string[],
  zones: TrainingZones,
  testLines: string[]
): string {
  return [
    ...profileLines(profile, phase, maxVolumeMin, zones),
    ...historique,
    ...testLines,
    "",
    `Génère le programme pour les ${dates.length} jour(s) suivant(s) (dans cet ordre) : ${dates.join(", ")}`,
    ...(dates.length < 7
      ? [
          "Cette première semaine est déjà entamée : l'athlète vient de créer son compte. Le volume indiqué tient déjà compte des jours restants — ne cherche pas à rattraper les jours passés, et ne place pas la sortie longue un jour qui ne s'y prête pas.",
        ]
      : []),
  ].join("\n");
}

function buildProgressionPrompt(
  profile: ProfileForPrompt,
  weekStart: Date,
  phase: Periodization,
  pastSessions: { date: Date; sport: string; titre: string; dureeMin: number; distanceKm: number | null; status: string; ressenti: string | null }[],
  stats: { plannedVolumeMin: number; realizedVolumeMin: number; completedCount: number; missedCount: number; totalCount: number; maxVolumeMin: number },
  historique: string[],
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
    ...historique,
    ...testLines,
    "",
    `Détail de LA SEMAINE QUI VIENT DE SE TERMINER : ${pastLines}`,
    `Bilan chiffré de cette semaine passée : ${stats.completedCount}/${stats.totalCount} séances complétées, ${stats.missedCount} manquée(s), volume réalisé ≈ ${Math.round(stats.realizedVolumeMin)} min (volume prévu était ${Math.round(stats.plannedVolumeMin)} min).`,
    "",
    `Génère le débrief de la semaine passée puis le programme de la nouvelle semaine, pour les 7 jours suivants (dans cet ordre) : ${weekDays(weekStart).join(", ")}`,
  ].join("\n");
}

/** Réajustement : les consignes de construction, puis ce qui est propre à cette situation. */
export const CONSIGNES_AJUSTEMENT = [
  CONSIGNES_PLAN,
  "",
  "SITUATION PARTICULIÈRE — RÉAJUSTEMENT EN COURS DE SEMAINE.",
  "Tu ne régénères PAS la semaine entière : tu produis uniquement les jours restants, aux dates exactes données dans le message utilisateur, et aucune autre.",
  "Le début de semaine est déjà vécu : tiens compte de ce qui a été réalisé ou manqué pour redistribuer intelligemment ce qu'il reste.",
  "Ne cherche pas à rattraper tout le volume perdu : c'est le meilleur moyen de blesser un athlète. Priorise les séances les plus utiles à l'objectif, quitte à en abandonner certaines. Une semaine allégée assumée vaut mieux qu'une semaine surchargée.",
  "Si l'athlète explique pourquoi il n'a pas pu s'entraîner (fatigue, maladie, blessure, imprévu), prends-le au sérieux : douleur ou maladie appellent du repos ou de la récupération active, pas de l'intensité.",
].join("\n");

function buildAdjustmentUserPrompt(
  profile: ProfileForPrompt,
  phase: Periodization,
  joursRestants: string[],
  dejaVecu: { date: Date; sport: string; titre: string; dureeMin: number; status: string; ressenti: string | null }[],
  maxVolumeMin: number,
  motif: string | null,
  historique: string[],
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
    ...historique,
    ...testLines,
    "",
    `Début de semaine déjà vécu : ${bilan}`,
    `Bilan : ${faites.length} séance(s) réalisée(s) pour ${faites.reduce((sum, s) => sum + s.dureeMin, 0)} min, ${manquees.length} manquée(s).`,
    motif
      ? `L'athlète explique : « ${motif} »`
      : "L'athlète n'a pas précisé de raison.",
    "",
    `Réorganise uniquement les ${joursRestants.length} jour(s) restant(s), à ces dates et à aucune autre : ${joursRestants.join(", ")}`,
  ].join("\n");
}

/**
 * La réponse du modèle n'est jamais consommée telle quelle : sans validation,
 * une date absente ou mal formée produit un `Invalid Date` qui fait échouer
 * l'insertion Prisma bien plus loin, avec un message incompréhensible.
 */
export function parseAiPlan(
  raw: string,
  allowedDates: string[],
  datesRepos: ReadonlySet<string> = new Set()
): AiPlanResponse {
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
  const sessions = parsed.data.sessions
    .filter((s) => allowed.has(s.date))
    // Un jour déclaré indisponible reste un jour de repos, quoi qu'ait produit
    // le modèle : la consigne du prompt ne suffit pas à le garantir, et une
    // séance ce jour-là ne sera de toute façon pas faite.
    .map((s) =>
      datesRepos.has(s.date) && s.sport !== "repos"
        ? {
            ...s,
            sport: "repos" as const,
            titre: "Repos",
            dureeMin: 0,
            distanceKm: null,
            description: DESCRIPTION_REPOS_DECLARE,
            objectif: null,
            structure: null,
          }
        : s
    );
  if (sessions.length === 0) {
    throw new Error("Réponse IA invalide (aucune séance sur la semaine demandée).");
  }

  return { ...parsed.data, sessions };
}

async function runGeneration(
  userId: string,
  kind: AiCallKind,
  etiquette: string,
  prompt: { system: string; contexte: string },
  userPrompt: string,
  allowedDates: string[],
  datesRepos: ReadonlySet<string> = new Set()
): Promise<{ aiPlan: AiPlanResponse; raw: string }> {
  const attempts = 2;
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    let raw = "";
    try {
      const response = await askClaude({
        modele: MODELE_PLAN,
        etiquette,
        system: prompt.system,
        contexte: prompt.contexte,
        messages: [{ role: "user", content: userPrompt }],
        maxTokens: etiquette === "plan_ajustement" ? MAX_TOKENS.ajustement : MAX_TOKENS.plan,
      });
      raw = response.text;
      const aiPlan = parseAiPlan(raw, allowedDates, datesRepos);
      // Une tentative facturée compte, qu'elle aboutisse ou non : c'est ce qui
      // rend le coût affiché dans l'admin fidèle à la facture Anthropic.
      await recordAiCall({ userId, kind, response, succeeded: true });
      return { aiPlan, raw };
    } catch (err) {
      lastError = err;
      await recordAiCall({ userId, kind, model: MODELE_PLAN, succeeded: false });
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

/**
 * `zones` remet les intensités des séances encore à faire sur les zones du
 * moment : un test de terrain les recale, et une séance écrite avant lui
 * afficherait sinon une allure périmée. Le rafraîchissement porte sur la
 * structure déjà validée, la colonne JSON brute n'étant pas typée.
 */
function planPayload(
  plan: { sessions: Parameters<typeof serializeSession>[0][] },
  phase: Periodization,
  zones?: TrainingZones
) {
  const sessions = plan.sessions.map(serializeSession);
  return {
    ...plan,
    sessions: zones ? ajouterFrequencesCardiaques(rafraichirCibles(sessions, zones).seances, zones) : sessions,
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
  /** Consignes communes à tous les athlètes, mises en cache. */
  system: string;
  /** Partie variable du prompt système : phase, débrief. */
  contexte: string;
  userPrompt: string;
  aiKind: AiCallKind;
  /** Jours que la génération est autorisée à produire. */
  allowedDates: string[];
  /** Jours déclarés indisponibles : forcés en repos après génération. */
  datesRepos: string[];
  /** Zones de l'athlète, pour rétablir les unités que le modèle aurait mélangées. */
  zones: TrainingZones;
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
  lignesContexte: string[],
  datesRepos: string[],
  /** Dates dont l'athlète a réservé la discipline, pour le choix du jour de test. */
  datesImposees: string[],
  plafondCreneaux: number | null
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
    .reduce((sum, s) => sum + (s.dureeReelleMin ?? s.dureeMin), 0);

  // Le volume restant est celui de la semaine moins ce qui a déjà été fait :
  // réajuster ne doit pas devenir un prétexte à s'entraîner davantage.
  const volumeBrut = Math.round(profile.heuresSemaine * 60 * phase.volumeFactor * facteurContexte);
  const volumeSemaine = plafondCreneaux ? Math.min(volumeBrut, plafondCreneaux) : volumeBrut;
  const maxVolumeMin = Math.max(30, volumeSemaine - volumeRealise);

  const test = await planWeeklyTest(userId, weekStart, phase, profile, joursRestants, new Set(datesRepos), new Set(datesImposees));

  return {
    weekStart,
    phase,
    allowedDates: joursRestants,
    datesRepos: datesRepos.filter((d) => joursRestants.includes(d)),
    zones,
    replaceFrom: debutRestant,
    aiKind: "plan_generation",
    system: CONSIGNES_AJUSTEMENT,
    contexte: contextePlan(false, phase),
    userPrompt: buildAdjustmentUserPrompt(
      profile,
      phase,
      joursRestants,
      dejaVecu,
      maxVolumeMin,
      motif,
      await historiqueLines(userId, profile),
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

  /*
   * Le dimanche soir, le rappel invite à préparer la semaine : celle qui
   * commence le lendemain, pas celle qui s'achève. Sans ce décalage, le
   * bouton régénérait la semaine finissante et la nouvelle restait
   * introuvable jusqu'au lundi.
   */
  const cetteSemaine = startOfWeek(new Date(), user.timezone);
  const weekStart =
    kind === "semaine_suivante" && jourLocal(new Date(), user.timezone) === 7 ? addDays(cetteSemaine, 7) : cetteSemaine;
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
  // La charge accumulée dit ce que le volume des sept derniers jours ne dit
  // pas : avec quelle fatigue l'athlète aborde la semaine.
  const charge = await bilanDeCharge(userId);

  // Les créneaux déclarés ne sont pas une préférence, ce sont des bornes : le
  // volume ne peut pas dépasser ce qui tient dedans.
  const disponibilites = parseDisponibilites(profile.disponibilites);
  const materiel = parseMateriel(profile.materiel);
  const datesRepos = joursIndisponibles(disponibilites, weekStart);
  const plafondCreneaux = volumeAtteignableMin(disponibilites);

  const facteurContexte = facteurReprise * facteurCourses;
  const lignesContexte = [
    ...lignesReprise,
    ...lignesCourses,
    ...chargePromptLines(charge),
    ...disponibilitesPromptLines(disponibilites, weekStart),
    ...materielPromptLines(materiel),
    // Ce que l'athlète a demandé au coach dans le chat : sans ces lignes, la
    // génération ignorait tout ce qui s'y disait.
    ...consignesPromptLines(await consignesActives(userId, user.timezone)),
    // Ce que la dernière course a révélé : l'entraînement s'y attaque.
    ...analysePromptLines(
      await prisma.race.findFirst({
        where: { userId, analyse: { not: Prisma.DbNull }, date: { gte: addDays(weekStart, -56), lt: weekStart } },
        orderBy: { date: "desc" },
        select: { nom: true, date: true, analyse: true },
      })
    ),
  ];

  /** Applique le plafond des créneaux au volume calculé par la périodisation. */
  const borner = (volume: number) => (plafondCreneaux ? Math.min(volume, plafondCreneaux) : volume);

  if (kind === "premiere_semaine") {
    /*
     * La première semaine commence le jour de l'inscription, pas le lundi.
     *
     * Un athlète inscrit un vendredi recevait un programme du lundi au
     * dimanche, dont quatre jours étaient déjà passés : une première semaine à
     * moitié périmée, et deux jours d'essai dépensés pour rien. Il ne reçoit
     * plus que les jours qu'il peut encore faire.
     *
     * Le dimanche fait exception : une « semaine » d'un seul jour ne montre
     * rien du produit. Mieux vaut lui donner la semaine qui commence demain.
     */
    const { debut, dates } = fenetrePremiereSemaine(weekStart, localCalendarDate(new Date(), user.timezone));

    /* Le volume suit le nombre de jours : y verser une semaine entière serait
     * le meilleur moyen de blesser quelqu'un dès son inscription. */
    const volumeSemaine = profile.heuresSemaine * 60 * phase.volumeFactor * facteurContexte;
    const maxVolumeMin = borner(Math.round((volumeSemaine * dates.length) / 7));

    const datesReposFenetre = joursIndisponibles(disponibilites, debut).filter((d) => dates.includes(d));
    const test = await planWeeklyTest(userId, debut, phase, profile, dates, new Set(datesReposFenetre), new Set(disciplinesImposees(disponibilites, debut).keys()));

    return {
      weekStart: debut,
      phase,
      allowedDates: dates,
      datesRepos: datesReposFenetre,
      zones,
      aiKind: "plan_generation",
      system: CONSIGNES_PLAN,
      contexte: contextePlan(false, phase),
      userPrompt: buildFirstWeekPrompt(
        profile,
        dates,
        phase,
        maxVolumeMin,
        await historiqueLines(userId, profile),
        zones,
        [...(test ? testPromptLines(test) : []), ...lignesContexte]
      ),
    };
  }

  if (kind === "ajustement_semaine") {
    return prepareAdjustment(
      userId,
      user.timezone,
      profile,
      weekStart,
      phase,
      motif,
      zones,
      facteurContexte,
      lignesContexte,
      datesRepos,
      [...disciplinesImposees(disponibilites, weekStart).keys()],
      plafondCreneaux
    );
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
    // La durée corrigée prime : faire repartir la progression du volume prévu
    // alors que l'athlète a écourté ses sorties le pousserait trop haut.
    .reduce((sum, s) => sum + (s.dureeReelleMin ?? s.dureeMin), 0);
  const completedCount = nonRestSessions.filter((s) => s.status === "faite").length;
  const missedCount = nonRestSessions.filter((s) => s.status === "manquee").length;

  const baseVolumeMin =
    realizedVolumeMin > 0 ? realizedVolumeMin : plannedVolumeMin > 0 ? plannedVolumeMin : profile.heuresSemaine * 60;
  // La progression de charge est plafonnée à +10%, puis la phase de
  // périodisation peut encore la réduire (affûtage, semaine de course).
  const maxVolumeMin = borner(Math.round(baseVolumeMin * VOLUME_INCREASE_CAP * phase.volumeFactor * facteurContexte));

  const test = await planWeeklyTest(userId, weekStart, phase, profile, weekDays(weekStart), new Set(datesRepos), new Set(disciplinesImposees(disponibilites, weekStart).keys()));

  return {
    weekStart,
    phase,
    allowedDates: weekDays(weekStart),
    datesRepos,
    zones,
    aiKind: "plan_progression",
    system: CONSIGNES_PLAN,
    contexte: contextePlan(true, phase),
    userPrompt: buildProgressionPrompt(profile, weekStart, phase, nonRestSessions, {
      plannedVolumeMin,
      realizedVolumeMin,
      completedCount,
      missedCount,
      totalCount: nonRestSessions.length,
      maxVolumeMin,
    }, await historiqueLines(userId, profile), zones, [
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
      prepared.replaceFrom ? "plan_ajustement" : prepared.aiKind,
      { system: prepared.system, contexte: prepared.contexte },
      prepared.userPrompt,
      prepared.allowedDates,
      new Set(prepared.datesRepos)
    );

    // Le modèle mélange parfois les unités d'une discipline à l'autre. Le
    // serveur connaît la bonne valeur pour chaque zone : il la rétablit plutôt
    // que de livrer à l'athlète une allure au kilomètre dans un bassin.
    const { seances, corrections } = corrigerCibles(aiPlan.sessions, prepared.zones);
    if (corrections.length > 0) {
      console.warn(
        `[cibles] ${corrections.length} unité(s) rétablie(s) pour ${userId} :`,
        corrections.map((c) => `${c.sport} ${c.bloc} « ${c.avant} » → « ${c.apres} »`).join(" ; ")
      );
    }

    const plan = await persistPlan({
      userId,
      weekStart: prepared.weekStart,
      raw,
      aiPlan: { ...aiPlan, sessions: seances },
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
    const cetteSemaine = startOfWeek(new Date(), user.timezone);
    const semaineSuivante = addDays(cetteSemaine, 7);

    /*
     * Inscrit un dimanche, l'athlète reçoit la semaine qui commence le
     * lendemain : il ne restait qu'un jour dans la sienne. Sans ce repli, son
     * écran restait vide jusqu'au lundi, programme pourtant prêt.
     */
    const planDe = (weekStart: Date) =>
      prisma.trainingPlan.findFirst({ where: { userId: req.userId!, weekStart }, orderBy: { generatedAt: "desc" } });
    // « ?semaine=suivante » : la semaine préparée le dimanche, consultée avant son début.
    const plan =
      req.query.semaine === "suivante"
        ? await planDe(semaineSuivante)
        : ((await planDe(cetteSemaine)) ?? (await planDe(semaineSuivante)));
    if (!plan) {
      res.json(null);
      return;
    }

    const weekStart = plan.weekStart;
    const weekEnd = addDays(weekStart, 7);

    // Les séances sont chargées par semaine et non par plan : une régénération
    // ou un réajustement laisse les séances déjà réalisées rattachées au plan
    // d'origine, et elles doivent rester visibles.
    const sessions = await prisma.session.findMany({
      where: { userId: req.userId!, date: { gte: weekStart, lt: weekEnd } },
      orderBy: { date: "asc" },
    });

    const profile = await prisma.athleteProfile.findUnique({ where: { userId: req.userId! } });
    const phase = profile
      ? periodization(weekStart, profile.objectifDate)
      : { phase: "base" as const, label: "Fondation aérobie", weeksToGoal: 0, volumeFactor: 1, guidance: "" };

    // Un test de terrain recale les seuils, donc les zones — mais les séances
    // de la semaine sont déjà écrites. Celles qui restent à faire suivent les
    // zones du moment ; celles déjà vécues gardent ce qui avait été prescrit.
    const zones = profile ? computeTrainingZones(await buildZoneInputs(req.userId!, profile)) : undefined;

    res.json(planPayload({ ...plan, sessions }, phase, zones));
  })
);
