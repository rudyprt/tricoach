import { env, isProduction } from "./env.js";
import type { Plan } from "./subscription.js";

export const PAID_PLANS: Plan[] = ["standard", "premium"];

export function isPaidPlan(plan: Plan): boolean {
  return PAID_PLANS.includes(plan);
}

/**
 * Aucun prestataire de paiement n'est encore branché. Tant que c'est le cas,
 * autoriser un simple PATCH à passer un compte en Premium revient à offrir
 * l'abonnement : l'activation d'une offre payante depuis l'application est donc
 * refusée par défaut. `BILLING_MODE=open` réactive le comportement direct pour
 * le développement et les démos.
 */
export function canSelfActivatePaidPlan(): boolean {
  return env().BILLING_MODE === "open";
}

export function billingUnavailableMessage(): string {
  return isProduction()
    ? "Le paiement en ligne n'est pas encore disponible. Contactez-nous pour activer votre abonnement."
    : "Activation directe désactivée (BILLING_MODE=disabled). Passez BILLING_MODE=open dans apps/server/.env pour tester les offres payantes.";
}
