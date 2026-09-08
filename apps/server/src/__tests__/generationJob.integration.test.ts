import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { Express } from "express";

const askClaude = vi.fn();

vi.mock("../lib/anthropic.js", () => ({
  askClaude: (...args: unknown[]) => askClaude(...args),
  isAiConfigured: () => true,
  MODEL: "claude-sonnet-5",
  AiNotConfiguredError: class extends Error {},
}));

/**
 * La génération est longue : elle tourne en tâche de fond et l'athlète suit son
 * avancement. Ces tests vérifient ce cycle de bout en bout.
 */
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIfDb = TEST_DATABASE_URL ? describe : describe.skip;

let app: Express;
let prisma: import("@prisma/client").PrismaClient;
let resetAllRateLimits: () => void;

const WEEK = () => {
  const d = new Date();
  const day = d.getUTCDay();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + ((day === 0 ? -6 : 1) - day));
  return Array.from({ length: 7 }, (_, i) => {
    const x = new Date(d);
    x.setUTCDate(x.getUTCDate() + i);
    return x.toISOString().slice(0, 10);
  });
};

function planReply(dates: string[]) {
  return {
    text: JSON.stringify({
      sessions: dates.map((date, i) => ({
        date,
        sport: i === 6 ? "repos" : "course",
        titre: i === 6 ? "Repos" : `Séance ${i}`,
        dureeMin: i === 6 ? 0 : 45,
      })),
    }),
    model: "claude-sonnet-5",
    usage: { inputTokens: 1500, outputTokens: 2000, cacheReadTokens: 0, cacheWriteTokens: 0 },
  };
}

/** Attend qu'une génération se termine, sans jamais boucler indéfiniment. */
async function waitForJob(agent: ReturnType<typeof request.agent>, jobId: string) {
  for (let i = 0; i < 100; i++) {
    const { body } = await agent.get(`/api/plans/jobs/${jobId}`);
    if (body.status === "reussie" || body.status === "echouee") return body;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("La génération ne s'est jamais terminée.");
}

describeIfDb("génération en tâche de fond", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    process.env.JWT_SECRET = "secret-de-test-suffisamment-long-pour-zod";
    process.env.NODE_ENV = "test";
    process.env.ANTHROPIC_API_KEY = "sk-ant-fake";

    ({ prisma } = await import("../lib/prisma.js"));
    ({ resetAllRateLimits } = await import("../lib/rateLimit.js"));
    app = (await import("../app.js")).createApp();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    resetAllRateLimits();
    askClaude.mockReset();
    await prisma.generationJob.deleteMany();
    await prisma.aiCall.deleteMany();
    await prisma.session.deleteMany();
    await prisma.trainingPlan.deleteMany();
    await prisma.athleteProfile.deleteMany();
    await prisma.user.deleteMany();
  });

  async function athlete(email: string) {
    const agent = request.agent(app);
    const res = await agent.post("/api/auth/register").send({ email, password: "motdepasse123", name: "Athlète", acceptConditions: true });
    expect(res.status).toBe(201);
    await agent.put("/api/profile").send({
      objectif: "Marathon",
      objectifDate: "2027-06-01",
      tempsCourse: "10km en 45min",
      heuresSemaine: 6,
    });
    return { agent, user: res.body as { id: string } };
  }

  it("répond immédiatement puis produit le programme en arrière-plan", async () => {
    const { agent } = await athlete("async@example.com");
    const dates = WEEK();

    // Le modèle met du temps : c'est précisément ce qui ne doit plus bloquer
    // la requête HTTP.
    askClaude.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(planReply(dates)), 300))
    );

    const started = Date.now();
    const lancement = await agent.post("/api/plans/generate");
    const dureeReponse = Date.now() - started;

    expect(lancement.status).toBe(202);
    expect(lancement.body.status).toBe("en_attente");
    expect(dureeReponse).toBeLessThan(250);

    const fini = await waitForJob(agent, lancement.body.id);
    expect(fini.status).toBe("reussie");
    expect(fini.planId).toBeTruthy();

    const plan = await agent.get("/api/plans/current");
    expect(plan.body.sessions).toHaveLength(7);
  });

  it("ne lance pas deux générations en parallèle", async () => {
    const { agent } = await athlete("double@example.com");
    const dates = WEEK();
    askClaude.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(planReply(dates)), 300))
    );

    const premier = await agent.post("/api/plans/generate");
    const second = await agent.post("/api/plans/generate");

    // Un double appui renvoie la génération en cours, sans second appel facturé.
    expect(second.body.id).toBe(premier.body.id);
    await waitForJob(agent, premier.body.id);
    expect(askClaude).toHaveBeenCalledTimes(1);
  });

  it("enregistre l'échec sur la tâche au lieu de le perdre", async () => {
    const { agent } = await athlete("echec@example.com");
    askClaude.mockRejectedValue(new Error("API indisponible"));

    const lancement = await agent.post("/api/plans/generate");
    expect(lancement.status).toBe(202);

    const fini = await waitForJob(agent, lancement.body.id);
    expect(fini.status).toBe("echouee");
    expect(fini.error).toContain("Réessayez");
    expect((await agent.get("/api/plans/current")).body).toBeNull();
  });

  it("refuse tout de suite si le profil manque, sans créer de tâche", async () => {
    const agent = request.agent(app);
    await agent.post("/api/auth/register").send({ email: "sansprofil@example.com", password: "motdepasse123", name: "X", acceptConditions: true });

    const res = await agent.post("/api/plans/generate");
    expect(res.status).toBe(400);
    expect(await prisma.generationJob.count()).toBe(0);
    expect(askClaude).not.toHaveBeenCalled();
  });

  it("refuse tout de suite une progression sans semaine précédente", async () => {
    const { agent } = await athlete("sanshisto@example.com");
    const res = await agent.post("/api/plans/next");
    expect(res.status).toBe(400);
    expect(await prisma.generationJob.count()).toBe(0);
  });

  it("permet de reprendre le suivi après avoir quitté l'écran", async () => {
    const { agent } = await athlete("reprise@example.com");
    const dates = WEEK();
    askClaude.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(planReply(dates)), 200))
    );

    const lancement = await agent.post("/api/plans/generate");
    const latest = await agent.get("/api/plans/jobs/latest");
    expect(latest.body.id).toBe(lancement.body.id);

    await waitForJob(agent, lancement.body.id);
    expect((await agent.get("/api/plans/jobs/latest")).body.status).toBe("reussie");
  });

  it("présente comme échouée une tâche restée en cours après un redémarrage", async () => {
    const { agent, user } = await athlete("perdue@example.com");
    await prisma.generationJob.create({
      data: {
        userId: user.id,
        kind: "premiere_semaine",
        status: "en_cours",
        startedAt: new Date(Date.now() - 60 * 60 * 1000),
      },
    });

    const latest = await agent.get("/api/plans/jobs/latest");
    expect(latest.body.status).toBe("echouee");
    expect(latest.body.error).toContain("interrompue");

    // Et une tâche fantôme ne doit pas bloquer une nouvelle génération.
    askClaude.mockResolvedValue(planReply(WEEK()));
    expect((await agent.post("/api/plans/generate")).status).toBe(202);
  });

  it("n'expose pas la génération d'un autre athlète", async () => {
    const { agent: alice, user } = await athlete("alice-job@example.com");
    askClaude.mockResolvedValue(planReply(WEEK()));
    const job = await alice.post("/api/plans/generate");
    await waitForJob(alice, job.body.id);

    resetAllRateLimits();
    const { agent: bob } = await athlete("bob-job@example.com");
    expect((await bob.get(`/api/plans/jobs/${job.body.id}`)).status).toBe(404);
    expect((await bob.get("/api/plans/jobs/latest")).body).toBeNull();
    expect(await prisma.generationJob.count({ where: { userId: user.id } })).toBe(1);
  });
});
