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
  notes: string[];
}

export interface ZonesResponse {
  zones: TrainingZones;
  /** Zones telles que calculées, sans les corrections : sert à y revenir. */
  computedZones: TrainingZones;
  overrides: ZoneOverrides;
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
  kind: "premiere_semaine" | "semaine_suivante";
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
