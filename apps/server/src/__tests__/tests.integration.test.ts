import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";

/**
 * Cycle complet d'un test de terrain : il est programmé dans la semaine, son
 * résultat est saisi, et il recale les valeurs de seuil du profil — donc les
 * zones sur lesquelles tout le programme est construit.
 */
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIfDb = TEST_DATABASE_URL ? describe : describe.skip;

let app: Express;
let prisma: import("@prisma/client").PrismaClient;
let resetAllRateLimits: () => Promise<void>;
let planWeeklyTest: typeof import("../lib/testScheduling.js").planWeeklyTest;
let periodization: typeof import("../lib/training.js").periodization;
let startOfWeek: typeof import("../lib/week.js").startOfWeek;
let addJours: typeof import("../lib/week.js").addDays;

const LUNDI = new Date("2026-03-02T00:00:00.000Z");
const JOURS = [
  "2026-03-02",
  "2026-03-03",
  "2026-03-04",
  "2026-03-05",
  "2026-03-06",
  "2026-03-07",
  "2026-03-08",
];

describeIfDb("tests de terrain", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    process.env.JWT_SECRET = "secret-de-test-suffisamment-long-pour-zod";
    process.env.NODE_ENV = "test";

    ({ prisma } = await import("../lib/prisma.js"));
    ({ resetAllRateLimits } = await import("../lib/rateLimit.js"));
    ({ planWeeklyTest } = await import("../lib/testScheduling.js"));
    ({ periodization } = await import("../lib/training.js"));
    ({ startOfWeek, addDays: addJours } = await import("../lib/week.js"));
    app = (await import("../app.js")).createApp();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await resetAllRateLimits();
    await prisma.fitnessTest.deleteMany();
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
        objectifDate: new Date("2026-09-05T00:00:00.000Z"),
        tempsCourse: "10km en 50:00",
        heuresSemaine: 7,
      },
    });
    return { agent, user };
  }

  function profilPour(userId: string) {
    return prisma.athleteProfile.findUniqueOrThrow({ where: { userId } });
  }

  const phase = () => periodization(LUNDI, new Date("2026-09-05T00:00:00.000Z"));

  it("programme un test, l'avant-dernier jour de la semaine", async () => {
    const { user } = await athlete("planif@example.com");
    const profil = await profilPour(user.id);

    const test = await planWeeklyTest(user.id, LUNDI, phase(), profil, JOURS);

    expect(test).not.toBeNull();
    expect(test?.date).toBe("2026-03-07");
    expect(await prisma.fitnessTest.count({ where: { userId: user.id } })).toBe(1);
  });

  it("n'en programme pas un second la même semaine", async () => {
    const { user } = await athlete("unseul@example.com");
    const profil = await profilPour(user.id);

    const premier = await planWeeklyTest(user.id, LUNDI, phase(), profil, JOURS);
    // Un réajustement de milieu de semaine repasse ici : il doit retrouver le
    // même test, pas en créer un autre.
    const second = await planWeeklyTest(user.id, LUNDI, phase(), profil, JOURS.slice(3));

    expect(second?.id).toBe(premier?.id);
    expect(await prisma.fitnessTest.count({ where: { userId: user.id } })).toBe(1);
  });

  it("recale l'allure au seuil à partir du résultat saisi", async () => {
    const { agent, user } = await athlete("resultat@example.com");
    const test = await prisma.fitnessTest.create({
      data: {
        userId: user.id,
        sport: "course",
        kind: "course_30min",
        scheduledFor: new Date("2026-03-07T00:00:00.000Z"),
        weekStart: LUNDI,
      },
    });

    const res = await agent.post(`/api/tests/${test.id}/result`).send({ distanceM: 7500, fcMoyenne: 172 });

    expect(res.status).toBe(200);
    expect(res.body.resume).toContain("4:00");

    const profil = await profilPour(user.id);
    expect(profil.seuilCourseSecParKm).toBe(240);
    expect(profil.fcSeuil).toBe(172);

    const apres = await prisma.fitnessTest.findUniqueOrThrow({ where: { id: test.id } });
    expect(apres.status).toBe("realise");
    expect(apres.appliedAt).not.toBeNull();
  });

  it("refuse un résultat invraisemblable et laisse le profil intact", async () => {
    const { agent, user } = await athlete("aberrant@example.com");
    const test = await prisma.fitnessTest.create({
      data: {
        userId: user.id,
        sport: "velo",
        kind: "velo_20min",
        scheduledFor: new Date("2026-03-07T00:00:00.000Z"),
        weekStart: LUNDI,
      },
    });

    const res = await agent.post(`/api/tests/${test.id}/result`).send({ puissanceMoy: 2400 });

    expect(res.status).toBe(400);
    expect((await profilPour(user.id)).ftpWatts).toBeNull();
    expect((await prisma.fitnessTest.findUniqueOrThrow({ where: { id: test.id } })).status).toBe("planifie");
  });

  it("n'expose pas le test d'un autre athlète", async () => {
    const { user } = await athlete("proprietaire@example.com");
    const { agent: intrus } = await athlete("intrus@example.com");
    const test = await prisma.fitnessTest.create({
      data: {
        userId: user.id,
        sport: "course",
        kind: "course_30min",
        scheduledFor: new Date("2026-03-07T00:00:00.000Z"),
        weekStart: LUNDI,
      },
    });

    expect((await intrus.post(`/api/tests/${test.id}/result`).send({ distanceM: 7500 })).status).toBe(400);
    expect((await intrus.get("/api/tests")).body.enCours).toHaveLength(0);
  });

  it("espace les tests d'au moins deux semaines, toutes disciplines confondues", async () => {
    // Un débutant n'a aucun seuil connu dans les trois disciplines : sans
    // garde, il enchaînerait trois efforts maximaux en trois semaines.
    const { user } = await athlete("debutant@example.com");
    const profil = await profilPour(user.id);

    await prisma.fitnessTest.create({
      data: {
        userId: user.id,
        sport: "course",
        kind: "course_30min",
        scheduledFor: new Date("2026-02-28T00:00:00.000Z"),
        weekStart: new Date("2026-02-23T00:00:00.000Z"),
      },
    });

    expect(await planWeeklyTest(user.id, LUNDI, phase(), profil, JOURS)).toBeNull();
  });

  it("reprend les tests une fois ce répit passé", async () => {
    const { user } = await athlete("repit@example.com");
    const profil = await profilPour(user.id);

    await prisma.fitnessTest.create({
      data: {
        userId: user.id,
        sport: "course",
        kind: "course_30min",
        status: "realise",
        scheduledFor: new Date("2026-01-10T00:00:00.000Z"),
        weekStart: new Date("2026-01-05T00:00:00.000Z"),
        appliedAt: new Date("2026-01-10T00:00:00.000Z"),
      },
    });

    expect(await planWeeklyTest(user.id, LUNDI, phase(), profil, JOURS)).not.toBeNull();
  });

  it("recale les allures des séances à venir dès que le test est saisi", async () => {
    // Le cœur de la promesse : l'athlète teste en milieu de semaine, et les
    // séances qu'il lui reste à faire portent aussitôt ses nouvelles allures.
    const { agent, user } = await athlete("suivi@example.com");
    await prisma.athleteProfile.update({
      where: { userId: user.id },
      data: { seuilCourseSecParKm: 300 },
    });

    const lundi = startOfWeek(new Date(), "Europe/Paris");
    const plan = await prisma.trainingPlan.create({
      data: { userId: user.id, weekStart: lundi, rawAiJson: "{}", phase: "base" },
    });

    const structure = (cible: string) => ({
      echauffement: { dureeMin: 15, cible: "Z1 récupération — 6:20–7:12/km", description: "" },
      corps: { dureeMin: 30, cible, description: "", exercices: [] },
      retourCalme: { dureeMin: 10, cible: "Z1 récupération — 6:20–7:12/km", description: "" },
    });
    // Allure au seuil telle qu'elle valait avec un seuil à 5:00/km.
    const ANCIENNE = "Z4 seuil — 4:51–5:16/km";

    const aVenir = await prisma.session.create({
      data: {
        planId: plan.id,
        userId: user.id,
        date: addJours(lundi, 6),
        sport: "course",
        titre: "Seuil",
        dureeMin: 55,
        structure: structure(ANCIENNE),
      },
    });
    const dejaFaite = await prisma.session.create({
      data: {
        planId: plan.id,
        userId: user.id,
        date: addJours(lundi, 1),
        sport: "course",
        titre: "Seuil",
        dureeMin: 55,
        status: "faite",
        structure: structure(ANCIENNE),
      },
    });

    const test = await prisma.fitnessTest.create({
      data: {
        userId: user.id,
        sport: "course",
        kind: "course_30min",
        scheduledFor: addJours(lundi, 3),
        weekStart: lundi,
      },
    });
    // 7,5 km en 30 min : le seuil passe de 5:00 à 4:00/km.
    await agent.post(`/api/tests/${test.id}/result`).send({ distanceM: 7500, fcMoyenne: 172 });

    const res = await agent.get("/api/plans/current");
    expect(res.status).toBe(200);

    const cibleDe = (id: string) =>
      res.body.sessions.find((s: { id: string }) => s.id === id).structure.corps.cible as string;

    expect(cibleDe(aVenir.id)).not.toBe(ANCIENNE);
    expect(cibleDe(aVenir.id)).toContain("Z4");
    expect(cibleDe(aVenir.id)).toMatch(/3:5\d–4:1\d\/km/);
    // L'historique garde ce qui avait été prescrit ce jour-là.
    expect(cibleDe(dejaFaite.id)).toBe(ANCIENNE);
  });

  it("abandonne un test resté en attente depuis plus de deux semaines", async () => {
    const { user } = await athlete("perime@example.com");
    const profil = await profilPour(user.id);
    const vieux = await prisma.fitnessTest.create({
      data: {
        userId: user.id,
        sport: "course",
        kind: "course_30min",
        scheduledFor: new Date("2026-01-10T00:00:00.000Z"),
        weekStart: new Date("2026-01-05T00:00:00.000Z"),
      },
    });

    await planWeeklyTest(user.id, LUNDI, phase(), profil, JOURS);

    expect((await prisma.fitnessTest.findUniqueOrThrow({ where: { id: vieux.id } })).status).toBe("abandonne");
  });
});
