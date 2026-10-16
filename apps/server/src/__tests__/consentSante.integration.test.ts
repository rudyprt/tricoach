import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";

/**
 * Consentement aux données de santé : il se retire depuis « Mon compte », et
 * le retrait efface réellement ce qui avait été enregistré.
 */
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIfDb = TEST_DATABASE_URL ? describe : describe.skip;

let app: Express;
let prisma: import("@prisma/client").PrismaClient;
let resetAllRateLimits: () => Promise<void>;

const profil = {
  objectif: "Half Ironman de Nice",
  objectifDate: "2027-06-01",
  tempsNatation: "1500m en 30min",
  tempsVelo: "40km en 1h15",
  tempsCourse: "10km en 45min",
  heuresSemaine: 8,
};

describeIfDb("consentement aux données de santé", () => {
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
    await prisma.user.deleteMany();
  });

  async function athlete(email: string, consent = true) {
    const agent = request.agent(app);
    const res = await agent
      .post("/api/auth/register")
      .send({ email, password: "motdepasse123", name: "Athlète", acceptConditions: true });
    const user = res.body as { id: string };
    await agent
      .put("/api/profile")
      .send(consent ? { ...profil, contraintes: "tendinite d'Achille", consentSante: true } : profil)
      .expect(200);
    const plan = await prisma.trainingPlan.create({
      data: { userId: user.id, weekStart: new Date("2026-10-12T00:00:00.000Z"), rawAiJson: "{}" },
    });
    const seance = await prisma.session.create({
      data: {
        planId: plan.id,
        userId: user.id,
        date: new Date("2026-10-13T00:00:00.000Z"),
        sport: "course",
        titre: "Footing",
        dureeMin: 45,
        ...(consent ? { ressenti: "douleur au mollet en fin de séance" } : {}),
      },
    });
    return { agent, user, seance };
  }

  it("indique l'état du consentement", async () => {
    const { agent } = await athlete("etat@example.com");
    const res = await agent.get("/api/privacy/sante").expect(200);
    expect(res.body.consenti).toBe(true);
    expect(res.body.depuis).not.toBeNull();
  });

  it("efface les blessures, ressentis et motifs médicaux au retrait", async () => {
    const { agent, user, seance } = await athlete("retrait@example.com");
    await prisma.trainingPause.create({
      data: { userId: user.id, raison: "blessure", detail: "entorse cheville", debut: new Date("2026-09-01T00:00:00.000Z") },
    });
    await prisma.race.create({
      data: {
        userId: user.id,
        nom: "Triathlon de Paris",
        date: new Date("2026-09-20T00:00:00.000Z"),
        format: "olympique",
        resultat: { tempsTotal: "2h31", ressenti: "crampes au km 7" },
      },
    });

    const res = await agent.delete("/api/privacy/sante").expect(200);
    expect(res.body.consenti).toBe(false);

    const profilApres = await prisma.athleteProfile.findUnique({ where: { userId: user.id } });
    expect(profilApres?.consentSanteAt).toBeNull();
    expect(profilApres?.contraintes).toBe("");
    expect((await prisma.session.findUnique({ where: { id: seance.id } }))?.ressenti).toBeNull();
    const pause = await prisma.trainingPause.findFirst({ where: { userId: user.id } });
    expect(pause?.detail).toBe("");
    expect(pause?.raison).toBe("indisponibilite");
    const course = await prisma.race.findFirst({ where: { userId: user.id } });
    expect(course?.resultat).toEqual({ tempsTotal: "2h31", ressenti: "" });
  });

  it("n'efface pas le consentement quand le profil est réenregistré champ vide", async () => {
    // Le retrait se fait depuis « Mon compte », avec confirmation : vider le
    // champ ne retire plus rien par surprise.
    const { agent, user } = await athlete("champvide@example.com");
    await agent.put("/api/profile").send({ ...profil, contraintes: "" }).expect(200);
    const p = await prisma.athleteProfile.findUnique({ where: { userId: user.id } });
    expect(p?.consentSanteAt).not.toBeNull();
  });

  it("refuse un ressenti sans consentement", async () => {
    const { agent, seance } = await athlete("sansconsent@example.com", false);
    const res = await agent.patch(`/api/sessions/${seance.id}`).send({ status: "faite", ressenti: "genou douloureux" });
    expect(res.status).toBe(400);
    expect((await prisma.session.findUnique({ where: { id: seance.id } }))?.ressenti).toBeNull();
  });

  it("accepte une séance validée sans ressenti, même sans consentement", async () => {
    const { agent, seance } = await athlete("simple@example.com", false);
    await agent.patch(`/api/sessions/${seance.id}`).send({ status: "faite", ressenti: "" }).expect(200);
  });

  it("enregistre le ressenti quand la case est cochée avec", async () => {
    const { agent, user, seance } = await athlete("caseressenti@example.com", false);
    await agent
      .patch(`/api/sessions/${seance.id}`)
      .send({ status: "faite", ressenti: "genou douloureux", consentSante: true })
      .expect(200);
    expect((await prisma.session.findUnique({ where: { id: seance.id } }))?.ressenti).toBe("genou douloureux");
    const p = await prisma.athleteProfile.findUnique({ where: { userId: user.id } });
    expect(p?.consentSanteAt).not.toBeNull();
  });
});
