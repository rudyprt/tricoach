import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";

/**
 * Droits RGPD : consentement, vérification d'adresse, portabilité, effacement.
 * L'application stocke des données de santé (blessures, douleurs, ressentis) :
 * ces chemins doivent fonctionner et être testés.
 */
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIfDb = TEST_DATABASE_URL ? describe : describe.skip;

let app: Express;
let prisma: import("@prisma/client").PrismaClient;
let resetAllRateLimits: () => Promise<void>;

describeIfDb("données personnelles", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    process.env.JWT_SECRET = "secret-de-test-suffisamment-long-pour-zod";
    process.env.NODE_ENV = "test";

    ({ prisma } = await import("../lib/prisma.js"));
    ({ resetAllRateLimits } = await import("../lib/rateLimit.js"));
    app = (await import("../app.js")).createApp();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await resetAllRateLimits();
    await prisma.adminAction.deleteMany();
    await prisma.generationJob.deleteMany();
    await prisma.aiCall.deleteMany();
    await prisma.chatMessage.deleteMany();
    await prisma.session.deleteMany();
    await prisma.trainingPlan.deleteMany();
    await prisma.athleteProfile.deleteMany();
    await prisma.emailVerificationToken.deleteMany();
    await prisma.passwordResetToken.deleteMany();
    await prisma.user.deleteMany();
  });

  async function signUp(email: string) {
    const agent = request.agent(app);
    const res = await agent
      .post("/api/auth/register")
      .send({ email, password: "motdepasse123", name: "Athlète", acceptConditions: true });
    expect(res.status).toBe(201);
    return { agent, user: res.body as { id: string } };
  }

  describe("consentement", () => {
    it("refuse une inscription sans acceptation des conditions", async () => {
      const sans = await request(app)
        .post("/api/auth/register")
        .send({ email: "sansconsentement@example.com", password: "motdepasse123", name: "X" });
      expect(sans.status).toBe(400);
      expect(sans.body.error).toContain("accepter les conditions");

      const refus = await request(app)
        .post("/api/auth/register")
        .send({ email: "refus@example.com", password: "motdepasse123", name: "X", acceptConditions: false });
      expect(refus.status).toBe(400);

      expect(await prisma.user.count()).toBe(0);
    });

    it("horodate le consentement et sa version", async () => {
      const { user } = await signUp("consent@example.com");
      const stored = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(stored.consentAcceptedAt).toBeInstanceOf(Date);
      expect(stored.consentVersion).toBeTruthy();
    });

    it("redemande le consentement si la version des conditions a changé", async () => {
      const { agent, user } = await signUp("reconsent@example.com");
      expect((await agent.get("/api/auth/me")).body.needsConsent).toBe(false);

      await prisma.user.update({ where: { id: user.id }, data: { consentVersion: "2020-01" } });
      expect((await agent.get("/api/auth/me")).body.needsConsent).toBe(true);

      expect((await agent.post("/api/privacy/consent")).status).toBe(200);
      expect((await agent.get("/api/auth/me")).body.needsConsent).toBe(false);
    });
  });

  describe("vérification de l'adresse e-mail", () => {
    it("crée un jeton à l'inscription, sans le stocker en clair", async () => {
      const { agent, user } = await signUp("verif@example.com");
      expect((await agent.get("/api/auth/me")).body.emailVerified).toBe(false);

      const token = await prisma.emailVerificationToken.findFirstOrThrow({ where: { userId: user.id } });
      expect(token.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    });

    it("refuse un jeton inconnu ou expiré", async () => {
      const { user } = await signUp("verif2@example.com");
      expect((await request(app).post("/api/privacy/verify-email").send({ token: "f".repeat(64) })).status).toBe(400);

      await prisma.emailVerificationToken.updateMany({
        where: { userId: user.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      expect((await request(app).post("/api/privacy/verify-email").send({ token: "a".repeat(64) })).status).toBe(400);
      expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).emailVerifiedAt).toBeNull();
    });

    it("permet de redemander un envoi et remplace le jeton précédent", async () => {
      const { agent, user } = await signUp("renvoi@example.com");
      const premier = await prisma.emailVerificationToken.findFirstOrThrow({ where: { userId: user.id } });

      expect((await agent.post("/api/privacy/verify-email/resend")).status).toBe(200);

      const jetons = await prisma.emailVerificationToken.findMany({ where: { userId: user.id, usedAt: null } });
      expect(jetons).toHaveLength(1);
      expect(jetons[0].tokenHash).not.toBe(premier.tokenHash);
    });
  });

  describe("portabilité des données", () => {
    it("exporte l'ensemble des données de l'athlète, sans son mot de passe", async () => {
      const { agent, user } = await signUp("export@example.com");
      await agent.put("/api/profile").send({
        objectif: "Ironman de Nice",
        objectifDate: "2027-06-01",
        tempsCourse: "10km en 45min",
        contraintes: "douleur au genou droit",
        heuresSemaine: 8,
      });
      await prisma.chatMessage.create({ data: { userId: user.id, role: "user", content: "Bonjour coach" } });
      await prisma.trainingPlan.create({
        data: {
          userId: user.id,
          weekStart: new Date("2026-09-07T00:00:00Z"),
          rawAiJson: "{}",
          sessions: {
            create: [
              {
                userId: user.id,
                date: new Date("2026-09-08T00:00:00Z"),
                sport: "course",
                titre: "Footing",
                dureeMin: 45,
                ressenti: "jambes lourdes",
              },
            ],
          },
        },
      });

      const res = await agent.get("/api/privacy/export");
      expect(res.status).toBe(200);
      expect(res.headers["content-disposition"]).toContain("tricoach-mes-donnees");

      const data = JSON.parse(res.text);
      expect(data.compte.email).toBe("export@example.com");
      expect(data.compte.passwordHash).toBeUndefined();
      expect(res.text).not.toContain("passwordHash");
      // Les données de santé déclarées font partie de l'export.
      expect(data.compte.profile.contraintes).toBe("douleur au genou droit");
      expect(data.seances[0].ressenti).toBe("jambes lourdes");
      expect(data.conversationsCoach[0].content).toBe("Bonjour coach");
      expect(data.zonesDEntrainement.course).toHaveLength(5);
    });

    it("n'exporte que ses propres données", async () => {
      const { user: alice } = await signUp("alice-exp@example.com");
      await prisma.chatMessage.create({ data: { userId: alice.id, role: "user", content: "secret d'alice" } });

      const { agent: bob } = await signUp("bob-exp@example.com");
      const res = await bob.get("/api/privacy/export");
      expect(res.text).not.toContain("secret d'alice");
      expect(JSON.parse(res.text).conversationsCoach).toEqual([]);
    });

    it("exige d'être connecté", async () => {
      expect((await request(app).get("/api/privacy/export")).status).toBe(401);
    });
  });

  describe("effacement du compte", () => {
    it("supprime le compte et toutes les données rattachées", async () => {
      const { agent, user } = await signUp("efface@example.com");
      await agent.put("/api/profile").send({
        objectif: "Marathon",
        objectifDate: "2027-06-01",
        heuresSemaine: 6,
      });
      await prisma.chatMessage.create({ data: { userId: user.id, role: "user", content: "coucou" } });
      await prisma.aiCall.create({
        data: { userId: user.id, kind: "chat", model: "claude-sonnet-5", costMicroUsd: 100 },
      });
      await prisma.trainingPlan.create({
        data: {
          userId: user.id,
          weekStart: new Date("2026-09-07T00:00:00Z"),
          rawAiJson: "{}",
          sessions: {
            create: [{ userId: user.id, date: new Date("2026-09-08T00:00:00Z"), sport: "course", titre: "S", dureeMin: 30 }],
          },
        },
      });

      const res = await agent
        .delete("/api/privacy/account")
        .send({ password: "motdepasse123", confirmation: "SUPPRIMER" });
      expect(res.status).toBe(200);

      expect(await prisma.user.count({ where: { id: user.id } })).toBe(0);
      expect(await prisma.athleteProfile.count({ where: { userId: user.id } })).toBe(0);
      expect(await prisma.session.count({ where: { userId: user.id } })).toBe(0);
      expect(await prisma.trainingPlan.count({ where: { userId: user.id } })).toBe(0);
      expect(await prisma.chatMessage.count({ where: { userId: user.id } })).toBe(0);
      expect(await prisma.aiCall.count({ where: { userId: user.id } })).toBe(0);
      expect(await prisma.emailVerificationToken.count({ where: { userId: user.id } })).toBe(0);

      // La session est close et le cookie effacé : plus rien n'est accessible.
      expect((await agent.get("/api/auth/me")).status).toBe(401);
    });

    it("exige le mot de passe et la confirmation écrite", async () => {
      const { agent, user } = await signUp("prudence@example.com");

      expect(
        (await agent.delete("/api/privacy/account").send({ password: "motdepasse123" })).status
      ).toBe(400);
      expect(
        (await agent.delete("/api/privacy/account").send({ password: "motdepasse123", confirmation: "oui" })).status
      ).toBe(400);
      expect(
        (await agent.delete("/api/privacy/account").send({ password: "faux", confirmation: "SUPPRIMER" })).status
      ).toBe(401);

      expect(await prisma.user.count({ where: { id: user.id } })).toBe(1);
    });

    it("empêche le dernier administrateur de se supprimer", async () => {
      const { agent, user } = await signUp("dernier-admin@example.com");
      await prisma.user.update({ where: { id: user.id }, data: { role: "admin" } });

      const res = await agent
        .delete("/api/privacy/account")
        .send({ password: "motdepasse123", confirmation: "SUPPRIMER" });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain("dernier administrateur");
      expect(await prisma.user.count({ where: { id: user.id } })).toBe(1);
    });

    it("ne touche pas aux autres comptes", async () => {
      const { user: alice } = await signUp("alice-suppr@example.com");
      const { agent: bob } = await signUp("bob-suppr@example.com");

      await bob.delete("/api/privacy/account").send({ password: "motdepasse123", confirmation: "SUPPRIMER" });

      expect(await prisma.user.count({ where: { id: alice.id } })).toBe(1);
    });
  });
});
