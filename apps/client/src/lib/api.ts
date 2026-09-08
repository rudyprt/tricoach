import axios from "axios";

export const api = axios.create({
  baseURL: "/api",
  withCredentials: true,
});

/**
 * Le serveur calcule la semaine d'entraînement et le quota quotidien dans le
 * fuseau de l'athlète : il est transmis à l'inscription et à chaque connexion.
 */
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
}

export interface TrainingZones {
  course: ZoneRange[] | null;
  natation: ZoneRange[] | null;
  velo: ZoneRange[] | null;
  notes: string[];
}

export interface ZonesResponse {
  zones: TrainingZones;
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

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

export type Plan = "free" | "standard" | "premium";

export interface CurrentUser {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  plan: Plan;
  timezone: string;
  createdAt: string;
  trialEndsAt: string;
  isTrialActive: boolean;
  hasStandardAccess: boolean;
  isPremium: boolean;
  /** false tant qu'aucun paiement n'est branché : l'app ne propose pas d'activer une offre. */
  selfServeBilling: boolean;
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
