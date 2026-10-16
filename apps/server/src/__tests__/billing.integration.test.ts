import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { Express } from "express";
import type Stripe from "stripe";

/**
 * Paiement Stripe en mode test : visible des seuls comptes désignés, l'offre
 * ne change que sur un événement signé par Stripe.
 */
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIfDb = TEST_DATABASE_URL ? describe : describe.skip;
const SECRET = "whsec_test_secret";

let app: Express;
let prisma: import("@prisma/client").PrismaClient;
let resetAllRateLimits: () => Promise<void>;
let client: Stripe;

describeIfDb("paiement Stripe (mode test)", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    process.env.JWT_SECRET = "secret-de-test-suffisamment-long-pour-zod";
    process.env.NODE_ENV = "test";
    process.env.STRIPE_SECRET_KEY = "sk_test_fictive";
    process.env.STRIPE_WEBHOOK_SECRET = SECRET;
    process.env.STRIPE_TESTEURS = "testeur@example.com, Autre@Example.com";
    ({ prisma } = await import("../lib/prisma.js"));
    ({ resetAllRateLimits } = await import("../lib/rateLimit.js"));
    client = (await import("../lib/stripe.js")).stripe()!;
    app = (await import("../app.js")).createApp();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await resetAllRateLimits();
    vi.restoreAllMocks();
    await prisma.user.deleteMany();
  });

  async function compte(email: string) {
    const agent = request.agent(app);
    const res = await agent
      .post("/api/auth/register")
      .send({ email, password: "motdepasse123", name: "Athlète", acceptConditions: true });
    return { agent, user: res.body as { id: string } };
  }

  function abonnement(userId: string, r: Partial<Stripe.Subscription> = {}): Stripe.Subscription {
    return {
      id: "sub_123",
      object: "subscription",
      customer: "cus_123",
      status: "active",
      cancel_at_period_end: false,
      metadata: { userId, plan: "premium" },
      items: { data: [{ current_period_end: 1_800_000_000 }] },
      ...r,
    } as unknown as Stripe.Subscription;
  }

  function webhook(event: object) {
    const payload = JSON.stringify(event);
    const signature = client.webhooks.generateTestHeaderString({ payload, secret: SECRET });
    return request(app)
      .post("/api/billing/webhook")
      .set("Content-Type", "application/json")
      .set("Stripe-Signature", signature)
      .send(payload);
  }

  it("ne montre rien aux comptes qui ne sont pas désignés", async () => {
    const { agent } = await compte("athlete@example.com");
    expect((await agent.get("/api/billing")).body.disponible).toBe(false);
    const res = await agent.post("/api/billing/checkout").send({ plan: "premium", conditions: true, accesImmediat: true });
    expect(res.status).toBe(402);
  });

  it("ouvre une page de paiement test aux testeurs désignés, après les deux accords", async () => {
    const { agent, user } = await compte("autre@example.com");
    vi.spyOn(client.customers, "create").mockResolvedValue({ id: "cus_123" } as Stripe.Response<Stripe.Customer>);
    const creation = vi
      .spyOn(client.checkout.sessions, "create")
      .mockResolvedValue({ url: "https://checkout.stripe.com/c/pay/cs_test_1" } as Stripe.Response<Stripe.Checkout.Session>);

    expect((await agent.get("/api/billing")).body).toMatchObject({ disponible: true, mode: "test" });
    expect((await agent.post("/api/billing/checkout").send({ plan: "premium", conditions: true })).status).toBe(400);

    const res = await agent.post("/api/billing/checkout").send({ plan: "premium", conditions: true, accesImmediat: true });
    expect(res.body.url).toContain("checkout.stripe.com");
    const params = creation.mock.calls[0][0]!;
    expect(params).toMatchObject({ mode: "subscription", customer: "cus_123", subscription_data: { metadata: { userId: user.id, plan: "premium" } } });
    expect(params.line_items![0].price_data).toMatchObject({ currency: "eur", unit_amount: 3490, recurring: { interval: "month" } });

    const enBase = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(enBase.conditionsVenteAccepteesLe).not.toBeNull();
    // Rien n'est activé tant que Stripe n'a pas confirmé.
    expect(enBase.plan).toBe("free");
  });

  it("active l'offre sur l'événement signé de Stripe, et la retire à la fin de l'abonnement", async () => {
    const { user } = await compte("testeur@example.com");

    const cree = await webhook({ id: "evt_1", type: "customer.subscription.created", data: { object: abonnement(user.id) } });
    expect(cree.status).toBe(200);
    let enBase = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(enBase).toMatchObject({ plan: "premium", stripeSubscriptionId: "sub_123", abonnementStatut: "active" });
    expect(enBase.abonnementFinPeriode?.toISOString()).toBe(new Date(1_800_000_000 * 1000).toISOString());

    await webhook({ id: "evt_2", type: "customer.subscription.deleted", data: { object: abonnement(user.id, { status: "canceled" }) } });
    enBase = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(enBase).toMatchObject({ plan: "free", abonnementStatut: "canceled" });
  });

  it("refuse un événement qui n'est pas signé par Stripe", async () => {
    const { user } = await compte("testeur@example.com");
    const res = await request(app)
      .post("/api/billing/webhook")
      .set("Content-Type", "application/json")
      .set("Stripe-Signature", "t=1,v1=faux")
      .send(JSON.stringify({ type: "customer.subscription.created", data: { object: abonnement(user.id) } }));
    expect(res.status).toBe(400);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).plan).toBe("free");
  });

  it("résilie en fin de période, et laisse revenir sur la résiliation", async () => {
    const { agent, user } = await compte("testeur@example.com");
    await webhook({ id: "evt_3", type: "customer.subscription.created", data: { object: abonnement(user.id) } });
    const maj = vi
      .spyOn(client.subscriptions, "update")
      .mockResolvedValueOnce(abonnement(user.id, { cancel_at_period_end: true }) as Stripe.Response<Stripe.Subscription>)
      .mockResolvedValueOnce(abonnement(user.id) as Stripe.Response<Stripe.Subscription>);

    await agent.post("/api/billing/resilier");
    expect(maj.mock.calls[0]).toEqual(["sub_123", { cancel_at_period_end: true }]);
    let statut = (await agent.get("/api/billing")).body.abonnement;
    expect(statut).toMatchObject({ annulationPrevue: true, plan: "premium" });

    // L'ancien bouton « Résilier » ne peut pas contourner Stripe.
    expect((await agent.patch("/api/auth/plan").send({ plan: "free" })).status).toBe(409);

    await agent.post("/api/billing/reprendre");
    statut = (await agent.get("/api/billing")).body.abonnement;
    expect(statut.annulationPrevue).toBe(false);
  });

  it("n'accepte qu'une clé de test", async () => {
    const { stripe } = await import("../lib/stripe.js");
    const avant = process.env.STRIPE_SECRET_KEY;
    const { env } = await import("../lib/env.js");
    const config = env() as { STRIPE_SECRET_KEY: string };
    config.STRIPE_SECRET_KEY = "sk_live_interdite";
    try {
      expect(stripe()).toBeNull();
    } finally {
      config.STRIPE_SECRET_KEY = avant!;
    }
  });
});
