import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";

/**
 * L'historique d'un athlète grandit indéfiniment. Ces routes doivent rester
 * bornées, sinon l'ouverture de l'application ralentit d'année en année.
 */
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIfDb = TEST_DATABASE_URL ? describe : describe.skip;

let app: Express;
let prisma: import("@prisma/client").PrismaClient;
let resetAllRateLimits: () => Promise<void>;

describeIfDb("pagination", () => {
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
    await prisma.chatMessage.deleteMany();
    await prisma.session.deleteMany();
    await prisma.trainingPlan.deleteMany();
    await prisma.athleteProfile.deleteMany();
    await prisma.user.deleteMany();
  });

  async function athleteAvecHistorique(email: string, nbSeances: number) {
    const agent = request.agent(app);
    const res = await agent
      .post("/api/auth/register")
      .send({ email, password: "motdepasse123", name: "Athlète", acceptConditions: true });
    const user = res.body as { id: string };

    await prisma.trainingPlan.create({
      data: {
        userId: user.id,
        weekStart: new Date("2026-01-05T00:00:00Z"),
        rawAiJson: "{}",
        sessions: {
          create: Array.from({ length: nbSeances }, (_, i) => ({
            userId: user.id,
            date: new Date(Date.UTC(2026, 0, 5 + i)),
            sport: "course",
            titre: `Séance ${i}`,
            dureeMin: 45,
          })),
        },
      },
    });
    return { agent, user };
  }

  describe("séances", () => {
    it("borne la première page et fournit un curseur", async () => {
      const { agent } = await athleteAvecHistorique("beaucoup@example.com", 25);

      const page1 = await agent.get("/api/sessions?limit=10");
      expect(page1.status).toBe(200);
      expect(page1.body.sessions).toHaveLength(10);
      expect(page1.body.nextCursor).toBeTruthy();

      const page2 = await agent.get(`/api/sessions?limit=10&cursor=${page1.body.nextCursor}`);
      expect(page2.body.sessions).toHaveLength(10);
      // Les pages ne se chevauchent pas.
      const ids1 = page1.body.sessions.map((s: { id: string }) => s.id);
      const ids2 = page2.body.sessions.map((s: { id: string }) => s.id);
      expect(ids1.filter((id: string) => ids2.includes(id))).toEqual([]);

      const page3 = await agent.get(`/api/sessions?limit=10&cursor=${page2.body.nextCursor}`);
      expect(page3.body.sessions).toHaveLength(5);
      expect(page3.body.nextCursor).toBeNull();
    });

    it("filtre sur une plage de dates", async () => {
      const { agent } = await athleteAvecHistorique("plage@example.com", 20);
      const res = await agent.get("/api/sessions?from=2026-01-10&to=2026-01-14");
      expect(res.body.sessions).toHaveLength(5);
      expect(res.body.sessions[0].date.slice(0, 10)).toBe("2026-01-10");
    });

    it("refuse une limite démesurée plutôt que de tout renvoyer", async () => {
      const { agent } = await athleteAvecHistorique("limite@example.com", 3);
      expect((await agent.get("/api/sessions?limit=100000")).status).toBe(400);
      expect((await agent.get("/api/sessions?from=hier")).status).toBe(400);
    });
  });

  describe("conversation", () => {
    it("renvoie la fin du fil, dans l'ordre chronologique", async () => {
      const agent = request.agent(app);
      const res = await agent
        .post("/api/auth/register")
        .send({ email: "fil@example.com", password: "motdepasse123", name: "A", acceptConditions: true });
      const user = res.body as { id: string };

      const base = Date.now() - 3 * 24 * 3600 * 1000;
      await prisma.chatMessage.createMany({
        data: Array.from({ length: 120 }, (_, i) => ({
          userId: user.id,
          role: i % 2 === 0 ? "user" : "assistant",
          content: `message-${i}`,
          createdAt: new Date(base + i * 1000),
        })),
      });

      const page = await agent.get("/api/chat?limit=50");
      expect(page.body.messages).toHaveLength(50);
      expect(page.body.hasMore).toBe(true);
      // Les 50 DERNIERS, remis dans l'ordre de lecture.
      expect(page.body.messages[0].content).toBe("message-70");
      expect(page.body.messages[49].content).toBe("message-119");

      const precedente = await agent.get(`/api/chat?limit=50&before=${page.body.oldestAt}`);
      expect(precedente.body.messages[49].content).toBe("message-69");
    });

    it("indique la fin du fil sur une courte conversation", async () => {
      const agent = request.agent(app);
      await agent
        .post("/api/auth/register")
        .send({ email: "court@example.com", password: "motdepasse123", name: "A", acceptConditions: true });

      const page = await agent.get("/api/chat");
      expect(page.body.messages).toEqual([]);
      expect(page.body.hasMore).toBe(false);
    });
  });

  describe("photo de profil", () => {
    it("n'est plus incluse dans les réponses courantes", async () => {
      const agent = request.agent(app);
      await agent
        .post("/api/auth/register")
        .send({ email: "photo@example.com", password: "motdepasse123", name: "A", acceptConditions: true });

      // 1x1 pixel PNG transparent.
      const image =
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
      const patch = await agent.patch("/api/auth/avatar").send({ avatarUrl: image });
      expect(patch.status).toBe(200);

      const me = await agent.get("/api/auth/me");
      // L'image pesait jusqu'à 400 Ko dans chaque réponse : elle n'y est plus.
      expect(me.body.avatarUrl).toBeUndefined();
      expect(me.body.avatarUpdatedAt).toBeTruthy();
      expect(JSON.stringify(me.body)).not.toContain("base64");
    });

    it("est servie par une route dédiée, mise en cache et privée", async () => {
      const agent = request.agent(app);
      await agent
        .post("/api/auth/register")
        .send({ email: "photo2@example.com", password: "motdepasse123", name: "A", acceptConditions: true });

      expect((await agent.get("/api/auth/avatar/me")).status).toBe(404);

      const image =
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
      await agent.patch("/api/auth/avatar").send({ avatarUrl: image });

      const res = await agent.get("/api/auth/avatar/me");
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toContain("image/png");
      expect(res.headers["cache-control"]).toContain("private");
    });

    it("exige une session", async () => {
      expect((await request(app).get("/api/auth/avatar/me")).status).toBe(401);
    });

    it("peut être retirée", async () => {
      const agent = request.agent(app);
      await agent
        .post("/api/auth/register")
        .send({ email: "photo3@example.com", password: "motdepasse123", name: "A", acceptConditions: true });
      const image =
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
      await agent.patch("/api/auth/avatar").send({ avatarUrl: image });

      const suppr = await agent.delete("/api/auth/avatar");
      expect(suppr.status).toBe(200);
      expect(suppr.body.avatarUpdatedAt).toBeNull();
      expect((await agent.get("/api/auth/avatar/me")).status).toBe(404);
    });
  });
});
