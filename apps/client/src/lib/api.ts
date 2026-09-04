import axios from "axios";

export const api = axios.create({
  baseURL: "/api",
  withCredentials: true,
});

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
  sessions: Session[];
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
  createdAt: string;
  trialEndsAt: string;
  isTrialActive: boolean;
  hasStandardAccess: boolean;
  isPremium: boolean;
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

export function isSubscriptionRequiredError(err: unknown): boolean {
  return (
    axios.isAxiosError(err) &&
    typeof err.response?.data === "object" &&
    (err.response?.data as { code?: string })?.code === "SUBSCRIPTION_REQUIRED"
  );
}
