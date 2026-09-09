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
 * Réajustement en cours de semaine. Le cas le plus fréquent de la vraie vie :
 * l'athlète a manqué des séances et ne veut pas attendre lundi.
 */
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIfDb = TEST_DATABASE_URL ? describe : describe.skip;

let app: Express;
let prisma: import("@prisma/client").PrismaClient;
let resetAllRateLimits: () => void;

/** Semaine courante, en UTC, comme le serveur la calcule. */
function semaine(): string[] {
  const d = new Date();
  const day = d.getUTCDay();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + ((day === 0 ? -6 : 1) - day));
  return Array.from({ length: 7 }, (_, i) => {
    const x = new Date(d);
    x.setUTCDate(x.getUTCDate() + i);
    return x.toISOString().slice(0, 10);
  });
}

function aujourdHui(): string {
  return new Date().toISOString().slice(0, 10);
}

function reponse(dates: string[]) {
  return {
    text: JSON.stringify({
      sessions: dates.map((date, i) => ({
        date,
        sport: "course",
        titre: `Réajustée ${i}`,
        dureeMin: 40,
      })),
    }),
    model: "claude-sonnet-5",
    usage: { inputTokens: 900, outputTokens: 600, cacheReadTokens: 0, cacheWriteTokens: 0 },
  };
}

async function attendre(agent: ReturnType<typeof request.agent>, jobId: string) {
  for (let i = 0; i < 100; i++) {
    const { body } = await agent.get(`/api/plans/jobs/${jobId}`);
    if (body.status === "reussie" || body.status === "echouee") return body;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("Le réajustement ne s'est jamais terminé.");
}

describeIfDb("réajustement de la semaine", () => {
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

  /** Athlète avec un programme complet sur la semaine en cours. */
  async function athleteAvecSemaine(email: string) {
    const agent = request.agent(app);
    const res = await agent
      .post("/api/auth/register")
      .send({ email, password: "motdepasse123", name: "Athlète", acceptConditions: true });
    const user = res.body as { id: string };
    await agent.put("/api/profile").send({
      objectif: "Marathon",
      objectifDate: "2027-06-01",
      tempsCourse: "10km en 45min",
      heuresSemaine: 6,
    });

    const jours = semaine();
    const plan = await prisma.trainingPlan.create({
      data: {
        userId: user.id,
        weekStart: new Date(`${jours[0]}T00:00:00.000Z`),
        rawAiJson: "{}",
        sessions: {
          create: jours.map((jour, i) => ({
            userId: user.id,
            date: new Date(`${jour}T00:00:00.000Z`),
            sport: "course",
            titre: `Initiale ${i}`,
            dureeMin: 50,
          })),
        },
      },
      include: { sessions: true },
    });
    return { agent, user, jours, plan };
  }

  it("ne reconstruit que les jours restants et conserve le début de semaine", async () => {
    const { agent, user, jours } = await athleteAvecSemaine("ajuste@example.com");
    const restants = jours.filter((j) => j >= aujourdHui());
    const passes = jours.filter((j) => j < aujourdHui());

    // Le début de semaine est vécu : une réalisée, une manquée.
    const anciennes = await prisma.session.findMany({ where: { userId: user.id }, orderBy: { date: "asc" } });
    if (passes.length > 0) {
      await prisma.session.update({ where: { id: anciennes[0].id }, data: { status: "faite", ressenti: "ok" } });
    }

    askClaude.mockResolvedValue(reponse(restants));
    const lancement = await agent.post("/api/plans/adjust").send({ motif: "Déplacement professionnel" });
    expect(lancement.status).toBe(202);
    expect((await attendre(agent, lancement.body.id)).status).toBe("reussie");

    const apres = await prisma.session.findMany({ where: { userId: user.id }, orderBy: { date: "asc" } });
    // Une séance par jour de la semaine, ni plus ni moins.
    expect(apres).toHaveLength(7);

    for (const s of apres) {
      const jour = s.date.toISOString().slice(0, 10);
      if (jour < aujourdHui()) {
        expect(s.titre).toMatch(/^Initiale/);
      } else {
        expect(s.titre).toMatch(/^Réajustée/);
      }
    }
  });

  it("préserve une séance déjà réalisée, même dans les jours restants", async () => {
    const { agent, user } = await athleteAvecSemaine("preserve@example.com");
    const cible = await prisma.session.findFirstOrThrow({
      where: { userId: user.id, date: { gte: new Date(`${aujourdHui()}T00:00:00.000Z`) } },
      orderBy: { date: "asc" },
    });
    await prisma.session.update({
      where: { id: cible.id },
      data: { status: "faite", ressenti: "très bonne séance" },
    });

    const restants = semaine().filter((j) => j >= aujourdHui());
    askClaude.mockResolvedValue(reponse(restants));
    const lancement = await agent.post("/api/plans/adjust").send({});
    await attendre(agent, lancement.body.id);

    // Ce qui est fait est fait : le réajustement ne l'efface pas.
    const conservee = await prisma.session.findUnique({ where: { id: cible.id } });
    expect(conservee?.status).toBe("faite");
    expect(conservee?.ressenti).toBe("très bonne séance");
  });

  it("transmet au coach le motif et le bilan du début de semaine", async () => {
    const { agent, user } = await athleteAvecSemaine("motif@example.com");
    const premiere = await prisma.session.findFirstOrThrow({
      where: { userId: user.id },
      orderBy: { date: "asc" },
    });
    await prisma.session.update({ where: { id: premiere.id }, data: { status: "manquee" } });

    askClaude.mockResolvedValue(reponse(semaine().filter((j) => j >= aujourdHui())));
    const lancement = await agent.post("/api/plans/adjust").send({ motif: "Grosse fatigue et mal au genou" });
    await attendre(agent, lancement.body.id);

    const appel = askClaude.mock.calls[0][0] as { system: string; messages: { content: string }[] };
    expect(appel.messages[0].content).toContain("Grosse fatigue et mal au genou");
    // Le prompt doit interdire de rattraper tout le volume perdu.
    expect(appel.system).toContain("Ne cherche pas à rattraper tout le volume perdu");
    expect(appel.system).toContain("RÉAJUSTEMENT EN COURS DE SEMAINE");
  });

  it("écarte une réponse du modèle qui déborde sur les jours déjà passés", async () => {
    const { agent, user } = await athleteAvecSemaine("deborde@example.com");
    const jours = semaine();
    const passes = jours.filter((j) => j < aujourdHui());
    if (passes.length === 0) return; // lundi : rien à vérifier

    askClaude.mockResolvedValue(reponse(jours)); // le modèle renvoie TOUTE la semaine
    const lancement = await agent.post("/api/plans/adjust").send({});
    await attendre(agent, lancement.body.id);

    const apres = await prisma.session.findMany({ where: { userId: user.id }, orderBy: { date: "asc" } });
    for (const s of apres) {
      if (s.date.toISOString().slice(0, 10) < aujourdHui()) {
        expect(s.titre).toMatch(/^Initiale/);
      }
    }
  });

  it("refuse s'il n'y a pas de programme cette semaine", async () => {
    const agent = request.agent(app);
    await agent
      .post("/api/auth/register")
      .send({ email: "vide@example.com", password: "motdepasse123", name: "A", acceptConditions: true });
    await agent.put("/api/profile").send({
      objectif: "Marathon",
      objectifDate: "2027-06-01",
      heuresSemaine: 6,
    });

    const res = await agent.post("/api/plans/adjust").send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Aucun programme à réajuster");
    expect(askClaude).not.toHaveBeenCalled();
  });

  it("refuse un motif démesuré", async () => {
    const { agent } = await athleteAvecSemaine("longmotif@example.com");
    const res = await agent.post("/api/plans/adjust").send({ motif: "x".repeat(400) });
    expect(res.status).toBe(400);
  });

  it("garde toutes les séances de la semaine visibles après réajustement", async () => {
    const { agent, user } = await athleteAvecSemaine("visible@example.com");
    const premiere = await prisma.session.findFirstOrThrow({
      where: { userId: user.id },
      orderBy: { date: "asc" },
    });
    await prisma.session.update({ where: { id: premiere.id }, data: { status: "faite" } });

    askClaude.mockResolvedValue(reponse(semaine().filter((j) => j >= aujourdHui())));
    const lancement = await agent.post("/api/plans/adjust").send({});
    await attendre(agent, lancement.body.id);

    // Les séances conservées restent rattachées au plan d'origine : le
    // tableau de bord doit malgré tout afficher la semaine entière.
    const courant = await agent.get("/api/plans/current");
    expect(courant.body.sessions).toHaveLength(7);
    expect(courant.body.sessions.filter((s: { status: string }) => s.status === "faite")).toHaveLength(1);
  });
});
