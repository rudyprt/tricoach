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
 * Après un retrait du consentement santé, plus rien de santé ne part vers le
 * modèle : ni le profil, ni les ressentis, ni l'interruption, ni l'analyse de
 * course, ni le chat, son résumé et ses consignes, dans aucun des appels —
 * chat, réajustement de la semaine en cours, génération d'une semaine.
 *
 * Chaque donnée porte un marqueur ; le test relit tout ce qui a été envoyé.
 */
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIfDb = TEST_DATABASE_URL ? describe : describe.skip;

const MARQUEURS = [
  "TENDINITE-PROFIL",
  "RESSENTI-SEANCE",
  "MENISQUE-PAUSE",
  "CRAMPES-COURSE",
  "AXE-ANALYSE",
  "GENOU-CHAT",
  "RESUME-DOULEUR",
  "CONSIGNE-BLESSURE",
];

let app: Express;
let prisma: import("@prisma/client").PrismaClient;
let resetAllRateLimits: () => Promise<void>;

const LUNDI = "2026-09-14";
const jour = (d: number) => {
  const x = new Date(`${LUNDI}T00:00:00.000Z`);
  x.setUTCDate(x.getUTCDate() + d);
  return x.toISOString().slice(0, 10);
};

function texte(t: string) {
  return {
    text: t,
    toolUses: [],
    content: [{ type: "text", text: t }],
    stopReason: "end_turn",
    model: "claude-sonnet-5",
    usage: { inputTokens: 900, outputTokens: 300, cacheReadTokens: 0, cacheWriteTokens: 0 },
  };
}

/** Une semaine factice aux dates demandées dans le message utilisateur. */
function semaineDemandee(args: { messages: { content: unknown }[] }) {
  const demande = JSON.stringify(args.messages);
  const dates = [...new Set(demande.match(/\d{4}-\d{2}-\d{2}/g) ?? [])].filter((d) => d >= jour(2));
  return texte(JSON.stringify({ sessions: dates.map((date) => ({ date, sport: "course", titre: "Footing", dureeMin: 40 })) }));
}

async function attendre(agent: ReturnType<typeof request.agent>, jobId: string) {
  for (let i = 0; i < 100; i++) {
    const { body } = await agent.get(`/api/plans/jobs/${jobId}`);
    if (body.status === "reussie" || body.status === "echouee") return body;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("La génération ne s'est jamais terminée.");
}

const envoye = () => JSON.stringify(askClaude.mock.calls);

describeIfDb("plus aucune donnée de santé vers le modèle après un retrait", () => {
  beforeAll(async () => {
    // Un mercredi : le réajustement a des jours restants à reconstruire.
    vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
    vi.setSystemTime(new Date(`${jour(2)}T10:00:00.000Z`));
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    process.env.JWT_SECRET = "secret-de-test-suffisamment-long-pour-zod";
    process.env.NODE_ENV = "test";
    process.env.ANTHROPIC_API_KEY = "sk-ant-fake";
    ({ prisma } = await import("../lib/prisma.js"));
    ({ resetAllRateLimits } = await import("../lib/rateLimit.js"));
    app = (await import("../app.js")).createApp();
  });

  afterAll(async () => {
    vi.useRealTimers();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await resetAllRateLimits();
    askClaude.mockReset();
    askClaude.mockImplementation(async (args: { etiquette: string; messages: { content: unknown }[] }) =>
      args.etiquette.startsWith("chat") ? texte("Compris.") : semaineDemandee(args)
    );
    await prisma.user.deleteMany();
  });

  it("n'envoie plus rien de santé, ni au chat, ni aux générations", async () => {
    const agent = request.agent(app);
    const { body: user } = await agent
      .post("/api/auth/register")
      .send({ email: "retrait-ia@example.com", password: "motdepasse123", name: "Athlète", acceptConditions: true });
    await agent
      .put("/api/profile")
      .send({
        objectif: "Half Ironman",
        objectifDate: "2027-06-01",
        tempsCourse: "10km en 45min",
        heuresSemaine: 8,
        contraintes: "TENDINITE-PROFIL au genou",
        consentSante: true,
      })
      .expect(200);

    await prisma.trainingPlan.create({
      data: {
        userId: user.id,
        weekStart: new Date(`${LUNDI}T00:00:00.000Z`),
        rawAiJson: "{}",
        sessions: {
          create: [0, 1, 2, 3, 4, 5, 6].map((d) => ({
            userId: user.id,
            date: new Date(`${jour(d)}T00:00:00.000Z`),
            sport: "course",
            titre: "Footing",
            dureeMin: 45,
            ...(d === 0 ? { status: "faite", ressenti: "RESSENTI-SEANCE genou" } : {}),
          })),
        },
      },
    });
    await prisma.trainingPause.create({
      data: {
        userId: user.id,
        raison: "blessure",
        detail: "MENISQUE-PAUSE",
        debut: new Date("2026-08-20T00:00:00.000Z"),
        finReelle: new Date("2026-09-05T00:00:00.000Z"),
      },
    });
    await prisma.race.create({
      data: {
        userId: user.id,
        nom: "Triathlon de Paris",
        date: new Date("2026-09-06T00:00:00.000Z"),
        format: "olympique",
        resultat: { total: "2:31:00", ressenti: "CRAMPES-COURSE" },
        analyse: {
          resume: "Course solide.",
          segments: [{ segment: "course", constat: "Allure tenue.", conseil: "Continue." }],
          pointsForts: ["Natation"],
          axesProgres: [{ titre: "AXE-ANALYSE crampes", pourquoi: "Crampes.", travail: "Hydratation." }],
          prochaineCourse: "Bois plus.",
        },
      },
    });
    await prisma.chatMessage.createMany({
      data: [
        { userId: user.id, role: "user", content: "J'ai GENOU-CHAT depuis hier" },
        { userId: user.id, role: "assistant", content: "Repos alors." },
      ],
    });
    await prisma.resumeChat.create({ data: { userId: user.id, texte: "RESUME-DOULEUR au genou", jusquA: new Date() } });
    await prisma.consigneCoach.create({ data: { userId: user.id, texte: "CONSIGNE-BLESSURE : pas de fractionné" } });

    // Témoin : avant le retrait, le test voit bien passer ces données.
    await agent.post("/api/chat").send({ content: "Je fais quoi demain ?" }).expect(201);
    expect(envoye()).toContain("TENDINITE-PROFIL");
    expect(envoye()).toContain("GENOU-CHAT");

    await agent.delete("/api/privacy/sante").expect(200);
    askClaude.mockClear();

    await agent.post("/api/chat").send({ content: "Et pour la suite ?" }).expect(201);
    const ajustement = await agent.post("/api/plans/adjust").send({});
    expect(ajustement.status).toBe(202);
    expect((await attendre(agent, ajustement.body.id)).status).toBe("reussie");
    await resetAllRateLimits();
    const suivante = await agent.post("/api/plans/generate").send({});
    expect(suivante.status).toBe(202);
    await attendre(agent, suivante.body.id);

    const etiquettes = askClaude.mock.calls.map((c) => (c[0] as { etiquette: string }).etiquette);
    expect(etiquettes).toContain("chat");
    expect(etiquettes.length).toBeGreaterThanOrEqual(3);
    for (const m of MARQUEURS) expect(envoye()).not.toContain(m);
  });

  it("refuse le retrait pendant la génération d'une semaine", async () => {
    const agent = request.agent(app);
    const { body: user } = await agent
      .post("/api/auth/register")
      .send({ email: "retrait-pendant@example.com", password: "motdepasse123", name: "Athlète", acceptConditions: true });
    await prisma.generationJob.create({ data: { userId: user.id, kind: "semaine_suivante", status: "en_cours" } });
    expect((await agent.delete("/api/privacy/sante")).status).toBe(409);
  });
});
