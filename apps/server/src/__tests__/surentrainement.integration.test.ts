import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";

/**
 * Alerte de surentraînement.
 *
 * Le point délicat : elle s'affiche juste sous le débrief, qui raconte la
 * dernière semaine CALENDAIRE terminée. Tant qu'elle comparait des fenêtres
 * glissantes de sept jours, la première moitié de sa « dernière semaine »
 * tombait dans la semaine en cours, encore incomplète — et les deux encadrés
 * se contredisaient en décrivant des périodes différentes.
 */
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIfDb = TEST_DATABASE_URL ? describe : describe.skip;

let app: Express;
let prisma: import("@prisma/client").PrismaClient;
let resetAllRateLimits: () => Promise<void>;
let startOfWeek: typeof import("../lib/week.js").startOfWeek;
let addDays: typeof import("../lib/week.js").addDays;

describeIfDb("alerte de surentraînement", () => {
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

  async function athletePremium(email: string) {
    const agent = request.agent(app);
    const res = await agent
      .post("/api/auth/register")
      .send({ email, password: "motdepasse123", name: "Athlète", acceptConditions: true });
    const user = res.body as { id: string };
    await prisma.user.update({ where: { id: user.id }, data: { plan: "premium" } });
    return { agent, user };
  }

  /** Pose `faites` séances réalisées de `dureeMin` dans la semaine indiquée. */
  async function semaine(userId: string, ilYAsemaines: number, faites: number, dureeMin: number) {
    const debut = addDays(startOfWeek(new Date(), "UTC"), -7 * ilYAsemaines);
    const plan = await prisma.trainingPlan.create({ data: { userId, weekStart: debut, rawAiJson: "{}" } });
    await prisma.session.createMany({
      data: Array.from({ length: faites }, (_, i) => ({
        planId: plan.id,
        userId,
        date: addDays(debut, i),
        sport: "course",
        titre: `Séance ${i}`,
        dureeMin,
        status: "faite",
      })),
    });
  }

  it("compare les deux dernières semaines terminées", async () => {
    const { agent, user } = await athletePremium("comparaison@example.com");
    await semaine(user.id, 2, 3, 60); // avant-dernière : 180 min
    await semaine(user.id, 1, 5, 60); // dernière terminée : 300 min

    const { body } = await agent.get("/api/insights/overtraining");

    expect(body.stats.prevWeekVolumeMin).toBe(180);
    expect(body.stats.lastWeekVolumeMin).toBe(300);
    expect(body.stats.volumeIncreasePct).toBe(67);
    expect(body.reasons.join(" ")).toContain("volume");
  });

  it("ignore la semaine en cours, qui n'est pas finie", async () => {
    /*
     * C'est le cœur du défaut : la semaine en cours n'a que quelques jours
     * écoulés. La compter faisait dire à l'alerte tantôt un effondrement,
     * tantôt une explosion, selon le jour où l'athlète ouvrait l'application.
     */
    const { agent, user } = await athletePremium("encours@example.com");
    await semaine(user.id, 2, 3, 60);
    await semaine(user.id, 1, 5, 60);
    // Semaine en cours volontairement énorme : elle ne doit rien changer.
    await semaine(user.id, 0, 7, 180);

    const { body } = await agent.get("/api/insights/overtraining");

    expect(body.stats.lastWeekVolumeMin).toBe(300);
    expect(body.stats.prevWeekVolumeMin).toBe(180);
  });

  it("nomme les deux semaines comparées", async () => {
    // Sans elles, impossible de vérifier que l'alerte et le débrief parlent
    // bien de la même période.
    const { agent, user } = await athletePremium("periode@example.com");
    await semaine(user.id, 1, 2, 60);

    const { body } = await agent.get("/api/insights/overtraining");
    const lundiCourant = startOfWeek(new Date(), "Europe/Paris");

    expect(body.stats.derniereSemaine).toBe(addDays(lundiCourant, -7).toISOString().slice(0, 10));
    expect(body.stats.avantDerniereSemaine).toBe(addDays(lundiCourant, -14).toISOString().slice(0, 10));
  });

  it("compte le volume réellement fait, durées corrigées comprises", async () => {
    const { agent, user } = await athletePremium("corrigee@example.com");
    const debut = addDays(startOfWeek(new Date(), "UTC"), -7);
    const plan = await prisma.trainingPlan.create({ data: { userId: user.id, weekStart: debut, rawAiJson: "{}" } });
    await prisma.session.createMany({
      data: Array.from({ length: 4 }, (_, i) => ({
        planId: plan.id,
        userId: user.id,
        date: addDays(debut, i),
        sport: "course",
        titre: `Séance ${i}`,
        dureeMin: 60,
        dureeReelleMin: 30,
        status: "faite",
      })),
    });

    const { body } = await agent.get("/api/insights/overtraining");

    // 4 × 30, et non 4 × 60 : c'est ce que l'athlète a fait.
    expect(body.stats.lastWeekVolumeMin).toBe(120);
  });

  it("reste réservée à l'offre Premium", async () => {
    const agent = request.agent(app);
    await agent
      .post("/api/auth/register")
      .send({ email: "gratuit@example.com", password: "motdepasse123", name: "A", acceptConditions: true });

    const res = await agent.get("/api/insights/overtraining");
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("PREMIUM_REQUIRED");
  });
});
