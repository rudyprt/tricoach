import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";

/** Le message de félicitations, servi pour une séance faite. */
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIfDb = TEST_DATABASE_URL ? describe : describe.skip;

let app: Express;
let prisma: import("@prisma/client").PrismaClient;
let resetAllRateLimits: () => Promise<void>;

describeIfDb("félicitations après une séance", () => {
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
    await prisma.trainingPlan.deleteMany();
    await prisma.user.deleteMany();
  });

  async function athlete(email: string, plan: "premium" | "standard") {
    const agent = request.agent(app);
    const res = await agent
      .post("/api/auth/register")
      .send({ email, password: "motdepasse123", name: "Athlète", acceptConditions: true });
    const user = res.body as { id: string };
    await prisma.user.update({ where: { id: user.id }, data: { plan } });
    const semaine = await prisma.trainingPlan.create({
      data: {
        userId: user.id,
        weekStart: new Date("2026-10-12T00:00:00.000Z"),
        rawAiJson: "{}",
        sessions: {
          create: [
            { userId: user.id, date: new Date("2026-10-13T00:00:00.000Z"), sport: "velo", titre: "Sortie longue", dureeMin: 150, status: "faite" },
            { userId: user.id, date: new Date("2026-10-14T00:00:00.000Z"), sport: "course", titre: "Seuil", dureeMin: 50 },
          ],
        },
      },
      include: { sessions: { orderBy: { date: "asc" } } },
    });
    return { agent, faite: semaine.sessions[0], aVenir: semaine.sessions[1] };
  }

  it("ajoute la nutrition de récupération pour l'offre Premium", async () => {
    const { agent, faite } = await athlete("premium-bravo@example.com", "premium");
    const res = await agent.get(`/api/sessions/${faite.id}/felicitations`);
    expect(res.status).toBe(200);
    expect(res.body.premium).toBe(true);
    expect(res.body.felicitations.resume[0]).toContain("Sortie longue : 150 min");
    expect(res.body.felicitations.nutrition.join(" ")).toContain("Protéines");
    expect(res.body.felicitations.recuperation.join(" ")).toContain("Demain : Seuil");
  });

  it("donne sommeil, activité et hydratation aux autres offres", async () => {
    const { agent, faite } = await athlete("standard-bravo@example.com", "standard");
    const res = await agent.get(`/api/sessions/${faite.id}/felicitations`);
    expect(res.body.premium).toBe(false);
    expect(res.body.felicitations.nutrition).toBeNull();
    expect(res.body.felicitations.recuperation.join(" ")).toMatch(/Sommeil.*Hydratation.*Activité/s);
  });

  it("ne félicite pas une séance pas encore faite", async () => {
    const { agent, aVenir } = await athlete("pas-encore@example.com", "standard");
    expect((await agent.get(`/api/sessions/${aVenir.id}/felicitations`)).body.felicitations).toBeNull();
  });
});
