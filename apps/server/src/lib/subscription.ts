/**
 * Deux semaines, et non une : l'intérêt du produit tient au renouvellement
 * hebdomadaire du programme, qui s'appuie sur les séances réalisées la semaine
 * précédente. Un essai de 7 jours ne permet pas d'en faire l'expérience.
 */
export const TRIAL_DAYS = 14;

export type Plan = "free" | "standard" | "premium";

interface PlanUser {
  plan: string;
  createdAt: Date;
}

export function trialEndsAt(createdAt: Date): Date {
  const d = new Date(createdAt);
  d.setDate(d.getDate() + TRIAL_DAYS);
  return d;
}

export function isTrialActive(createdAt: Date): boolean {
  return new Date() < trialEndsAt(createdAt);
}

/** Full access to plan generation, progress tracking and unlimited history. */
export function hasStandardAccess(user: PlanUser): boolean {
  return user.plan !== "free" || isTrialActive(user.createdAt);
}

export function isPremium(user: { plan: string }): boolean {
  return user.plan === "premium";
}

export const CHAT_DAILY_LIMIT = 15;

export function planLabel(plan: string): string {
  if (plan === "premium") return "Premium";
  if (plan === "standard") return "Standard";
  return "Gratuit";
}
