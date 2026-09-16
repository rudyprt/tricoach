import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { Express } from "express";

/**
 * Abonnements aux notifications. Le point qui compte : un même appareil ne doit
 * jamais produire deux abonnements, sinon chaque rappel partirait en double sur
 * le même téléphone.
 */
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIfDb = TEST_DATABASE_URL ? describe : describe.skip;

const envoyees: { endpoint: string; charge: string }[] = [];

vi.mock("web-push", () => ({
  default: {
    setVapidDetails: () => undefined,
    sendNotification: async (abonnement: { endpoint: string }, charge: string) => {
      if (abonnement.endpoint.includes("disparu")) {
        throw Object.assign(new Error("Gone"), { statusCode: 410 });
      }
      envoyees.push({ endpoint: abonnement.endpoint, charge });
    },
  },
}));

let app: Express;
let prisma: import("@prisma/client").PrismaClient;
let resetAllRateLimits: () => Promise<void>;
let notifier: typeof import("../lib/push.js").notifier;

describeIfDb("notifications poussées", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    process.env.JWT_SECRET = "secret-de-test-suffisamment-long-pour-zod";
    process.env.NODE_ENV = "test";
    // Clés factices : la bibliothèque d'envoi est simulée, seul compte le fait
    // que la fonctionnalité se considère configurée.
    process.env.VAPID_PUBLIC_KEY = "cle-publique-de-test";
    process.env.VAPID_PRIVATE_KEY = "cle-privee-de-test";

    ({ prisma } = await import("../lib/prisma.js"));
    ({ resetAllRateLimits } = await import("../lib/rateLimit.js"));
    ({ notifier } = await import("../lib/push.js"));
    app = (await import("../app.js")).createApp();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    envoyees.length = 0;
    await resetAllRateLimits();
    await prisma.pushSubscription.deleteMany();
    await prisma.user.deleteMany();
  });

  async function athlete(email: string) {
    const agent = request.agent(app);
    const res = await agent
      .post("/api/auth/register")
      .send({ email, password: "motdepasse123", name: "Athlète", acceptConditions: true });
    return { agent, user: res.body as { id: string } };
  }

  const abonnement = (suffixe = "1") => ({
    endpoint: `https://push.example.com/${suffixe}`,
    keys: { p256dh: "cle-publique-navigateur", auth: "secret-navigateur" },
  });

  it("expose la clé publique sans exiger de session", async () => {
    const res = await request(app).get("/api/push/cle");
    expect(res.status).toBe(200);
    expect(res.body.disponible).toBe(true);
    expect(res.body.clePublique).toBe("cle-publique-de-test");
  });

  it("enregistre un appareil", async () => {
    const { agent, user } = await athlete("appareil@example.com");

    expect((await agent.post("/api/push/abonnements").send(abonnement())).status).toBe(201);
    expect(await prisma.pushSubscription.count({ where: { userId: user.id } })).toBe(1);
  });

  it("ne crée jamais deux abonnements pour le même appareil", async () => {
    const { agent, user } = await athlete("doublon@example.com");

    await agent.post("/api/push/abonnements").send(abonnement());
    await agent.post("/api/push/abonnements").send(abonnement());

    // Sinon chaque rappel partirait deux fois sur le même téléphone.
    expect(await prisma.pushSubscription.count({ where: { userId: user.id } })).toBe(1);
  });

  it("reprend un appareil au compte précédent", async () => {
    const { agent: premier } = await athlete("premier@example.com");
    await premier.post("/api/push/abonnements").send(abonnement());

    const { agent: second, user: secondUser } = await athlete("second@example.com");
    await second.post("/api/push/abonnements").send(abonnement());

    // Un téléphone prêté puis rendu ne doit pas continuer de recevoir les
    // notifications de quelqu'un d'autre.
    const abonnements = await prisma.pushSubscription.findMany();
    expect(abonnements).toHaveLength(1);
    expect(abonnements[0].userId).toBe(secondUser.id);
  });

  it("envoie à tous les appareils d'un athlète", async () => {
    const { agent, user } = await athlete("multi@example.com");
    await agent.post("/api/push/abonnements").send(abonnement("telephone"));
    await agent.post("/api/push/abonnements").send(abonnement("tablette"));

    const bilan = await notifier(user.id, { titre: "Test", corps: "Contenu" });

    expect(bilan.envoyees).toBe(2);
    expect(JSON.parse(envoyees[0].charge)).toMatchObject({ titre: "Test", corps: "Contenu" });
  });

  it("retire un appareil que le service déclare disparu", async () => {
    const { agent, user } = await athlete("disparu@example.com");
    await agent.post("/api/push/abonnements").send(abonnement("disparu"));

    const bilan = await notifier(user.id, { titre: "Test", corps: "Contenu" });

    // Sans cela, chaque envoi futur échouerait indéfiniment sur cet appareil.
    expect(bilan.appareilsRetires).toBe(1);
    expect(await prisma.pushSubscription.count({ where: { userId: user.id } })).toBe(0);
  });

  it("permet de se désabonner sur cet appareil", async () => {
    const { agent, user } = await athlete("retrait@example.com");
    await agent.post("/api/push/abonnements").send(abonnement());

    await agent.delete("/api/push/abonnements").send({ endpoint: abonnement().endpoint });

    expect(await prisma.pushSubscription.count({ where: { userId: user.id } })).toBe(0);
  });

  it("refuse un abonnement mal formé", async () => {
    const { agent } = await athlete("invalide@example.com");
    expect((await agent.post("/api/push/abonnements").send({ endpoint: "pas-une-url" })).status).toBe(400);
  });

  it("n'expose pas les appareils d'un autre athlète", async () => {
    const { agent: proprietaire } = await athlete("proprio@example.com");
    await proprietaire.post("/api/push/abonnements").send(abonnement());

    const { agent: intrus } = await athlete("intrus@example.com");
    expect((await intrus.get("/api/push/etat")).body.appareils).toBe(0);

    // Un désabonnement ne doit pas pouvoir viser l'appareil d'un autre.
    await intrus.delete("/api/push/abonnements").send({ endpoint: abonnement().endpoint });
    expect(await prisma.pushSubscription.count()).toBe(1);
  });

  it("signale qu'aucun appareil n'a pu être joint", async () => {
    const { agent } = await athlete("muet@example.com");
    expect((await agent.post("/api/push/test")).status).toBe(400);
  });
});
