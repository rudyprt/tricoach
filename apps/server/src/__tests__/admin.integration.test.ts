import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";

/**
 * L'espace d'administration donne accès aux données de tous les comptes et
 * permet d'accorder un abonnement : son contrôle d'accès est la partie la plus
 * sensible de l'application, donc testée en intégration.
 */
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIfDb = TEST_DATABASE_URL ? describe : describe.skip;

let app: Express;
let prisma: import("@prisma/client").PrismaClient;
let resetAllRateLimits: () => void;
let resetPresenceCache: () => void;

describeIfDb("administration", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    process.env.JWT_SECRET = "secret-de-test-suffisamment-long-pour-zod";
    process.env.NODE_ENV = "test";
    process.env.BILLING_MODE = "disabled";

    ({ prisma } = await import("../lib/prisma.js"));
    ({ resetAllRateLimits } = await import("../lib/rateLimit.js"));
    ({ resetPresenceCache } = await import("../lib/presence.js"));
    app = (await import("../app.js")).createApp();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    resetAllRateLimits();
    resetPresenceCache();
    await prisma.adminAction.deleteMany();
    await prisma.aiCall.deleteMany();
    await prisma.chatMessage.deleteMany();
    await prisma.session.deleteMany();
    await prisma.trainingPlan.deleteMany();
    await prisma.athleteProfile.deleteMany();
    await prisma.passwordResetToken.deleteMany();
    await prisma.user.deleteMany();
  });

  async function signUp(email: string) {
    const agent = request.agent(app);
    const res = await agent
      .post("/api/auth/register")
      .send({ email, password: "motdepasse123", name: "Compte", acceptConditions: true });
    expect(res.status).toBe(201);
    return { agent, user: res.body as { id: string } };
  }

  async function signUpAdmin(email: string) {
    const { agent, user } = await signUp(email);
    await prisma.user.update({ where: { id: user.id }, data: { role: "admin" } });
    return { agent, user };
  }

  describe("contrôle d'accès", () => {
    it("refuse un athlète ordinaire sur toutes les routes admin", async () => {
      const { agent, user } = await signUp("athlete@example.com");
      const routes = [
        ["get", "/api/admin/overview"],
        ["get", "/api/admin/activity"],
        ["get", "/api/admin/users"],
        ["get", `/api/admin/users/${user.id}`],
        ["get", "/api/admin/audit"],
      ] as const;

      for (const [method, url] of routes) {
        const res = await agent[method](url);
        expect(res.status).toBe(404);
      }

      const patch = await agent.patch(`/api/admin/users/${user.id}/plan`).send({ plan: "premium" });
      expect(patch.status).toBe(404);
    });

    it("refuse un visiteur non connecté", async () => {
      expect((await request(app).get("/api/admin/overview")).status).toBe(401);
    });

    it("ne laisse pas un athlète s'accorder Premium via la route admin", async () => {
      const { agent, user } = await signUp("malin@example.com");
      await agent.patch(`/api/admin/users/${user.id}/plan`).send({ plan: "premium" });

      const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(after.plan).toBe("free");
    });

    it("prend en compte une révocation de rôle immédiatement", async () => {
      const { agent, user } = await signUpAdmin("revoque@example.com");
      expect((await agent.get("/api/admin/overview")).status).toBe(200);

      // Le cookie reste valide 30 jours : le rôle doit être relu en base.
      await prisma.user.update({ where: { id: user.id }, data: { role: "athlete" } });
      expect((await agent.get("/api/admin/overview")).status).toBe(404);
    });

    it("autorise un administrateur", async () => {
      const { agent } = await signUpAdmin("admin@example.com");
      expect((await agent.get("/api/admin/overview")).status).toBe(200);
    });
  });

  describe("gestion des abonnements", () => {
    it("accorde une offre payante et journalise l'action", async () => {
      const { agent, user: admin } = await signUpAdmin("admin2@example.com");
      const { user: client } = await signUp("client@example.com");

      const res = await agent
        .patch(`/api/admin/users/${client.id}/plan`)
        .send({ plan: "premium", motif: "Paiement reçu par virement" });

      expect(res.status).toBe(200);
      expect(res.body.plan).toBe("premium");

      const stored = await prisma.user.findUniqueOrThrow({ where: { id: client.id } });
      expect(stored.plan).toBe("premium");

      const audit = await prisma.adminAction.findFirstOrThrow({ where: { action: "plan.update" } });
      expect(audit.adminId).toBe(admin.id);
      expect(audit.targetUserId).toBe(client.id);
      expect(audit.details).toMatchObject({ de: "free", vers: "premium", motif: "Paiement reçu par virement" });
    });

    it("donne réellement accès aux fonctions premium après activation", async () => {
      const { agent: admin } = await signUpAdmin("admin3@example.com");
      const { agent: client, user } = await signUp("client2@example.com");

      expect((await client.get("/api/insights/overtraining")).status).toBe(403);
      await admin.patch(`/api/admin/users/${user.id}/plan`).send({ plan: "premium" });
      expect((await client.get("/api/insights/overtraining")).status).toBe(200);
    });

    it("permet la résiliation depuis l'admin", async () => {
      const { agent: admin } = await signUpAdmin("admin4@example.com");
      const { user } = await signUp("resilie@example.com");
      await admin.patch(`/api/admin/users/${user.id}/plan`).send({ plan: "standard" });
      await admin.patch(`/api/admin/users/${user.id}/plan`).send({ plan: "free" });

      const stored = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(stored.plan).toBe("free");
      expect(await prisma.adminAction.count({ where: { action: "plan.update" } })).toBe(2);
    });

    it("refuse une offre inconnue et un compte inexistant", async () => {
      const { agent } = await signUpAdmin("admin5@example.com");
      const { user } = await signUp("cible@example.com");
      expect((await agent.patch(`/api/admin/users/${user.id}/plan`).send({ plan: "or" })).status).toBe(400);
      expect((await agent.patch("/api/admin/users/inexistant/plan").send({ plan: "premium" })).status).toBe(404);
    });

    it("empêche un admin de se retirer son propre rôle", async () => {
      const { agent, user } = await signUpAdmin("admin6@example.com");
      const res = await agent.patch(`/api/admin/users/${user.id}/role`).send({ role: "athlete" });
      expect(res.status).toBe(400);

      const stored = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(stored.role).toBe("admin");
    });

    it("permet de promouvoir un autre compte administrateur", async () => {
      const { agent } = await signUpAdmin("admin7@example.com");
      const { user } = await signUp("futur-admin@example.com");
      const res = await agent.patch(`/api/admin/users/${user.id}/role`).send({ role: "admin" });
      expect(res.status).toBe(200);
      expect(res.body.role).toBe("admin");
    });
  });

  describe("indicateurs", () => {
    it("compte les comptes, les offres et la conversion", async () => {
      const { agent } = await signUpAdmin("admin8@example.com");
      const a = await signUp("a@example.com");
      const b = await signUp("b@example.com");
      await prisma.user.update({ where: { id: a.user.id }, data: { plan: "premium" } });
      await prisma.user.update({ where: { id: b.user.id }, data: { plan: "standard" } });

      const { body } = await agent.get("/api/admin/overview");
      expect(body.comptes.total).toBe(3);
      expect(body.comptes.parOffre.premium).toBe(1);
      expect(body.comptes.parOffre.standard).toBe(1);
      expect(body.comptes.payants).toBe(2);
      expect(body.comptes.essaisEnCours).toBe(1); // l'admin, encore en essai
    });

    it("distingue les essais expirés non convertis", async () => {
      const { agent } = await signUpAdmin("admin9@example.com");
      const vieux = await signUp("vieux@example.com");
      await prisma.user.update({
        where: { id: vieux.user.id },
        data: { createdAt: new Date(Date.now() - 30 * 24 * 3600 * 1000) },
      });

      const { body } = await agent.get("/api/admin/overview");
      expect(body.comptes.essaisExpiresNonConvertis).toBe(1);
      expect(body.comptes.essaisEnCours).toBe(1);
    });

    it("mesure la fréquentation à partir de la dernière activité", async () => {
      const { agent } = await signUpAdmin("admin10@example.com");
      const recent = await signUp("recent@example.com");
      const ancien = await signUp("ancien@example.com");

      await prisma.user.update({
        where: { id: recent.user.id },
        data: { lastSeenAt: new Date(Date.now() - 2 * 3600 * 1000) },
      });
      await prisma.user.update({
        where: { id: ancien.user.id },
        data: { lastSeenAt: new Date(Date.now() - 20 * 24 * 3600 * 1000) },
      });

      const { body } = await agent.get("/api/admin/overview");
      expect(body.frequentation.actifs24h).toBeGreaterThanOrEqual(1);
      expect(body.frequentation.actifs30j).toBeGreaterThanOrEqual(3);
    });

    it("agrège le coût du coach IA par type d'appel", async () => {
      const { agent, user: admin } = await signUpAdmin("admin11@example.com");
      const { user } = await signUp("consommateur@example.com");

      await prisma.aiCall.createMany({
        data: [
          { userId: user.id, kind: "chat", model: "claude-sonnet-5", inputTokens: 1000, outputTokens: 500, costMicroUsd: 7000 },
          { userId: user.id, kind: "plan_generation", model: "claude-sonnet-5", inputTokens: 2000, outputTokens: 4000, costMicroUsd: 44000 },
          { userId: admin.id, kind: "chat", model: "claude-sonnet-5", inputTokens: 500, outputTokens: 250, costMicroUsd: 3500 },
        ],
      });

      const { body } = await agent.get("/api/admin/overview");
      expect(body.coutIa.totalMicroUsd).toBe(54500);
      expect(body.coutIa.appelsTotal).toBe(3);
      const chat = body.coutIa.parType.find((t: { kind: string }) => t.kind === "chat");
      expect(chat.appels).toBe(2);
      expect(chat.coutMicroUsd).toBe(10500);
    });

    it("renvoie une série journalière sur 30 jours", async () => {
      const { agent } = await signUpAdmin("admin12@example.com");
      const { body } = await agent.get("/api/admin/activity");
      expect(body.jours).toHaveLength(30);
      expect(body.jours[29].date).toBe(new Date().toISOString().slice(0, 10));
      expect(body.jours[29].inscriptions).toBeGreaterThanOrEqual(1);
    });
  });

  describe("liste des comptes", () => {
    it("pagine, filtre par offre et recherche par email ou nom", async () => {
      const { agent } = await signUpAdmin("admin13@example.com");
      for (let i = 0; i < 5; i++) {
        // La limite d'inscription par adresse IP est réelle : ce test crée plus
        // de comptes qu'elle n'en autorise, on la remet à zéro entre chacun.
        resetAllRateLimits();
        await signUp(`liste${i}@example.com`);
      }
      resetAllRateLimits();
      const cible = await signUp("cherchee@autredomaine.fr");
      await prisma.user.update({ where: { id: cible.user.id }, data: { plan: "premium" } });

      const page1 = await agent.get("/api/admin/users?page=1&perPage=3");
      expect(page1.body.users).toHaveLength(3);
      expect(page1.body.total).toBe(7);
      expect(page1.body.pages).toBe(3);

      const premium = await agent.get("/api/admin/users?plan=premium");
      expect(premium.body.users).toHaveLength(1);
      expect(premium.body.users[0].email).toBe("cherchee@autredomaine.fr");

      const recherche = await agent.get("/api/admin/users?q=AUTREDOMAINE");
      expect(recherche.body.users).toHaveLength(1);
    });

    it("n'expose jamais le hash du mot de passe", async () => {
      const { agent } = await signUpAdmin("admin14@example.com");
      await signUp("prive@example.com");

      const liste = await agent.get("/api/admin/users");
      expect(JSON.stringify(liste.body)).not.toContain("passwordHash");
      for (const u of liste.body.users) expect(u.passwordHash).toBeUndefined();
    });

    it("détaille un compte avec son usage IA", async () => {
      const { agent } = await signUpAdmin("admin15@example.com");
      const { user } = await signUp("detail@example.com");
      await prisma.aiCall.create({
        data: { userId: user.id, kind: "chat", model: "claude-sonnet-5", inputTokens: 100, outputTokens: 50, costMicroUsd: 700 },
      });

      const res = await agent.get(`/api/admin/users/${user.id}`);
      expect(res.status).toBe(200);
      expect(res.body.email).toBe("detail@example.com");
      expect(res.body.coutIa[0]).toMatchObject({ kind: "chat", appels: 1, coutMicroUsd: 700 });
      expect(res.body.passwordHash).toBeUndefined();
    });
  });

  describe("test d'envoi d'e-mail", () => {
    it("explique quoi configurer quand SMTP est absent", async () => {
      const { agent } = await signUpAdmin("admin-mail@example.com");
      const res = await agent.post("/api/admin/test-email");

      expect(res.status).toBe(400);
      // Le message doit nommer les variables à renseigner, pas juste échouer.
      expect(res.body.error).toContain("SMTP_HOST");
    });

    it("reste inaccessible à un athlète ordinaire", async () => {
      const { agent } = await signUp("pas-admin-mail@example.com");
      expect((await agent.post("/api/admin/test-email")).status).toBe(404);
    });
  });

  describe("journal d'audit", () => {
    it("liste les actions les plus récentes en premier", async () => {
      const { agent } = await signUpAdmin("admin16@example.com");
      const { user } = await signUp("audite@example.com");

      await agent.patch(`/api/admin/users/${user.id}/plan`).send({ plan: "standard" });
      await agent.patch(`/api/admin/users/${user.id}/plan`).send({ plan: "premium" });

      const res = await agent.get("/api/admin/audit");
      expect(res.status).toBe(200);
      expect(res.body.actions).toHaveLength(2);
      expect(res.body.actions[0].details.vers).toBe("premium");
      expect(res.body.actions[0].admin.email).toBe("admin16@example.com");
      expect(res.body.actions[0].targetUser.email).toBe("audite@example.com");
    });
  });
});
