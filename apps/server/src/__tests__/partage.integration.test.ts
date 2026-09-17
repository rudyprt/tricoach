import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";

/**
 * Partage d'une semaine en lecture seule. Le point sensible : le lien doit
 * montrer les séances et rien d'autre — jamais l'adresse e-mail, jamais une
 * autre semaine, jamais le compte.
 */
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIfDb = TEST_DATABASE_URL ? describe : describe.skip;

let app: Express;
let prisma: import("@prisma/client").PrismaClient;
let resetAllRateLimits: () => Promise<void>;

describeIfDb("partage d'une semaine", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    process.env.JWT_SECRET = "secret-de-test-suffisamment-long-pour-zod";
    process.env.APP_URL = "https://tricoach.test";
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
    await prisma.sharedWeek.deleteMany();
    await prisma.session.deleteMany();
    await prisma.trainingPlan.deleteMany();
    await prisma.user.deleteMany();
  });

  /** Lundi de la semaine en cours, comme le calcule le serveur. */
  function lundi(): Date {
    const d = new Date();
    d.setUTCHours(0, 0, 0, 0);
    const jour = d.getUTCDay();
    d.setUTCDate(d.getUTCDate() + ((jour === 0 ? -6 : 1) - jour));
    return d;
  }

  async function athleteAvecSemaine(email: string, nom = "Rudy Martin") {
    const agent = request.agent(app);
    const res = await agent
      .post("/api/auth/register")
      .send({ email, password: "motdepasse123", name: nom, acceptConditions: true });
    const user = res.body as { id: string };

    const debut = lundi();
    await prisma.trainingPlan.create({
      data: {
        userId: user.id,
        weekStart: debut,
        rawAiJson: "{}",
        sessions: {
          create: [
            { userId: user.id, date: debut, sport: "course", titre: "Footing", dureeMin: 45 },
            {
              userId: user.id,
              date: new Date(debut.getTime() + 2 * 86400000),
              sport: "velo",
              titre: "Seuil",
              dureeMin: 75,
            },
          ],
        },
      },
    });
    return { agent, user, debut };
  }

  it("crée un lien et le rend consultable sans compte", async () => {
    const { agent } = await athleteAvecSemaine("partage@example.com");

    const creation = await agent.post("/api/partage").send({});
    expect(creation.status).toBe(201);
    expect(creation.body.url).toContain("https://tricoach.test/semaine/");

    const token = creation.body.url.split("/").pop();
    // Aucun cookie : c'est un coach humain qui ouvre le lien.
    const vue = await request(app).get(`/api/partage/${token}`);

    expect(vue.status).toBe(200);
    expect(vue.body.sessions).toHaveLength(2);
    expect(vue.body.sessions[0].titre).toBe("Footing");
  });

  it("ne divulgue que le prénom, jamais l'adresse e-mail", async () => {
    const { agent } = await athleteAvecSemaine("prive@example.com", "Rudy Martin");
    const creation = await agent.post("/api/partage").send({});
    const token = creation.body.url.split("/").pop();

    const vue = await request(app).get(`/api/partage/${token}`);

    expect(vue.body.athlete).toBe("Rudy");
    expect(JSON.stringify(vue.body)).not.toContain("prive@example.com");
    expect(JSON.stringify(vue.body)).not.toContain("Martin");
  });

  it("ne stocke jamais le jeton en clair", async () => {
    const { agent } = await athleteAvecSemaine("hash@example.com");
    const creation = await agent.post("/api/partage").send({});
    const token = creation.body.url.split("/").pop();

    const enregistre = await prisma.sharedWeek.findFirstOrThrow();
    expect(enregistre.tokenHash).not.toBe(token);
    expect(enregistre.tokenHash).toHaveLength(64);
  });

  it("compte les consultations, pour que l'athlète sache si son lien a servi", async () => {
    const { agent } = await athleteAvecSemaine("vues@example.com");
    const token = (await agent.post("/api/partage").send({})).body.url.split("/").pop();

    await request(app).get(`/api/partage/${token}`);
    await request(app).get(`/api/partage/${token}`);
    // L'incrément n'attend pas la réponse : on laisse la boucle d'événements tourner.
    await new Promise((r) => setTimeout(r, 100));

    expect((await prisma.sharedWeek.findFirstOrThrow()).vues).toBeGreaterThanOrEqual(1);
  });

  it("refuse un jeton inconnu ou mal formé", async () => {
    expect((await request(app).get(`/api/partage/${"a".repeat(48)}`)).status).toBe(404);
    expect((await request(app).get("/api/partage/trop-court")).status).toBe(404);
  });

  it("cesse de fonctionner une fois révoqué", async () => {
    const { agent } = await athleteAvecSemaine("revoque@example.com");
    const token = (await agent.post("/api/partage").send({})).body.url.split("/").pop();

    await agent.delete("/api/partage").send({});

    expect((await request(app).get(`/api/partage/${token}`)).status).toBe(404);
  });

  it("remplace l'ancien lien quand on en regénère un", async () => {
    const { agent } = await athleteAvecSemaine("regenere@example.com");
    const premier = (await agent.post("/api/partage").send({})).body.url.split("/").pop();
    const second = (await agent.post("/api/partage").send({})).body.url.split("/").pop();

    expect(second).not.toBe(premier);
    expect((await request(app).get(`/api/partage/${premier}`)).status).toBe(404);
    expect((await request(app).get(`/api/partage/${second}`)).status).toBe(200);
  });

  it("refuse un lien expiré", async () => {
    const { agent } = await athleteAvecSemaine("expire@example.com");
    const token = (await agent.post("/api/partage").send({})).body.url.split("/").pop();

    await prisma.sharedWeek.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });

    expect((await request(app).get(`/api/partage/${token}`)).status).toBe(404);
  });

  it("refuse de partager une semaine sans programme", async () => {
    const agent = request.agent(app);
    await agent
      .post("/api/auth/register")
      .send({ email: "vide@example.com", password: "motdepasse123", name: "Vide", acceptConditions: true });

    expect((await agent.post("/api/partage").send({})).status).toBe(400);
  });

  it("exige une session pour créer un lien", async () => {
    expect((await request(app).post("/api/partage").send({})).status).toBe(401);
  });
});
