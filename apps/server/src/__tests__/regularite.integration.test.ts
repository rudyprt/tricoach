import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";

/**
 * Régularité. Le point délicat : la semaine en cours ne doit jamais compter,
 * sinon un athlète consultant l'application un mardi verrait sa série remise à
 * zéro par une semaine qui n'est pas finie.
 */
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIfDb = TEST_DATABASE_URL ? describe : describe.skip;

let app: Express;
let prisma: import("@prisma/client").PrismaClient;
let resetAllRateLimits: () => Promise<void>;
let startOfWeek: typeof import("../lib/week.js").startOfWeek;
let addDays: typeof import("../lib/week.js").addDays;

describeIfDb("régularité et jalons", () => {
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
    await prisma.activity.deleteMany();
    await prisma.session.deleteMany();
    await prisma.trainingPlan.deleteMany();
    await prisma.user.deleteMany();
  });

  async function athlete(email: string) {
    const agent = request.agent(app);
    const res = await agent
      .post("/api/auth/register")
      .send({ email, password: "motdepasse123", name: "Athlète", acceptConditions: true });
    return { agent, user: res.body as { id: string } };
  }

  /** Crée une semaine de `total` séances dont `faites` réalisées. */
  async function semaine(userId: string, ilYAsemaines: number, total: number, faites: number) {
    const debut = addDays(startOfWeek(new Date(), "UTC"), -7 * ilYAsemaines);
    const plan = await prisma.trainingPlan.create({
      data: { userId, weekStart: debut, rawAiJson: "{}" },
    });
    await prisma.session.createMany({
      data: Array.from({ length: total }, (_, i) => ({
        planId: plan.id,
        userId,
        date: addDays(debut, i),
        sport: "course",
        titre: `Séance ${i}`,
        dureeMin: 60,
        status: i < faites ? "faite" : "planifiee",
      })),
    });
  }

  it("compte une semaine tenue dès les deux tiers réalisés", async () => {
    const { agent, user } = await athlete("serie@example.com");
    // Exiger cent pour cent découragerait plus que cela ne motive.
    await semaine(user.id, 1, 3, 2);
    await semaine(user.id, 2, 3, 3);

    const res = await agent.get("/api/insights/regularite");

    expect(res.status).toBe(200);
    expect(res.body.serie).toBe(2);
  });

  it("ignore la semaine en cours, qui n'est pas finie", async () => {
    const { agent, user } = await athlete("encours@example.com");
    await semaine(user.id, 1, 3, 3);
    // La semaine courante n'a encore rien de réalisé : elle ne doit pas casser
    // la série d'un athlète qui consulte un mardi.
    await semaine(user.id, 0, 3, 0);

    expect((await agent.get("/api/insights/regularite")).body.serie).toBe(1);
  });

  it("casse la série sur une semaine manquée", async () => {
    const { agent, user } = await athlete("cassure@example.com");
    await semaine(user.id, 1, 3, 0);
    await semaine(user.id, 2, 3, 3);
    await semaine(user.id, 3, 3, 3);

    const res = await agent.get("/api/insights/regularite");

    expect(res.body.serie).toBe(0);
    // La meilleure série reste acquise : elle a bien eu lieu.
    expect(res.body.meilleureSerie).toBe(2);
  });

  it("totalise les séances et les heures réellement faites", async () => {
    const { agent, user } = await athlete("total@example.com");
    await semaine(user.id, 1, 4, 3);

    const res = await agent.get("/api/insights/regularite");

    expect(res.body.totalSeances).toBe(3);
    expect(res.body.totalHeures).toBe(3);
  });

  it("décerne un jalon à partir d'un palier atteint", async () => {
    const { agent, user } = await athlete("jalon@example.com");
    await semaine(user.id, 1, 7, 7);
    await semaine(user.id, 2, 7, 7);

    const res = await agent.get("/api/insights/regularite");

    expect(res.body.jalons.some((j: { cle: string }) => j.cle === "seances-10")).toBe(true);
  });

  it("ne décerne rien sans séance réalisée", async () => {
    const { agent } = await athlete("vide@example.com");
    const res = await agent.get("/api/insights/regularite");

    expect(res.body.jalons).toEqual([]);
    expect(res.body.serie).toBe(0);
  });

  it("retient le meilleur temps sur une distance de référence", async () => {
    const { agent, user } = await athlete("record@example.com");
    await prisma.activity.createMany({
      data: [
        {
          userId: user.id,
          externalId: "a",
          sport: "course",
          name: "10 km lent",
          startedAt: new Date("2026-05-01"),
          dureeMin: 55,
          distanceKm: 10.2,
          allureSecParKm: 330,
        },
        {
          userId: user.id,
          externalId: "b",
          sport: "course",
          name: "10 km rapide",
          startedAt: new Date("2026-06-01"),
          dureeMin: 45,
          distanceKm: 9.8,
          allureSecParKm: 270,
        },
      ],
    });

    const res = await agent.get("/api/insights/regularite");
    const record = res.body.records.find((r: { libelle: string }) => r.libelle === "10 km");

    // 270 s/km sur 10 km = 45:00, et 9,8 km compte bien comme un 10 km.
    expect(record.valeur).toBe("45:00");
    expect(record.date).toBe("2026-06-01");
  });

  it("n'expose pas la régularité d'un autre athlète", async () => {
    const { user } = await athlete("proprio@example.com");
    await semaine(user.id, 1, 3, 3);

    const { agent: intrus } = await athlete("intrus@example.com");
    expect((await intrus.get("/api/insights/regularite")).body.totalSeances).toBe(0);
  });
});
