import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";

/**
 * Tests d'intégration réels : application Express complète branchée sur une
 * base Postgres jetable. Ils vérifient les garanties qu'un test unitaire ne
 * peut pas couvrir (isolation entre comptes, verrou de facturation, cookies).
 *
 * Nécessite TEST_DATABASE_URL ; sinon la suite est ignorée.
 */
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIfDb = TEST_DATABASE_URL ? describe : describe.skip;

let app: Express;
let prisma: import("@prisma/client").PrismaClient;
let resetAllRateLimits: () => void;

describeIfDb("API", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    process.env.JWT_SECRET = "secret-de-test-suffisamment-long-pour-zod";
    process.env.NODE_ENV = "test";
    process.env.BILLING_MODE = "disabled";
    delete process.env.ANTHROPIC_API_KEY;

    ({ prisma } = await import("../lib/prisma.js"));
    ({ resetAllRateLimits } = await import("../lib/rateLimit.js"));
    app = (await import("../app.js")).createApp();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    // Les limiteurs sont volontairement stricts : sans remise à zéro, la suite
    // se ferait bloquer par sa propre protection anti-bourrage.
    resetAllRateLimits();

    // L'ordre suit les dépendances : les cascades font le reste.
    await prisma.chatMessage.deleteMany();
    await prisma.session.deleteMany();
    await prisma.trainingPlan.deleteMany();
    await prisma.athleteProfile.deleteMany();
    await prisma.passwordResetToken.deleteMany();
    await prisma.user.deleteMany();
  });

  async function signUp(email: string, password = "motdepasse123") {
    const agent = request.agent(app);
    const res = await agent.post("/api/auth/register").send({ email, password, name: "Athlète" });
    expect(res.status).toBe(201);
    return { agent, user: res.body as { id: string; plan: string } };
  }

  describe("inscription et session", () => {
    it("crée un compte, pose un cookie httpOnly et expose l'essai", async () => {
      const agent = request.agent(app);
      const res = await agent
        .post("/api/auth/register")
        .send({ email: "a@example.com", password: "motdepasse123", name: "Alice" });

      expect(res.status).toBe(201);
      expect(res.body.plan).toBe("free");
      expect(res.body.isTrialActive).toBe(true);
      expect(res.body.passwordHash).toBeUndefined();

      const cookie = res.headers["set-cookie"][0];
      expect(cookie).toContain("HttpOnly");
      expect(cookie).toContain("SameSite=Lax");

      const me = await agent.get("/api/auth/me");
      expect(me.status).toBe(200);
      expect(me.body.email).toBe("a@example.com");
    });

    it("refuse un mot de passe trop court", async () => {
      const res = await request(app)
        .post("/api/auth/register")
        .send({ email: "b@example.com", password: "court", name: "Bob" });
      expect(res.status).toBe(400);
    });

    it("normalise l'email pour empêcher les doublons de casse", async () => {
      await signUp("Casse@Example.com");
      const res = await request(app)
        .post("/api/auth/register")
        .send({ email: "casse@example.com", password: "motdepasse123", name: "Autre" });
      expect(res.status).toBe(409);
    });

    it("rejette l'accès sans cookie", async () => {
      expect((await request(app).get("/api/auth/me")).status).toBe(401);
      expect((await request(app).get("/api/sessions")).status).toBe(401);
      expect((await request(app).get("/api/plans/current")).status).toBe(401);
    });
  });

  describe("verrou de facturation", () => {
    it("refuse le passage en premium sans paiement", async () => {
      const { agent } = await signUp("premium@example.com");
      const res = await agent.patch("/api/auth/plan").send({ plan: "premium" });

      expect(res.status).toBe(402);
      expect(res.body.code).toBe("BILLING_UNAVAILABLE");

      const me = await agent.get("/api/auth/me");
      expect(me.body.plan).toBe("free");
      expect(me.body.isPremium).toBe(false);
    });

    it("refuse aussi le passage en standard", async () => {
      const { agent } = await signUp("standard@example.com");
      expect((await agent.patch("/api/auth/plan").send({ plan: "standard" })).status).toBe(402);
    });

    it("laisse résilier vers l'offre gratuite", async () => {
      const { agent, user } = await signUp("resiliation@example.com");
      await prisma.user.update({ where: { id: user.id }, data: { plan: "premium" } });

      const res = await agent.patch("/api/auth/plan").send({ plan: "free" });
      expect(res.status).toBe(200);
      expect(res.body.plan).toBe("free");
    });

    it("interdit les fonctions premium à un compte gratuit", async () => {
      const { agent } = await signUp("gratuit@example.com");
      const res = await agent.get("/api/insights/overtraining");
      expect(res.status).toBe(403);
      expect(res.body.code).toBe("PREMIUM_REQUIRED");
    });
  });

  describe("isolation entre comptes", () => {
    it("empêche de modifier la séance d'un autre athlète", async () => {
      const { user: alice } = await signUp("alice@example.com");
      const { agent: bob } = await signUp("bob@example.com");

      const plan = await prisma.trainingPlan.create({
        data: {
          userId: alice.id,
          weekStart: new Date("2026-09-07T00:00:00Z"),
          rawAiJson: "{}",
          sessions: {
            create: [
              {
                userId: alice.id,
                date: new Date("2026-09-08T00:00:00Z"),
                sport: "course",
                titre: "Footing",
                dureeMin: 45,
              },
            ],
          },
        },
        include: { sessions: true },
      });
      const sessionId = plan.sessions[0].id;

      const res = await bob.patch(`/api/sessions/${sessionId}`).send({ status: "faite" });
      expect(res.status).toBe(404);

      const untouched = await prisma.session.findUniqueOrThrow({ where: { id: sessionId } });
      expect(untouched.status).toBe("planifiee");
    });

    it("ne renvoie que ses propres séances", async () => {
      const { user: alice } = await signUp("alice2@example.com");
      const { agent: bob } = await signUp("bob2@example.com");

      await prisma.trainingPlan.create({
        data: {
          userId: alice.id,
          weekStart: new Date("2026-09-07T00:00:00Z"),
          rawAiJson: "{}",
          sessions: {
            create: [
              { userId: alice.id, date: new Date("2026-09-08T00:00:00Z"), sport: "velo", titre: "Sortie", dureeMin: 90 },
            ],
          },
        },
      });

      const res = await bob.get("/api/sessions");
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it("refuse d'échanger deux séances dont une appartient à un autre", async () => {
      const { user: alice } = await signUp("alice3@example.com");
      const { agent: bob, user: bobUser } = await signUp("bob3@example.com");

      const makeSession = async (userId: string, date: string) => {
        const plan = await prisma.trainingPlan.create({
          data: {
            userId,
            weekStart: new Date("2026-09-07T00:00:00Z"),
            rawAiJson: "{}",
            sessions: {
              create: [{ userId, date: new Date(date), sport: "course", titre: "S", dureeMin: 30 }],
            },
          },
          include: { sessions: true },
        });
        return plan.sessions[0];
      };

      const aliceSession = await makeSession(alice.id, "2026-09-08T00:00:00Z");
      const bobSession = await makeSession(bobUser.id, "2026-09-09T00:00:00Z");

      const res = await bob
        .post("/api/sessions/swap")
        .send({ sessionIdA: bobSession.id, sessionIdB: aliceSession.id });
      expect(res.status).toBe(404);

      const stillThere = await prisma.session.findUniqueOrThrow({ where: { id: aliceSession.id } });
      expect(stillThere.date.toISOString()).toBe("2026-09-08T00:00:00.000Z");
    });
  });

  describe("profil et zones", () => {
    it("enregistre le profil et calcule les zones", async () => {
      const { agent } = await signUp("zones@example.com");

      const put = await agent.put("/api/profile").send({
        objectif: "Half Ironman de Nice",
        objectifDate: "2027-06-01",
        tempsNatation: "1500m en 30min",
        tempsVelo: "40km en 1h15",
        tempsCourse: "10km en 45min",
        heuresSemaine: 8,
        contraintes: "",
        ftpWatts: 240,
      });
      expect(put.status).toBe(200);

      const zones = await agent.get("/api/profile/zones");
      expect(zones.status).toBe(200);
      expect(zones.body.zones.course).toHaveLength(5);
      expect(zones.body.zones.velo[3].value).toContain("W");
      expect(zones.body.periodization.phase).toBe("base");
    });

    it("refuse une date d'objectif invalide", async () => {
      const { agent } = await signUp("datebidon@example.com");
      const res = await agent.put("/api/profile").send({
        objectif: "Marathon",
        objectifDate: "pas-une-date",
        heuresSemaine: 6,
      });
      expect(res.status).toBe(400);
    });

    it("refuse un volume hebdomadaire absurde", async () => {
      const { agent } = await signUp("volume@example.com");
      const res = await agent.put("/api/profile").send({
        objectif: "Marathon",
        objectifDate: "2027-06-01",
        heuresSemaine: 200,
      });
      expect(res.status).toBe(400);
    });
  });

  describe("réinitialisation de mot de passe", () => {
    it("répond pareil que le compte existe ou non", async () => {
      await signUp("reset@example.com");
      const existing = await request(app).post("/api/auth/forgot-password").send({ email: "reset@example.com" });
      const missing = await request(app).post("/api/auth/forgot-password").send({ email: "inconnu@example.com" });

      expect(existing.status).toBe(200);
      expect(missing.status).toBe(200);
      expect(existing.body).toEqual(missing.body);
    });

    it("ne stocke jamais le jeton en clair", async () => {
      const { user } = await signUp("hash@example.com");
      await request(app).post("/api/auth/forgot-password").send({ email: "hash@example.com" });

      const token = await prisma.passwordResetToken.findFirstOrThrow({ where: { userId: user.id } });
      expect(token.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    });

    it("rejette un jeton inconnu ou expiré", async () => {
      const { user } = await signUp("expire@example.com");
      await request(app).post("/api/auth/forgot-password").send({ email: "expire@example.com" });

      const bad = await request(app)
        .post("/api/auth/reset-password")
        .send({ token: "f".repeat(64), password: "nouveaumotdepasse" });
      expect(bad.status).toBe(400);

      await prisma.passwordResetToken.updateMany({
        where: { userId: user.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      const expired = await request(app)
        .post("/api/auth/reset-password")
        .send({ token: "a".repeat(64), password: "nouveaumotdepasse" });
      expect(expired.status).toBe(400);
    });
  });

  describe("changement de mot de passe", () => {
    it("exige le mot de passe actuel", async () => {
      const { agent } = await signUp("changement@example.com");
      const wrong = await agent
        .patch("/api/auth/password")
        .send({ currentPassword: "mauvais", newPassword: "nouveaumotdepasse" });
      expect(wrong.status).toBe(401);

      const ok = await agent
        .patch("/api/auth/password")
        .send({ currentPassword: "motdepasse123", newPassword: "nouveaumotdepasse" });
      expect(ok.status).toBe(200);

      const login = await request(app)
        .post("/api/auth/login")
        .send({ email: "changement@example.com", password: "nouveaumotdepasse" });
      expect(login.status).toBe(200);
    });
  });

  describe("export calendrier", () => {
    it("produit un .ics contenant les séances", async () => {
      const { agent, user } = await signUp("ics@example.com");
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
                titre: "Seuil 6x400m",
                dureeMin: 60,
                objectif: "Développer ton seuil",
              },
              { userId: user.id, date: new Date("2026-09-09T00:00:00Z"), sport: "repos", titre: "Repos", dureeMin: 0 },
            ],
          },
        },
      });

      const res = await agent.get("/api/calendar/sessions.ics");
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toContain("text/calendar");
      expect(res.text).toContain("BEGIN:VCALENDAR");
      expect(res.text).toContain("DTSTART;VALUE=DATE:20260908");
      expect(res.text).toContain("Seuil 6x400m");
      // Les jours de repos n'encombrent pas l'agenda.
      expect(res.text).not.toContain("SUMMARY:Repos");
      expect(res.text.match(/BEGIN:VEVENT/g)).toHaveLength(1);
    });
  });

  describe("coach IA non configuré", () => {
    it("répond 503 explicite plutôt que de planter", async () => {
      const { agent } = await signUp("noai@example.com");
      await agent.put("/api/profile").send({
        objectif: "Marathon",
        objectifDate: "2027-06-01",
        heuresSemaine: 6,
      });

      const plan = await agent.post("/api/plans/generate").send({});
      expect(plan.status).toBe(503);

      const chat = await agent.post("/api/chat").send({ content: "Bonjour" });
      expect(chat.status).toBe(503);
    });
  });

  describe("protection anti-bourrage", () => {
    it("bloque les tentatives de connexion répétées", async () => {
      await signUp("bruteforce@example.com");
      resetAllRateLimits();

      const attempt = () =>
        request(app).post("/api/auth/login").send({ email: "bruteforce@example.com", password: "mauvais" });

      for (let i = 0; i < 10; i++) {
        expect((await attempt()).status).toBe(401);
      }

      const blocked = await attempt();
      expect(blocked.status).toBe(429);
      expect(blocked.headers["retry-after"]).toBeDefined();
    });

    it("limite le nombre de créations de compte depuis une même adresse", async () => {
      resetAllRateLimits();
      for (let i = 0; i < 5; i++) {
        const res = await request(app)
          .post("/api/auth/register")
          .send({ email: `serie${i}@example.com`, password: "motdepasse123", name: "X" });
        expect(res.status).toBe(201);
      }
      const blocked = await request(app)
        .post("/api/auth/register")
        .send({ email: "serie-de-trop@example.com", password: "motdepasse123", name: "X" });
      expect(blocked.status).toBe(429);
    });
  });

  describe("routes inconnues", () => {
    it("renvoie un 404 JSON sous /api", async () => {
      const res = await request(app).get("/api/inexistant");
      expect(res.status).toBe(404);
      expect(res.body.error).toBeDefined();
    });
  });
});
