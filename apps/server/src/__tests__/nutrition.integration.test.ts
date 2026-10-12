import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { Express } from "express";

const askClaude = vi.fn();
vi.mock("../lib/anthropic.js", () => ({
  askClaude: (...args: unknown[]) => askClaude(...args),
  isAiConfigured: () => true,
  AiNotConfiguredError: class extends Error {},
}));

/**
 * Nutrition (offre Premium) : préférences, tests de sudation, journal de
 * tolérance, et ce qu'ils changent au ravitaillement de chaque séance comme au
 * plan de course.
 */
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIfDb = TEST_DATABASE_URL ? describe : describe.skip;

let app: Express;
let prisma: import("@prisma/client").PrismaClient;
let resetAllRateLimits: () => Promise<void>;

const jour = (n: number) => new Date(`${new Date(Date.now() + n * 86400000).toISOString().slice(0, 10)}T00:00:00.000Z`);

describeIfDb("nutrition", () => {
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
    askClaude.mockReset();
    await prisma.race.deleteMany();
    await prisma.trainingPlan.deleteMany();
    await prisma.user.deleteMany();
  });

  async function athlete(email: string, plan: "premium" | "standard" = "premium") {
    const agent = request.agent(app);
    const res = await agent
      .post("/api/auth/register")
      .send({ email, password: "motdepasse123", name: "Athlète", acceptConditions: true });
    const user = res.body as { id: string };
    await prisma.user.update({ where: { id: user.id }, data: { plan } });
    const semaine = await prisma.trainingPlan.create({
      data: {
        userId: user.id,
        weekStart: jour(-1),
        rawAiJson: "{}",
        sessions: {
          create: [
            {
              userId: user.id,
              date: jour(-1),
              sport: "velo",
              titre: "Sortie longue",
              dureeMin: 180,
              structure: {
                echauffement: { dureeMin: 20, cible: "Z1", description: "" },
                corps: { dureeMin: 150, cible: "Z2 endurance", description: "" },
                retourCalme: { dureeMin: 10, cible: "Z1", description: "" },
              },
            },
            { userId: user.id, date: jour(0), sport: "course", titre: "Footing", dureeMin: 45 },
          ],
        },
      },
      include: { sessions: { orderBy: { date: "asc" } } },
    });
    return { agent, user, longue: semaine.sessions[0] };
  }

  it("est réservée à l'offre Premium", async () => {
    const { agent, longue } = await athlete("standard@example.com", "standard");
    expect((await agent.get("/api/nutrition")).status).toBe(403);
    const res = await agent.get(`/api/nutrition/seance/${longue.id}`);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("PREMIUM_REQUIRED");
  });

  it("calcule le ravitaillement d'une séance, puis l'ajuste à la sudation et au journal", async () => {
    const { agent, longue } = await athlete("premium@example.com");

    const avant = (await agent.get(`/api/nutrition/seance/${longue.id}`)).body.ravitaillement;
    expect(avant.pendant.glucidesGH).toBeGreaterThanOrEqual(60);
    expect(avant.pendant.boissonMlH).toBe(600);
    // Une séance le lendemain : la récupération est prioritaire.
    expect(avant.apres.join(" ")).toContain("demain");

    await agent.put("/api/nutrition/profil").send({ poidsKg: 72, formats: ["boisson", "gel"], cafeine: false });
    const test = await agent.post("/api/nutrition/tests-sudation").send({
      date: jour(-3).toISOString().slice(0, 10),
      sport: "velo",
      dureeMin: 60,
      poidsAvantKg: 72,
      poidsApresKg: 71.2,
      boissonMl: 400,
    });
    expect(test.status).toBe(201);
    expect(test.body.tauxMlH).toBe(1200);

    // Il a pris 150 g en 3 h et les a bien tolérés : 50 g/h.
    const journal = await agent
      .put(`/api/nutrition/seance/${longue.id}/journal`)
      .send({ glucidesG: 150, boissonMl: 1800, tolerance: "bien" });
    expect(journal.status).toBe(200);

    const apres = (await agent.get(`/api/nutrition/seance/${longue.id}`)).body;
    expect(apres.ravitaillement.pendant.boissonMlH).toBe(850);
    expect(apres.ravitaillement.pendant.glucidesGH).toBe(60);
    // 850 ml de boisson à 6 % apportent déjà l'essentiel des 60 g.
    expect(apres.ravitaillement.pendant.exemple).toContain("850 ml de boisson d'effort à 6 % (51 g)");
    expect(apres.journal).toMatchObject({ glucidesG: 150, tolerance: "bien" });

    const resume = (await agent.get("/api/nutrition")).body;
    expect(resume).toMatchObject({ toleranceGH: 50, sudation: { velo: 1200 }, profil: { poidsKg: 72 } });
  });

  it("entraîne l'estomac à l'approche d'un Ironman", async () => {
    const { agent, user, longue } = await athlete("ironman@example.com");
    await prisma.race.create({ data: { userId: user.id, nom: "Ironman de Nice", date: jour(70), format: "ironman" } });

    const r = (await agent.get(`/api/nutrition/seance/${longue.id}`)).body.ravitaillement;
    expect(r.entrainementDigestif).toContain("Ironman de Nice");
  });

  it("refuse des pesées incohérentes", async () => {
    const { agent } = await athlete("pesee@example.com");
    const res = await agent.post("/api/nutrition/tests-sudation").send({
      date: "2026-10-01",
      sport: "course",
      dureeMin: 60,
      poidsAvantKg: 70,
      poidsApresKg: 62,
    });
    expect(res.status).toBe(400);
  });

  it("ne touche pas aux séances d'un autre athlète", async () => {
    const { longue } = await athlete("proprio@example.com");
    const { agent: intrus } = await athlete("intrus@example.com");
    expect((await intrus.get(`/api/nutrition/seance/${longue.id}`)).status).toBe(404);
    const res = await intrus.put(`/api/nutrition/seance/${longue.id}/journal`).send({ glucidesG: 10, tolerance: "bien" });
    expect(res.status).toBe(404);
  });

  it("donne au plan de course les doses tolérées à l'entraînement", async () => {
    const { agent, user, longue } = await athlete("plan@example.com");
    await agent.put(`/api/nutrition/seance/${longue.id}/journal`).send({ glucidesG: 210, tolerance: "bien" });
    const course = await prisma.race.create({ data: { userId: user.id, nom: "Half de Vichy", date: jour(40), format: "half" } });
    askClaude.mockResolvedValue({ text: "pas de json", usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }, model: "m" });

    await agent.post(`/api/races/${course.id}/plan`);

    const prompt = askClaude.mock.calls[0][0].messages[0].content as string;
    expect(prompt).toContain("REPÈRES NUTRITION PERSONNELS");
    expect(prompt).toContain("vélo 70 g de glucides/h");
    expect(prompt).toContain("tolérées à l'entraînement");
  });
});
