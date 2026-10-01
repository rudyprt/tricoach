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

/**
 * Quotas quotidiens du chat coach, par offre.
 *
 * Ils ne protègent pas l'athlète mais la facture : chaque message part à l'API
 * avec le prompt système, les zones, la charge et l'historique, donc un échange
 * coûte bien plus que sa longueur apparente. Sans plafond, un seul compte peut
 * consommer en une soirée le revenu mensuel de son abonnement.
 *
 * Les valeurs sont volontairement supérieures à ce qu'un athlète utilise un
 * jour normal : le plafond doit arrêter la dérive, pas gêner l'usage.
 */
export const QUOTA_CHAT_STANDARD = 10;
export const QUOTA_CHAT_PREMIUM = 30;

/**
 * Le quota applicable à cet athlète.
 *
 * Un compte en essai, ou dont l'essai a expiré, relève du quota Standard : le
 * laisser sans plafond ferait du compte gratuit le plus coûteux de tous.
 */
export function quotaChatQuotidien(user: { plan: string }): number {
  return isPremium(user) ? QUOTA_CHAT_PREMIUM : QUOTA_CHAT_STANDARD;
}

/**
 * Fuseau de référence du quota. Fixe, et non celui de l'athlète : « remis à
 * zéro à minuit » doit désigner le même instant pour tout le monde, sans quoi
 * changer son fuseau dans son profil rouvrirait un quota déjà consommé.
 */
export const FUSEAU_QUOTA = "Europe/Paris";

export function planLabel(plan: string): string {
  if (plan === "premium") return "Premium";
  if (plan === "standard") return "Standard";
  return "Gratuit";
}
