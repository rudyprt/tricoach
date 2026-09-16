import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";

/**
 * Interruptions d'entraînement. Le point qui compte : pendant une pause, rien
 * ne doit être généré, et les séances prévues ne doivent pas rester à l'écran
 * en attendant d'être marquées « manquées » une par une.
 */
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIfDb = TEST_DATABASE_URL ? describe : describe.skip;

let app: Express;
let prisma: import("@prisma/client").PrismaClient;
let resetAllRateLimits: () => Promise<void>;

describeIfDb("interruptions d'entraînement", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    process.env.JWT_SECRET = "secret-de-test-suffisamment-long-pour-zod";
    process.env.ANTHROPIC_API_KEY = "cle-de-test";
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
    await prisma.trainingPause.deleteMany();
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
    const user = res.body as { id: string };

    await prisma.athleteProfile.create({
      data: {
        userId: user.id,
        objectif: "Triathlon olympique",
        objectifDate: new Date(Date.now() + 120 * 86400000),
        heuresSemaine: 8,
      },
    });
    return { agent, user };
  }

  /** Une semaine planifiée : une séance hier, une aujourd'hui, une demain. */
  async function semaineEnCours(userId: string) {
    const jour = (decalage: number) => {
      const d = new Date();
      d.setUTCHours(0, 0, 0, 0);
      d.setUTCDate(d.getUTCDate() + decalage);
      return d;
    };
    await prisma.trainingPlan.create({
      data: {
        userId,
        weekStart: jour(-3),
        rawAiJson: "{}",
        sessions: {
          create: [
            { userId, date: jour(-1), sport: "course", titre: "Hier", dureeMin: 45, status: "faite" },
            { userId, date: jour(0), sport: "velo", titre: "Aujourd'hui", dureeMin: 60, status: "planifiee" },
            { userId, date: jour(2), sport: "natation", titre: "Plus tard", dureeMin: 45, status: "planifiee" },
          ],
        },
      },
    });
  }

  it("déclare une pause et retire les séances encore à venir", async () => {
    const { agent, user } = await athlete("pause@example.com");
    await semaineEnCours(user.id);

    const res = await agent.post("/api/pauses").send({ raison: "blessure", detail: "genou droit" });

    expect(res.status).toBe(201);
    const restantes = await prisma.session.findMany({ where: { userId: user.id } });
    // La séance réalisée hier est conservée : elle fait partie de l'historique.
    expect(restantes).toHaveLength(1);
    expect(restantes[0].status).toBe("faite");
  });

  it("refuse de générer une semaine pendant une pause", async () => {
    const { agent } = await athlete("bloque@example.com");
    await agent.post("/api/pauses").send({ raison: "maladie" });

    const res = await agent.post("/api/plans/generate");

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("TRAINING_PAUSED");
  });

  it("expose l'état d'entraînement", async () => {
    const { agent } = await athlete("etat@example.com");

    expect((await agent.get("/api/pauses")).body.etat).toBe("normal");

    await agent.post("/api/pauses").send({ raison: "indisponibilite", detail: "déplacement" });
    const enPause = await agent.get("/api/pauses");
    expect(enPause.body.etat).toBe("en_pause");
    expect(enPause.body.pause.libelle).toBe("indisponibilité");
  });

  it("n'autorise qu'une interruption à la fois", async () => {
    const { agent } = await athlete("double@example.com");
    await agent.post("/api/pauses").send({ raison: "blessure" });

    expect((await agent.post("/api/pauses").send({ raison: "maladie" })).status).toBe(400);
  });

  it("permet de reprendre et rouvre la génération", async () => {
    const { agent, user } = await athlete("reprise@example.com");
    await agent.post("/api/pauses").send({ raison: "blessure" });

    const reprise = await agent.post("/api/pauses/reprendre");
    expect(reprise.status).toBe(200);
    expect(reprise.body.pause.finReelle).not.toBeNull();

    expect((await agent.get("/api/pauses")).body.etat).toBe("normal");
    expect(await prisma.trainingPause.count({ where: { userId: user.id, finReelle: null } })).toBe(0);
  });

  it("signale une reprise en cours après un arrêt long", async () => {
    const { agent, user } = await athlete("progressive@example.com");
    // Un arrêt de trois semaines, terminé aujourd'hui.
    await prisma.trainingPause.create({
      data: {
        userId: user.id,
        raison: "blessure",
        debut: new Date(Date.now() - 21 * 86400000),
        finReelle: new Date(),
      },
    });

    const res = await agent.get("/api/pauses");

    expect(res.body.etat).toBe("en_reprise");
    expect(res.body.reprise.total).toBe(3);
    expect(res.body.reprise.facteurVolume).toBeLessThan(1);
  });

  it("refuse une reprise sans interruption en cours", async () => {
    const { agent } = await athlete("rien@example.com");
    expect((await agent.post("/api/pauses/reprendre")).status).toBe(400);
  });

  it("refuse un motif inconnu et une précision démesurée", async () => {
    const { agent } = await athlete("invalide@example.com");

    expect((await agent.post("/api/pauses").send({ raison: "flemme" })).status).toBe(400);
    expect((await agent.post("/api/pauses").send({ raison: "blessure", detail: "x".repeat(501) })).status).toBe(400);
  });

  it("n'expose jamais l'interruption d'un autre athlète", async () => {
    const { agent: premier } = await athlete("premier@example.com");
    await premier.post("/api/pauses").send({ raison: "blessure" });

    const { agent: second } = await athlete("second@example.com");
    expect((await second.get("/api/pauses")).body.etat).toBe("normal");
  });
});
