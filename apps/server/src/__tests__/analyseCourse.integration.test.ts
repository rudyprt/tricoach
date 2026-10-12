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
 * Analyse d'une course disputée : réservée à l'offre Premium, après la course,
 * et nourrie de chiffres calculés par le serveur.
 */
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIfDb = TEST_DATABASE_URL ? describe : describe.skip;

let app: Express;
let prisma: import("@prisma/client").PrismaClient;
let resetAllRateLimits: () => Promise<void>;

const ANALYSE = {
  resume: "Belle course, gâchée par un vélo trop rapide.",
  segments: [
    { segment: "velo", constat: "Vélo à 34,3 km/h, au-dessus de ton plan.", conseil: "Reste en Z3." },
    { segment: "course", constat: "Course à 5:12/km, loin de ton allure.", conseil: "Pars plus prudemment." },
  ],
  pointsForts: ["Natation régulière"],
  axesProgres: [
    { titre: "Enchaînement vélo-course", pourquoi: "La course s'est effondrée.", travail: "Enchaînés vélo puis 15 min de course." },
  ],
  prochaineCourse: "Gère le vélo à la puissance.",
};

function reponse(text: string) {
  return {
    text,
    toolUses: [],
    content: [{ type: "text", text }],
    stopReason: "end_turn",
    model: "claude-sonnet-5",
    usage: { inputTokens: 1500, outputTokens: 600, cacheReadTokens: 0, cacheWriteTokens: 0 },
  };
}

const RESULTAT = {
  natation: "30:00",
  t1: "2:30",
  velo: "1:10:00",
  t2: "1:30",
  course: "52:00",
  fcVelo: 158,
  ressenti: "Crampes au km 6.",
};

describeIfDb("analyse de course", () => {
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
    await prisma.aiCall.deleteMany();
    await prisma.race.deleteMany();
    await prisma.athleteProfile.deleteMany();
    await prisma.user.deleteMany();
  });

  async function athlete(email: string, plan: "premium" | "standard", ilYAJours = 2) {
    const agent = request.agent(app);
    const res = await agent
      .post("/api/auth/register")
      .send({ email, password: "motdepasse123", name: "Athlète", acceptConditions: true });
    const user = res.body as { id: string };
    await prisma.user.update({ where: { id: user.id }, data: { plan } });
    await prisma.athleteProfile.create({
      data: {
        userId: user.id,
        objectif: "Triathlon M",
        objectifDate: new Date("2027-06-01T00:00:00.000Z"),
        heuresSemaine: 8,
        tempsCourse: "10km en 45min",
      },
    });
    const date = new Date(`${new Date(Date.now() - ilYAJours * 86400000).toISOString().slice(0, 10)}T00:00:00.000Z`);
    const course = await prisma.race.create({
      data: { userId: user.id, nom: "Triathlon de Paris", date, format: "olympique", priorite: "A", objectifTemps: "2h30" },
    });
    return { agent, user, course };
  }

  it("analyse la course d'un athlète Premium à partir de chiffres calculés", async () => {
    const { agent, course } = await athlete("premium@example.com", "premium");
    askClaude.mockResolvedValue(reponse(JSON.stringify(ANALYSE)));

    const res = await agent.post(`/api/races/${course.id}/analyse`).send(RESULTAT);

    expect(res.status).toBe(200);
    expect(res.body.analyse.axesProgres[0].titre).toBe("Enchaînement vélo-course");
    expect(res.body.chiffres.total).toBe("2:36:00");

    // Le modèle reçoit les allures calculées, pas à refaire.
    const prompt = askClaude.mock.calls[0][0].messages[0].content as string;
    expect(prompt).toContain("Vélo : 1:10:00");
    expect(prompt).toContain("34.3 km/h");
    expect(prompt).toContain("FC moyenne 158");
    expect(prompt).toContain("5:12/km");
    expect(prompt).toContain("Écart au temps visé : +6:00");
    expect(prompt).toContain("Crampes au km 6.");

    const relue = await agent.get(`/api/races/${course.id}/analyse`);
    expect(relue.body.analyse.resume).toBe(ANALYSE.resume);
    expect(relue.body.resultat.velo).toBe("1:10:00");
    expect((await agent.get("/api/races")).body.courses[0].analysee).toBe(true);
    expect(await prisma.aiCall.count({ where: { kind: "analyse_course" } })).toBe(1);
  });

  it("analyse aussi une épreuve de course à pied seule", async () => {
    const { agent, user } = await athlete("dix-km@example.com", "premium");
    const date = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    // Inscrite par l'API : la distance remplace le format de triathlon.
    await prisma.race.create({
      data: { userId: user.id, nom: "10 km de Paris", date: new Date(`${date}T00:00:00.000Z`), discipline: "course", distanceKm: 10 },
    });
    const course = await prisma.race.findFirstOrThrow({ where: { userId: user.id, discipline: "course" } });
    askClaude.mockResolvedValue(reponse(JSON.stringify({ ...ANALYSE, segments: [ANALYSE.segments[1]] })));

    const res = await agent.post(`/api/races/${course.id}/analyse`).send({ total: "44:30", fcCourse: 174 });

    expect(res.status).toBe(200);
    expect(res.body.chiffres.segments).toHaveLength(1);
    const prompt = askClaude.mock.calls[0][0].messages[0].content as string;
    expect(prompt).toContain("Course à pied — 10 km");
    expect(prompt).toContain("Course à pied : 44:30");
    expect(prompt).toContain("4:27/km, FC moyenne 174");
    expect(prompt).toContain("pas de transitions");
    expect(prompt).not.toContain("plan de course");
  });

  it("inscrit une épreuve d'une seule discipline avec sa distance, sans plan de triathlon", async () => {
    const { agent } = await athlete("cyclo@example.com", "premium");
    const dans30 = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);

    expect((await agent.post("/api/races").send({ nom: "Cyclo", date: dans30, discipline: "velo" })).status).toBe(400);
    const res = await agent
      .post("/api/races")
      .send({ nom: "L'Étape du Tour", date: dans30, discipline: "velo", distanceKm: 168, format: "ironman", priorite: "B" });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ discipline: "velo", distanceKm: 168, format: "autre", formatLabel: "Vélo — 168 km" });
    expect((await agent.post(`/api/races/${res.body.id}/plan`)).status).toBe(400);
  });

  it("est réservée à l'offre Premium", async () => {
    const { agent, course } = await athlete("standard@example.com", "standard");

    const res = await agent.post(`/api/races/${course.id}/analyse`).send(RESULTAT);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("PREMIUM_REQUIRED");
    expect(askClaude).not.toHaveBeenCalled();
  });

  it("attend que la course ait eu lieu", async () => {
    const { agent, course } = await athlete("futur@example.com", "premium", -10);

    const res = await agent.post(`/api/races/${course.id}/analyse`).send(RESULTAT);

    expect(res.status).toBe(400);
    expect(askClaude).not.toHaveBeenCalled();
  });

  it("garde le résultat saisi quand l'analyse échoue", async () => {
    const { agent, course } = await athlete("echec@example.com", "premium");
    askClaude.mockResolvedValue(reponse("pas de JSON"));

    const res = await agent.post(`/api/races/${course.id}/analyse`).send(RESULTAT);

    expect(res.status).toBe(502);
    const relue = await agent.get(`/api/races/${course.id}/analyse`);
    expect(relue.body.resultat.course).toBe("52:00");
    expect(relue.body.analyse).toBeNull();
  });

  it("refuse un temps mal saisi", async () => {
    const { agent, course } = await athlete("saisie@example.com", "premium");

    const res = await agent.post(`/api/races/${course.id}/analyse`).send({ velo: "1h10" });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("h:mm:ss");
  });

  it("ne laisse pas analyser la course d'un autre athlète", async () => {
    const { course } = await athlete("proprietaire@example.com", "premium");
    const { agent: intrus } = await athlete("intrus@example.com", "premium");

    expect((await intrus.post(`/api/races/${course.id}/analyse`).send(RESULTAT)).status).toBe(404);
    expect((await intrus.get(`/api/races/${course.id}/analyse`)).status).toBe(404);
  });
});
