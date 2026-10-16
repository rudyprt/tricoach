import express, { Router } from "express";
import type Stripe from "stripe";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { env } from "../lib/env.js";
import { requireAuth, type AuthedRequest } from "../middleware/auth.js";
import { ah, HttpError } from "../lib/http.js";
import { TARIFS, appliquerAbonnement, paiementVisible, stripe } from "../lib/stripe.js";

/**
 * Abonnements payés par Stripe (mode test, comptes désignés uniquement).
 * Le webhook est exporté à part : il lit le corps brut de la requête pour
 * vérifier la signature de Stripe, et doit passer avant le décodage JSON.
 */
export const billingRouter = Router();

async function compte(req: AuthedRequest) {
  const user = await prisma.user.findUnique({ where: { id: req.userId! } });
  if (!user) throw new HttpError(404, "Utilisateur introuvable.");
  return user;
}

function exigerPaiement(user: { email: string; role: string }): Stripe {
  const client = stripe();
  if (!client || !paiementVisible(user)) {
    throw new HttpError(402, "Le paiement en ligne n'est pas encore disponible.", "BILLING_UNAVAILABLE");
  }
  return client;
}

billingRouter.get(
  "/",
  requireAuth,
  ah(async (req: AuthedRequest, res) => {
    const user = await compte(req);
    res.json({
      disponible: paiementVisible(user),
      mode: "test",
      tarifs: { standard: TARIFS.standard.montant, premium: TARIFS.premium.montant },
      abonnement: user.stripeSubscriptionId
        ? {
            statut: user.abonnementStatut,
            plan: user.plan,
            finPeriode: user.abonnementFinPeriode?.toISOString() ?? null,
            annulationPrevue: user.abonnementAnnulationPrevue,
          }
        : null,
    });
  })
);

const checkoutSchema = z.object({
  plan: z.enum(["standard", "premium"]),
  /** Conditions acceptées avant de payer. */
  conditions: z.literal(true, { errorMap: () => ({ message: "Acceptez les conditions pour continuer." }) }),
  /** Accès immédiat demandé : rétractation possible, au prorata. */
  accesImmediat: z.literal(true, {
    errorMap: () => ({ message: "Confirmez la demande d'accès immédiat pour continuer." }),
  }),
});

billingRouter.post(
  "/checkout",
  requireAuth,
  ah(async (req: AuthedRequest, res) => {
    const user = await compte(req);
    const client = exigerPaiement(user);
    const parsed = checkoutSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message ?? "Demande invalide.");
    const { plan } = parsed.data;

    if (user.stripeSubscriptionId && user.abonnementStatut && ["active", "trialing", "past_due"].includes(user.abonnementStatut)) {
      throw new HttpError(409, "Vous avez déjà un abonnement en cours : résiliez-le avant d'en changer.");
    }

    // Le client Stripe est créé une fois et réutilisé : ses factures restent groupées.
    let customerId = user.stripeCustomerId;
    if (!customerId) {
      const client_ = await client.customers.create({ email: user.email, name: user.name, metadata: { userId: user.id } });
      customerId = client_.id;
    }
    await prisma.user.update({
      where: { id: user.id },
      data: { stripeCustomerId: customerId, conditionsVenteAccepteesLe: new Date(), accesImmediatDemandeLe: new Date() },
    });

    const base = env().APP_URL.replace(/\/$/, "");
    const session = await client.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      client_reference_id: user.id,
      locale: "fr",
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "eur",
            unit_amount: TARIFS[plan].montant,
            recurring: { interval: "month" },
            product_data: { name: TARIFS[plan].nom },
          },
        },
      ],
      subscription_data: { metadata: { userId: user.id, plan } },
      metadata: { userId: user.id, plan },
      success_url: `${base}/abonnement?paiement=ok`,
      cancel_url: `${base}/abonnement?paiement=annule`,
    });
    res.json({ url: session.url });
  })
);

/** Résiliation en fin de période : l'accès court jusqu'à la date déjà payée. */
billingRouter.post(
  "/resilier",
  requireAuth,
  ah(async (req: AuthedRequest, res) => {
    const user = await compte(req);
    const client = exigerPaiement(user);
    if (!user.stripeSubscriptionId) throw new HttpError(400, "Aucun abonnement à résilier.");
    const sub = await client.subscriptions.update(user.stripeSubscriptionId, { cancel_at_period_end: true });
    await appliquerAbonnement(sub);
    res.json({ ok: true });
  })
);

/** Revenir sur une résiliation tant que la période n'est pas finie. */
billingRouter.post(
  "/reprendre",
  requireAuth,
  ah(async (req: AuthedRequest, res) => {
    const user = await compte(req);
    const client = exigerPaiement(user);
    if (!user.stripeSubscriptionId) throw new HttpError(400, "Aucun abonnement à reprendre.");
    const sub = await client.subscriptions.update(user.stripeSubscriptionId, { cancel_at_period_end: false });
    await appliquerAbonnement(sub);
    res.json({ ok: true });
  })
);

/**
 * Webhook Stripe. Seul un événement signé par Stripe peut changer une offre :
 * le retour du navigateur sur la page de succès ne prouve rien.
 */
export const billingWebhook = [
  express.raw({ type: "application/json" }),
  ah(async (req, res) => {
    const client = stripe();
    const secret = env().STRIPE_WEBHOOK_SECRET;
    if (!client || !secret) throw new HttpError(503, "Paiement non configuré.");

    let event: Stripe.Event;
    try {
      event = client.webhooks.constructEvent(req.body as Buffer, req.headers["stripe-signature"] as string, secret);
    } catch {
      throw new HttpError(400, "Signature Stripe invalide.");
    }

    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.subscription) {
        const id = typeof session.subscription === "string" ? session.subscription : session.subscription.id;
        await appliquerAbonnement(await client.subscriptions.retrieve(id));
      }
    } else if (
      event.type === "customer.subscription.created" ||
      event.type === "customer.subscription.updated" ||
      event.type === "customer.subscription.deleted"
    ) {
      await appliquerAbonnement(event.data.object as Stripe.Subscription);
    } else if (event.type === "invoice.payment_failed") {
      console.warn("[stripe] Échec de paiement :", (event.data.object as Stripe.Invoice).id);
    }
    res.json({ received: true });
  }),
];
