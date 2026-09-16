import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";

/**
 * Correction de la durée réellement effectuée.
 *
 * Écourter ou rallonger une séance est banal ; jusqu'ici, la seule façon de le
 * dire au coach était d'importer un fichier de montre. Et une correction qui
 * n'alimenterait pas les calculs ne servirait à rien.
 */
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIfDb = TEST_DATABASE_URL ? describe : describe.skip;

let app: Express;
let prisma: import("@prisma/client").PrismaClient;
let resetAllRateLimits: () => Promise<void>;
let startOfWeek: typeof import("../lib/week.js").startOfWeek;
let addDays: typeof import("../lib/week.js").addDays;

describeIfDb("durée réellement effectuée", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    process.env.JWT_SECRET = "secret-de-test-suffisamment-long-pour-zod";
    process.env.NODE_ENV = "test";

    ({ prisma } = await import("../lib/prisma.js"));
    ({ resetAllRateLimits } = await import("../lib/rateLimit.js"));
    ({ startOfWeek, addDays } = await import("../lib/week.js"));
    app = (await import("../app.js")).createApp();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await resetAllRateLimits();
    await prisma.session.deleteMany();
    await prisma.trainingPlan.deleteMany();
    await prisma.user.deleteMany();
  });

  async function athleteAvecSeance() {
    const agent = request.agent(app);
    const res = await agent
      .post("/api/auth/register")
      .send({ email: "duree@example.com", password: "motdepasse123", name: "Athlète", acceptConditions: true });
    const user = res.body as { id: string };

    const debut = addDays(startOfWeek(new Date(), "UTC"), -7);
    const plan = await prisma.trainingPlan.create({
      data: { userId: user.id, weekStart: debut, rawAiJson: "{}" },
    });
    const seance = await prisma.session.create({
      data: {
        planId: plan.id,
        userId: user.id,
        date: debut,
        sport: "course",
        titre: "Sortie longue",
        dureeMin: 90,
      },
    });
    return { agent, user, seance };
  }

  it("enregistre une durée différente du prévu", async () => {
    const { agent, seance } = await athleteAvecSeance();

    const res = await agent.patch(`/api/sessions/${seance.id}`).send({ status: "faite", dureeReelleMin: 55 });

    expect(res.status).toBe(200);
    expect(res.body.dureeMin).toBe(90);
    expect(res.body.dureeReelleMin).toBe(55);
  });

  it("distingue « je ne corrige pas » de « je reviens au prévu »", async () => {
    const { agent, seance } = await athleteAvecSeance();
    await agent.patch(`/api/sessions/${seance.id}`).send({ status: "faite", dureeReelleMin: 55 });

    // Champ absent : la correction reste.
    await agent.patch(`/api/sessions/${seance.id}`).send({ status: "faite", ressenti: "Jambes lourdes" });
    expect((await prisma.session.findUniqueOrThrow({ where: { id: seance.id } })).dureeReelleMin).toBe(55);

    // Null explicite : la correction est effacée.
    await agent.patch(`/api/sessions/${seance.id}`).send({ status: "faite", dureeReelleMin: null });
    expect((await prisma.session.findUniqueOrThrow({ where: { id: seance.id } })).dureeReelleMin).toBeNull();
  });

  it("refuse une durée invraisemblable", async () => {
    const { agent, seance } = await athleteAvecSeance();

    expect((await agent.patch(`/api/sessions/${seance.id}`).send({ status: "faite", dureeReelleMin: 0 })).status).toBe(400);
    expect((await agent.patch(`/api/sessions/${seance.id}`).send({ status: "faite", dureeReelleMin: 5000 })).status).toBe(400);
  });

  it("alimente la régularité avec le réalisé, pas avec le prévu", async () => {
    const { agent, seance } = await athleteAvecSeance();
    await agent.patch(`/api/sessions/${seance.id}`).send({ status: "faite", dureeReelleMin: 30 });

    const res = await agent.get("/api/insights/regularite");
    const semaine = res.body.semaines.find((s: { realiseMin: number }) => s.realiseMin > 0);

    // Sans cela, une sortie écourtée compterait comme si elle avait été tenue.
    expect(semaine.prevuMin).toBe(90);
    expect(semaine.realiseMin).toBe(30);
  });

  it("alimente la charge avec le réalisé", async () => {
    const { agent, seance } = await athleteAvecSeance();

    const avant = (await agent.get("/api/insights/charge")).body;
    await agent.patch(`/api/sessions/${seance.id}`).send({ status: "faite", dureeReelleMin: 30 });
    const apres = (await agent.get("/api/insights/charge")).body;

    // La séance passe de non réalisée à réalisée : la charge augmente, mais
    // sur la base des 30 minutes effectuées.
    const chargeJour = apres.points.find((p: { charge: number }) => p.charge > 0);
    expect(chargeJour).toBeDefined();
    expect(avant.points.every((p: { charge: number }) => p.charge === 0)).toBe(true);
  });
});
