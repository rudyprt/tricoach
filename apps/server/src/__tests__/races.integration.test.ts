import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";

/**
 * Calendrier de courses. Le point sensible : le profil doit rester aligné sur
 * la prochaine course A, puisque c'est lui que la périodisation et les zones
 * consultent.
 */
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIfDb = TEST_DATABASE_URL ? describe : describe.skip;

let app: Express;
let prisma: import("@prisma/client").PrismaClient;
let resetAllRateLimits: () => void;

describeIfDb("calendrier de courses", () => {
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
    resetAllRateLimits();
    await prisma.race.deleteMany();
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
        objectif: "Objectif initial",
        objectifDate: new Date("2027-01-01T00:00:00.000Z"),
        heuresSemaine: 8,
      },
    });
    return { agent, user };
  }

  const dansNJours = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

  it("inscrit une course et aligne l'objectif du profil dessus", async () => {
    const { agent, user } = await athlete("calendrier@example.com");

    const res = await agent
      .post("/api/races")
      .send({ nom: "Ironman de Nice", date: dansNJours(120), format: "ironman", priorite: "A" });

    expect(res.status).toBe(201);
    expect(res.body.formatLabel).toContain("Ironman");

    const profil = await prisma.athleteProfile.findUniqueOrThrow({ where: { userId: user.id } });
    expect(profil.objectif).toBe("Ironman de Nice");
  });

  it("garde l'objectif sur la course A, même si une course B est plus proche", async () => {
    const { agent, user } = await athlete("priorites@example.com");
    await agent.post("/api/races").send({ nom: "Ironman de Nice", date: dansNJours(120), priorite: "A" });
    await agent.post("/api/races").send({ nom: "Half de Deauville", date: dansNJours(40), priorite: "B" });

    const profil = await prisma.athleteProfile.findUniqueOrThrow({ where: { userId: user.id } });
    expect(profil.objectif).toBe("Ironman de Nice");
  });

  it("bascule l'objectif sur la course A suivante quand la première est supprimée", async () => {
    const { agent, user } = await athlete("suppression@example.com");
    const premiere = await agent.post("/api/races").send({ nom: "Nice", date: dansNJours(60), priorite: "A" });
    await agent.post("/api/races").send({ nom: "Vichy", date: dansNJours(150), priorite: "A" });

    await agent.delete(`/api/races/${premiere.body.id}`);

    const profil = await prisma.athleteProfile.findUniqueOrThrow({ where: { userId: user.id } });
    expect(profil.objectif).toBe("Vichy");
  });

  it("suit un report de date", async () => {
    const { agent, user } = await athlete("report@example.com");
    const course = await agent.post("/api/races").send({ nom: "Nice", date: dansNJours(60), priorite: "A" });

    await agent.patch(`/api/races/${course.body.id}`).send({ date: dansNJours(90) });

    const profil = await prisma.athleteProfile.findUniqueOrThrow({ where: { userId: user.id } });
    expect(profil.objectifDate.toISOString().slice(0, 10)).toBe(dansNJours(90));
  });

  it("refuse une course sans nom ou mal datée", async () => {
    const { agent } = await athlete("invalide@example.com");

    expect((await agent.post("/api/races").send({ nom: "", date: dansNJours(30) })).status).toBe(400);
    expect((await agent.post("/api/races").send({ nom: "Nice", date: "09/2026" })).status).toBe(400);
    expect((await agent.post("/api/races").send({ nom: "Nice", date: dansNJours(30), priorite: "Z" })).status).toBe(400);
  });

  it("ne laisse pas modifier ni supprimer la course d'un autre athlète", async () => {
    const { agent: proprietaire } = await athlete("proprietaire@example.com");
    const course = await proprietaire.post("/api/races").send({ nom: "Nice", date: dansNJours(60) });

    const { agent: intrus } = await athlete("intrus@example.com");

    expect((await intrus.patch(`/api/races/${course.body.id}`).send({ nom: "Volée" })).status).toBe(404);
    expect((await intrus.delete(`/api/races/${course.body.id}`)).status).toBe(404);
    expect((await intrus.get("/api/races")).body.courses).toHaveLength(0);
  });

  it("borne la taille du calendrier", async () => {
    const { agent, user } = await athlete("saison@example.com");
    await prisma.race.createMany({
      data: Array.from({ length: 30 }, (_, i) => ({
        userId: user.id,
        nom: `Course ${i}`,
        date: new Date(Date.now() + (i + 1) * 86400000),
      })),
    });

    expect((await agent.post("/api/races").send({ nom: "Une de trop", date: dansNJours(200) })).status).toBe(400);
  });
});
