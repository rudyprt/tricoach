import Stripe from "stripe";
import { env } from "./env.js";
import { prisma } from "./prisma.js";
import type { Plan } from "./subscription.js";

/**
 * Paiement par Stripe, en mode test.
 *
 * L'activité n'est pas encore déclarée : encaisser pour de vrai n'est pas
 * permis. Le paiement est donc branché de bout en bout — page de paiement,
 * abonnement, renouvellement, résiliation — mais uniquement avec une clé de
 * test, où les cartes sont fictives et aucun argent ne circule. Une clé
 * « sk_live_ » est refusée.
 *
 * Et seuls les comptes désignés le voient (STRIPE_TESTEURS, et les
 * administrateurs) : les testeurs actuels gardent exactement l'écran qu'ils
 * connaissent, sans page de paiement qui les inquiéterait.
 */

export type PlanPayant = Exclude<Plan, "free">;

/** Prix TTC mensuels, en centimes : ceux affichés sur la page des offres. */
export const TARIFS: Record<PlanPayant, { montant: number; nom: string }> = {
  standard: { montant: 1999, nom: "TriCoach Standard" },
  premium: { montant: 3490, nom: "TriCoach Premium" },
};

let client: Stripe | null = null;
let cleClient = "";
let refusSignale = false;

/** Le client Stripe, ou null si aucune clé de TEST n'est configurée. */
export function stripe(): Stripe | null {
  const cle = env().STRIPE_SECRET_KEY;
  if (!cle) return null;
  if (!cle.startsWith("sk_test_")) {
    if (!refusSignale) {
      console.error("[stripe] Clé refusée : seul le mode test (sk_test_...) est autorisé pour le moment.");
      refusSignale = true;
    }
    return null;
  }
  if (!client || cleClient !== cle) {
    client = new Stripe(cle);
    cleClient = cle;
  }
  return client;
}

/** Ce compte voit-il le paiement Stripe ? */
export function paiementVisible(user: { email: string; role: string }): boolean {
  if (!stripe()) return false;
  if (user.role === "admin") return true;
  const testeurs = env()
    .STRIPE_TESTEURS.split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return testeurs.includes(user.email.toLowerCase());
}

/** Fin de la période payée : portée par l'abonnement ou, depuis 2025, par ses lignes. */
function finDePeriode(sub: Stripe.Subscription): Date | null {
  const brut =
    (sub as unknown as { current_period_end?: number }).current_period_end ??
    (sub.items?.data?.[0] as unknown as { current_period_end?: number } | undefined)?.current_period_end;
  return brut ? new Date(brut * 1000) : null;
}

/** Statuts qui donnent accès à l'offre : un paiement en retard laisse le temps de régulariser. */
const STATUTS_ACTIFS = new Set(["active", "trialing", "past_due"]);

/**
 * Reporte l'état d'un abonnement Stripe sur le compte. Appelé par les
 * webhooks : c'est Stripe qui fait foi, jamais le navigateur.
 */
export async function appliquerAbonnement(sub: Stripe.Subscription): Promise<void> {
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const userId = sub.metadata?.userId;
  const user = userId
    ? await prisma.user.findUnique({ where: { id: userId } })
    : await prisma.user.findUnique({ where: { stripeCustomerId: customerId } });
  if (!user) {
    console.warn(`[stripe] Abonnement ${sub.id} sans compte correspondant.`);
    return;
  }
  // Un ancien abonnement qui se termine ne doit pas couper le nouveau.
  if (user.stripeSubscriptionId && user.stripeSubscriptionId !== sub.id && !STATUTS_ACTIFS.has(sub.status)) return;

  const plan = (sub.metadata?.plan as PlanPayant | undefined) ?? "standard";
  const actif = STATUTS_ACTIFS.has(sub.status);
  await prisma.user.update({
    where: { id: user.id },
    data: {
      stripeCustomerId: customerId,
      stripeSubscriptionId: sub.id,
      abonnementStatut: sub.status,
      abonnementFinPeriode: finDePeriode(sub),
      abonnementAnnulationPrevue: sub.cancel_at_period_end,
      plan: actif ? plan : "free",
    },
  });
}
