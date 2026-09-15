import axios from "axios";

export const api = axios.create({
  baseURL: "/api",
  withCredentials: true,
});

/**
 * Le serveur calcule la semaine d'entraînement et le quota quotidien dans le
 * fuseau de l'athlète : il est transmis à l'inscription et à chaque connexion.
 */
/**
 * URL de la photo de profil. La date de mise à jour sert de cache-buster :
 * l'image est mise en cache un jour par le navigateur, mais une nouvelle photo
 * s'affiche immédiatement.
 */
export function avatarUrl(user: { avatarUpdatedAt: string | null } | null): string | null {
  if (!user?.avatarUpdatedAt) return null;
  return `/api/auth/avatar/me?v=${encodeURIComponent(user.avatarUpdatedAt)}`;
}

export function browserTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

export interface AthleteProfile {
  id: string;
  userId: string;
  objectif: string;
  objectifDate: string;
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
}

export type TrainingPhase =
  | "base"
  | "developpement"
  | "specifique"
  | "affutage"
  | "course"
  | "transition";

export interface Periodization {
  phase: TrainingPhase;
  label: string;
  weeksToGoal: number;
}

export interface ZoneRange {
  zone: string;
  label: string;
  value: string;
  /** true si la valeur a été saisie par l'athlète et non calculée. */
  custom?: boolean;
}

export type ZoneSport = "course" | "natation" | "velo";

/** Corrections manuelles : { course: { Z2: "5:30/km" }, ... }. */
export type ZoneOverrides = Partial<Record<ZoneSport, Record<string, string>>>;

export interface TrainingZones {
  course: ZoneRange[] | null;
  natation: ZoneRange[] | null;
  velo: ZoneRange[] | null;
  /** Zones de fréquence cardiaque, communes aux trois disciplines. */
  frequenceCardiaque: ZoneRange[] | null;
  notes: string[];
}

export interface ZonesResponse {
  zones: TrainingZones;
  /** Zones telles que calculées, sans les corrections : sert à y revenir. */
  computedZones: TrainingZones;
  overrides: ZoneOverrides;
  /** Proposition de FTP tirée des séances importées, jamais appliquée seule. */
  ftpSuggere: { puissanceMoy: number; ftpSuggere: number } | null;
  periodization: Periodization;
}

export interface SessionExercise {
  repetitions: string;
  allure: string;
  recuperation?: string;
}

export interface SessionBlock {
  dureeMin: number;
  cible: string;
  description: string;
  exercices?: SessionExercise[];
}

export interface SessionStructure {
  echauffement: SessionBlock;
  corps: SessionBlock;
  retourCalme: SessionBlock;
}

export interface Session {
  id: string;
  planId: string;
  date: string;
  sport: "natation" | "velo" | "course" | "renfo" | "repos";
  titre: string;
  dureeMin: number;
  distanceKm: number | null;
  description: string;
  objectif: string | null;
  structure: SessionStructure | null;
  status: "planifiee" | "faite" | "manquee";
  ressenti: string | null;
  completedAt: string | null;
}

export interface TrainingPlan {
  id: string;
  userId: string;
  weekStart: string;
  generatedAt: string;
  debrief: string | null;
  phase: TrainingPhase | null;
  sessions: Session[];
  periodization: Periodization;
}

export type GenerationStatus = "en_attente" | "en_cours" | "reussie" | "echouee";

export interface GenerationJob {
  id: string;
  kind: "premiere_semaine" | "semaine_suivante" | "ajustement_semaine";
  status: GenerationStatus;
  planId: string | null;
  error: string | null;
  createdAt: string;
  endedAt: string | null;
}

export function isGenerationRunning(job: GenerationJob | null): boolean {
  return job?.status === "en_attente" || job?.status === "en_cours";
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

export type Plan = "free" | "standard" | "premium";

export type UserRole = "athlete" | "admin";

export interface CurrentUser {
  id: string;
  email: string;
  name: string;
  /** Date du dernier changement de photo, ou null si aucune photo. */
  avatarUpdatedAt: string | null;
  plan: Plan;
  role: UserRole;
  timezone: string;
  createdAt: string;
  trialEndsAt: string;
  isTrialActive: boolean;
  /** Durée de l'essai, décidée par le serveur. */
  trialDays: number;
  hasStandardAccess: boolean;
  isPremium: boolean;
  /** false tant qu'aucun paiement n'est branché : l'app ne propose pas d'activer une offre. */
  selfServeBilling: boolean;
  emailVerified: boolean;
  /** true quand les conditions ont changé depuis la dernière acceptation. */
  needsConsent: boolean;
  profile: AthleteProfile | null;
}

export const CHAT_DAILY_LIMIT = 15;

export function apiErrorMessage(err: unknown, fallback: string): string {
  if (axios.isAxiosError(err) && err.response?.data && typeof err.response.data === "object") {
    const data = err.response.data as { error?: string };
    if (data.error) return data.error;
  }
  return fallback;
}

function hasErrorCode(err: unknown, code: string): boolean {
  return (
    axios.isAxiosError(err) &&
    typeof err.response?.data === "object" &&
    (err.response?.data as { code?: string })?.code === code
  );
}

export function isSubscriptionRequiredError(err: unknown): boolean {
  return hasErrorCode(err, "SUBSCRIPTION_REQUIRED");
}

export function isBillingUnavailableError(err: unknown): boolean {
  return hasErrorCode(err, "BILLING_UNAVAILABLE");
}

export function isRateLimitError(err: unknown): boolean {
  return axios.isAxiosError(err) && err.response?.status === 429;
}


/* ------------------------------------------------------------------ */
/* Administration                                                      */
/* ------------------------------------------------------------------ */

export interface StravaStatus {
  /** false si l'application n'a pas d'identifiants Strava : rien ne s'affiche. */
  disponible: boolean;
  relie: boolean;
  athleteName: string | null;
  lastSyncAt: string | null;
  activitesImportees: number;
}

export interface Activity {
  id: string;
  sport: string;
  name: string;
  startedAt: string;
  dureeMin: number;
  distanceKm: number | null;
  denivelePosM: number | null;
  fcMoyenne: number | null;
  puissanceMoy: number | null;
  allureSecParKm: number | null;
  sessionId: string | null;
}

export function formatAllure(secParKm: number): string {
  const minutes = Math.floor(secParKm / 60);
  const secondes = secParKm % 60;
  return `${minutes}:${String(secondes).padStart(2, "0")}/km`;
}

export interface SessionPage {
  sessions: Session[];
  nextCursor: string | null;
}

export interface ChatPage {
  messages: ChatMessage[];
  hasMore: boolean;
  oldestAt: string | null;
}

export interface AdminOverview {
  comptes: {
    total: number;
    parOffre: Record<Plan, number>;
    payants: number;
    tauxConversionPct: number;
    essaisEnCours: number;
    essaisExpiresNonConvertis: number;
    inscriptions7j: number;
    inscriptions30j: number;
  };
  frequentation: {
    actifs24h: number;
    actifs7j: number;
    actifs30j: number;
    jamaisRevenus: number;
    retention30jPct: number;
  };
  activite: {
    programmesGeneres30j: number;
    athletesAvecObjectifAVenir: number;
  };
  configuration: {
    emailsActifs: boolean;
    coachIaActif: boolean;
    paiementEnLigneActif: boolean;
    stravaActif: boolean;
  };
  coutIa: {
    totalMicroUsd: number;
    total30jMicroUsd: number;
    appelsTotal: number;
    appels30j: number;
    tokensEntree: number;
    tokensSortie: number;
    coutMoyenParPayant30jMicroUsd: number;
    parType: { kind: string; appels: number; coutMicroUsd: number }[];
    tarifsMisAJourLe: string;
  };
}

export interface AdminActivityDay {
  date: string;
  inscriptions: number;
  actifs: number;
  coutMicroUsd: number;
}

export interface AdminUserRow {
  id: string;
  email: string;
  name: string;
  plan: Plan;
  role: UserRole;
  timezone: string;
  createdAt: string;
  lastSeenAt: string | null;
  trialEndsAt: string;
  isTrialActive: boolean;
  /** Durée de l'essai, décidée par le serveur. */
  trialDays: number;
  hasStandardAccess: boolean;
  coutIaMicroUsd: number;
  profile: { objectif: string; objectifDate: string } | null;
  _count: { sessions: number; trainingPlans: number; chatMessages: number };
}

export interface AdminUserList {
  total: number;
  page: number;
  perPage: number;
  pages: number;
  users: AdminUserRow[];
}

export interface AdminAuditEntry {
  id: string;
  action: string;
  details: Record<string, unknown> | null;
  createdAt: string;
  admin: { id: string; email: string; name: string };
  targetUser: { id: string; email: string; name: string } | null;
}

/** Les montants circulent en micro-dollars pour éviter les arrondis flottants. */
export function formatUsd(microUsd: number): string {
  const dollars = microUsd / 1_000_000;
  if (dollars > 0 && dollars < 0.01) return "< 0,01 $";
  return `${dollars.toFixed(2).replace(".", ",")} $`;
}

/**
 * Test de terrain programmé par le coach. Son résultat sert à recaler les
 * valeurs de seuil, donc toutes les zones, sur le niveau réel du moment.
 */
export interface FitnessTest {
  id: string;
  sport: "course" | "velo" | "natation";
  kind: string;
  date: string;
  status: "planifie" | "realise" | "abandonne";
  titre: string;
  protocole: string;
  mesures: string;
  resultat: {
    distanceM: number | null;
    puissanceMoy: number | null;
    temps400S: number | null;
    temps200S: number | null;
    fcMoyenne: number | null;
  };
  resume: string | null;
}

export interface FitnessTestsResponse {
  enCours: FitnessTest[];
  historique: FitnessTest[];
}
