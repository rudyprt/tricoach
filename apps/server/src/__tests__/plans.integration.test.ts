import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

/**
 * Régénérer une semaine doit remplacer ce qui est encore planifié sans jamais
 * effacer ce que l'athlète a déjà réalisé : c'est le comportement testé ici,
 * directement contre la base.
 */
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIfDb = TEST_DATABASE_URL ? describe : describe.skip;

let prisma: import("@prisma/client").PrismaClient;
let replacePlannedSessions: typeof import("../routes/plans.js")["replacePlannedSessions"];

const WEEK_START = new Date("2026-09-07T00:00:00Z");

describeIfDb("régénération de la semaine", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    process.env.JWT_SECRET = "secret-de-test-suffisamment-long-pour-zod";
    process.env.NODE_ENV = "test";

    ({ prisma } = await import("../lib/prisma.js"));
    ({ replacePlannedSessions } = await import("../routes/plans.js"));
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.session.deleteMany();
    await prisma.trainingPlan.deleteMany();
    await prisma.user.deleteMany();
  });

  async function seedUser() {
    return prisma.user.create({
      data: { email: `regen-${Date.now()}@example.com`, passwordHash: "x", name: "Athlète" },
    });
  }

  async function seedPlan(userId: string, statuses: string[]) {
    return prisma.trainingPlan.create({
      data: {
        userId,
        weekStart: WEEK_START,
        rawAiJson: "{}",
        sessions: {
          create: statuses.map((status, i) => ({
            userId,
            date: new Date(WEEK_START.getTime() + i * 24 * 3600 * 1000),
            sport: "course",
            titre: `Séance ${i}`,
            dureeMin: 45,
            status,
          })),
        },
      },
      include: { sessions: true },
    });
  }

  it("conserve les séances faites et manquées, supprime les séances planifiées", async () => {
    const user = await seedUser();
    await seedPlan(user.id, ["faite", "manquee", "planifiee", "planifiee"]);

    await prisma.$transaction((tx) => replacePlannedSessions(tx, user.id, WEEK_START));

    const remaining = await prisma.session.findMany({ where: { userId: user.id }, orderBy: { date: "asc" } });
    expect(remaining.map((s) => s.status)).toEqual(["faite", "manquee"]);
  });

  it("conserve le ressenti et la date de réalisation", async () => {
    const user = await seedUser();
    const plan = await seedPlan(user.id, ["planifiee"]);
    const completedAt = new Date("2026-09-07T18:00:00Z");
    await prisma.session.update({
      where: { id: plan.sessions[0].id },
      data: { status: "faite", ressenti: "jambes lourdes", completedAt },
    });

    await prisma.$transaction((tx) => replacePlannedSessions(tx, user.id, WEEK_START));

    const kept = await prisma.session.findUniqueOrThrow({ where: { id: plan.sessions[0].id } });
    expect(kept.ressenti).toBe("jambes lourdes");
    expect(kept.completedAt?.toISOString()).toBe(completedAt.toISOString());
  });

  it("supprime le plan devenu vide, garde celui qui porte encore de l'historique", async () => {
    const user = await seedUser();
    const videAprès = await seedPlan(user.id, ["planifiee", "planifiee"]);
    const avecHistorique = await seedPlan(user.id, ["faite"]);

    await prisma.$transaction((tx) => replacePlannedSessions(tx, user.id, WEEK_START));

    const plans = await prisma.trainingPlan.findMany({ where: { userId: user.id } });
    expect(plans.map((p) => p.id)).toEqual([avecHistorique.id]);
    expect(plans.map((p) => p.id)).not.toContain(videAprès.id);
  });

  it("ne touche ni aux autres semaines ni aux autres athlètes", async () => {
    const user = await seedUser();
    const autre = await prisma.user.create({
      data: { email: `autre-${Date.now()}@example.com`, passwordHash: "x", name: "Autre" },
    });

    await seedPlan(user.id, ["planifiee"]);
    await seedPlan(autre.id, ["planifiee"]);
    await prisma.trainingPlan.create({
      data: {
        userId: user.id,
        weekStart: new Date("2026-09-14T00:00:00Z"),
        rawAiJson: "{}",
        sessions: {
          create: [
            {
              userId: user.id,
              date: new Date("2026-09-15T00:00:00Z"),
              sport: "velo",
              titre: "Semaine suivante",
              dureeMin: 90,
            },
          ],
        },
      },
    });

    await prisma.$transaction((tx) => replacePlannedSessions(tx, user.id, WEEK_START));

    expect(await prisma.session.count({ where: { userId: autre.id } })).toBe(1);
    expect(
      await prisma.session.count({ where: { userId: user.id, date: { gte: new Date("2026-09-14T00:00:00Z") } } })
    ).toBe(1);
    expect(
      await prisma.session.count({ where: { userId: user.id, date: { lt: new Date("2026-09-14T00:00:00Z") } } })
    ).toBe(0);
  });

  it("ne fait rien quand la semaine n'a pas encore de plan", async () => {
    const user = await seedUser();
    await expect(prisma.$transaction((tx) => replacePlannedSessions(tx, user.id, WEEK_START))).resolves.toBeUndefined();
  });
});
