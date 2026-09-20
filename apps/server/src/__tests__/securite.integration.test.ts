import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";

/**
 * Garde-fous de sécurité, vérifiés sur l'application réelle.
 *
 * Ils tiennent en peu de lignes et se cassent en une : un en-tête oublié au
 * détour d'une refonte, une route qui cesse de vérifier le propriétaire. Ces
 * tests existent pour que la régression se voie avant la mise en ligne, pas
 * après.
 */
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIfDb = TEST_DATABASE_URL ? describe : describe.skip;

let app: Express;
let prisma: import("@prisma/client").PrismaClient;
let resetAllRateLimits: () => Promise<void>;

describeIfDb("garde-fous de sécurité", () => {
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
    await prisma.session.deleteMany();
    await prisma.trainingPlan.deleteMany();
    await prisma.athleteProfile.deleteMany();
    await prisma.user.deleteMany();
  });

  async function athlete(email: string) {
    const agent = request.agent(app);
    const res = await agent
      .post("/api/auth/register")
      .send({ email, password: "motdepasse123", name: "Athlète", acceptConditions: true });
    return { agent, user: res.body as { id: string } };
  }

  describe("en-têtes", () => {
    it("interdit l'encadrement de la page et la devinette de type", async () => {
      // Sans eux, un site tiers peut superposer la page et détourner les clics.
      const res = await request(app).get("/api/health");

      expect(res.headers["x-frame-options"]).toBeDefined();
      expect(res.headers["x-content-type-options"]).toBe("nosniff");
      expect(res.headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    });

    it("restreint les sources de contenu aux siennes", async () => {
      const csp = (await request(app).get("/api/health")).headers["content-security-policy"];

      expect(csp).toContain("default-src 'self'");
      expect(csp).toContain("script-src 'self'");
      expect(csp).toContain("object-src 'none'");
      expect(csp).toContain("frame-ancestors 'none'");
    });

    it("n'annonce pas la technologie du serveur", async () => {
      expect((await request(app).get("/api/health")).headers["x-powered-by"]).toBeUndefined();
    });
  });

  describe("accès aux données d'autrui", () => {
    /** Séance appartenant à quelqu'un d'autre, que l'intrus va convoiter. */
    async function seanceDe(userId: string) {
      const plan = await prisma.trainingPlan.create({
        data: {
          userId,
          weekStart: new Date("2026-09-07T00:00:00.000Z"),
          rawAiJson: "{}",
          sessions: {
            create: [
              { userId, date: new Date("2026-09-09T00:00:00.000Z"), sport: "course", titre: "À moi", dureeMin: 45 },
            ],
          },
        },
        include: { sessions: true },
      });
      return plan.sessions[0];
    }

    it("refuse de modifier la séance d'un autre", async () => {
      const { user: proprietaire } = await athlete("proprietaire@example.com");
      const seance = await seanceDe(proprietaire.id);
      const { agent } = await athlete("intrus@example.com");

      const res = await agent.patch(`/api/sessions/${seance.id}`).send({ status: "faite" });

      expect(res.status).toBe(404);
      expect((await prisma.session.findUniqueOrThrow({ where: { id: seance.id } })).status).toBe("planifiee");
    });

    it("refuse d'exporter la séance d'un autre vers une montre", async () => {
      const { user: proprietaire } = await athlete("cible@example.com");
      const seance = await seanceDe(proprietaire.id);
      const { agent } = await athlete("curieux@example.com");

      expect((await agent.get(`/api/sessions/${seance.id}/workout.fit`)).status).toBe(404);
    });

    it("refuse tout accès sans session valide", async () => {
      expect((await request(app).get("/api/plans/current")).status).toBe(401);
      expect((await request(app).get("/api/profile")).status).toBe(401);
    });

    it("rejette un jeton forgé", async () => {
      // Signé avec un autre secret : la vérification doit le refuser.
      const jwt = (await import("jsonwebtoken")).default;
      const forge = jwt.sign({ userId: "peu-importe" }, "mauvais-secret-mais-assez-long");

      const res = await request(app).get("/api/profile").set("Cookie", `token=${forge}`);

      expect(res.status).toBe(401);
    });
  });

  describe("comptes", () => {
    it("ne révèle pas si une adresse est inscrite", async () => {
      await athlete("connu@example.com");

      const inconnu = await request(app)
        .post("/api/auth/login")
        .send({ email: "inconnu@example.com", password: "motdepasse123" });
      const mauvais = await request(app)
        .post("/api/auth/login")
        .send({ email: "connu@example.com", password: "mauvais-mot-de-passe" });

      expect(inconnu.status).toBe(mauvais.status);
      expect(inconnu.body.error).toBe(mauvais.body.error);
    });

    it("finit par bloquer les tentatives répétées", async () => {
      await athlete("force@example.com");

      let derniere = 0;
      for (let i = 0; i < 15; i++) {
        derniere = (
          await request(app).post("/api/auth/login").send({ email: "force@example.com", password: `faux-${i}` })
        ).status;
      }

      // 429 par la limite de débit, 429 aussi par le verrouillage du compte.
      expect(derniere).toBe(429);
    });

    it("ne renvoie jamais l'empreinte du mot de passe", async () => {
      const { agent } = await athlete("fuite@example.com");

      const corps = JSON.stringify((await agent.get("/api/auth/me")).body);

      expect(corps).not.toContain("passwordHash");
      expect(corps).not.toContain("$2a$");
      expect(corps).not.toContain("$2b$");
    });
  });
});
