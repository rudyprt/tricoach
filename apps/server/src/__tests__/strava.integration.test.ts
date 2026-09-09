import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { Express } from "express";

/**
 * Import Strava de bout en bout, avec l'API Strava simulée. Ce qui est vérifié
 * ici est surtout défensif : ne pas importer deux fois, ne pas écraser une
 * saisie de l'athlète, ne pas relier un compte Strava à deux athlètes.
 */
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIfDb = TEST_DATABASE_URL ? describe : describe.skip;

let app: Express;
let prisma: import("@prisma/client").PrismaClient;
let resetAllRateLimits: () => void;

const fetchMock = vi.fn();

function jourCourant(offset = 0): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

function activiteStrava(id: number, jour: string, type = "Run", movingTime = 2700, distance = 10000) {
  return {
    id,
    name: `Activité ${id}`,
    type,
    start_date: `${jour}T07:00:00Z`,
    elapsed_time: movingTime + 300,
    moving_time: movingTime,
    distance,
    average_heartrate: 148,
  };
}

function reponseJson(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status }));
}

describeIfDb("import Strava", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    process.env.JWT_SECRET = "secret-de-test-suffisamment-long-pour-zod";
    process.env.NODE_ENV = "test";
    process.env.STRAVA_CLIENT_ID = "12345";
    process.env.STRAVA_CLIENT_SECRET = "secret-strava";
    process.env.APP_URL = "https://tricoach.example";

    ({ prisma } = await import("../lib/prisma.js"));
    ({ resetAllRateLimits } = await import("../lib/rateLimit.js"));
    app = (await import("../app.js")).createApp();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    resetAllRateLimits();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);

    await prisma.activity.deleteMany();
    await prisma.stravaAccount.deleteMany();
    await prisma.session.deleteMany();
    await prisma.trainingPlan.deleteMany();
    await prisma.athleteProfile.deleteMany();
    await prisma.user.deleteMany();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function athlete(email: string) {
    const agent = request.agent(app);
    const res = await agent
      .post("/api/auth/register")
      .send({ email, password: "motdepasse123", name: "Athlète", acceptConditions: true });
    return { agent, user: res.body as { id: string } };
  }

  /** Relie un compte Strava en passant par le vrai parcours d'autorisation. */
  async function relier(agent: ReturnType<typeof request.agent>, athleteId = 777) {
    const connect = await agent.post("/api/strava/connect");
    expect(connect.status).toBe(200);
    const state = new URL(connect.body.url).searchParams.get("state")!;

    fetchMock.mockImplementationOnce(() =>
      reponseJson({
        access_token: "acces-1",
        refresh_token: "rafraichissement-1",
        expires_at: Math.floor(Date.now() / 1000) + 21600,
        athlete: { id: athleteId, firstname: "Rudy", lastname: "P" },
      })
    );

    return agent.post("/api/strava/callback").send({ code: "code-strava", state });
  }

  describe("connexion du compte", () => {
    it("construit une URL d'autorisation avec un état anti-CSRF", async () => {
      const { agent } = await athlete("connect@example.com");
      const res = await agent.post("/api/strava/connect");

      expect(res.status).toBe(200);
      const url = new URL(res.body.url);
      expect(url.host).toBe("www.strava.com");
      expect(url.searchParams.get("client_id")).toBe("12345");
      expect(url.searchParams.get("scope")).toContain("activity:read_all");
      expect(url.searchParams.get("state")).toHaveLength(48);
      expect(String(res.headers["set-cookie"])).toContain("strava_state");
    });

    it("relie le compte et enregistre les jetons", async () => {
      const { agent, user } = await athlete("relie@example.com");
      const res = await relier(agent);

      expect(res.status).toBe(200);
      expect(res.body.athleteName).toBe("Rudy P");
      const compte = await prisma.stravaAccount.findUniqueOrThrow({ where: { userId: user.id } });
      expect(compte.athleteId).toBe("777");
      expect(compte.refreshToken).toBe("rafraichissement-1");
    });

    it("refuse un retour dont l'état ne correspond pas", async () => {
      const { agent } = await athlete("csrf@example.com");
      await agent.post("/api/strava/connect");

      const res = await agent.post("/api/strava/callback").send({ code: "code", state: "etat-falsifie" });
      expect(res.status).toBe(400);
      expect(await prisma.stravaAccount.count()).toBe(0);
    });

    it("refuse de relier un compte Strava déjà utilisé par un autre athlète", async () => {
      const { agent: alice } = await athlete("alice-strava@example.com");
      expect((await relier(alice, 999)).status).toBe(200);

      resetAllRateLimits();
      const { agent: bob } = await athlete("bob-strava@example.com");
      const res = await relier(bob, 999);

      // Sinon les activités d'une personne nourriraient le programme d'une autre.
      expect(res.status).toBe(409);
      expect(await prisma.stravaAccount.count()).toBe(1);
    });

    it("permet de délier sans perdre l'historique importé", async () => {
      const { agent, user } = await athlete("delie@example.com");
      await relier(agent);
      await prisma.activity.create({
        data: {
          userId: user.id,
          externalId: "1",
          sport: "course",
          name: "Footing",
          startedAt: new Date(),
          dureeMin: 40,
        },
      });

      expect((await agent.delete("/api/strava")).status).toBe(200);
      expect(await prisma.stravaAccount.count({ where: { userId: user.id } })).toBe(0);
      // Les activités font partie de l'historique d'entraînement, pas de la connexion.
      expect(await prisma.activity.count({ where: { userId: user.id } })).toBe(1);
    });
  });

  describe("import des activités", () => {
    async function athleteRelieAvecSeance(email: string) {
      const { agent, user } = await athlete(email);
      await relier(agent);

      const jour = jourCourant();
      const plan = await prisma.trainingPlan.create({
        data: {
          userId: user.id,
          weekStart: new Date(`${jour}T00:00:00.000Z`),
          rawAiJson: "{}",
          sessions: {
            create: [
              {
                userId: user.id,
                date: new Date(`${jour}T00:00:00.000Z`),
                sport: "course",
                titre: "Footing prévu",
                dureeMin: 45,
              },
            ],
          },
        },
        include: { sessions: true },
      });
      return { agent, user, jour, session: plan.sessions[0] };
    }

    it("importe et marque la séance correspondante comme réalisée", async () => {
      const { agent, user, jour, session } = await athleteRelieAvecSeance("import@example.com");
      fetchMock.mockImplementationOnce(() => reponseJson([activiteStrava(555, jour)]));

      const res = await agent.post("/api/strava/sync");
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ importees: 1, rapprochees: 1 });

      const activite = await prisma.activity.findFirstOrThrow({ where: { userId: user.id } });
      expect(activite.sport).toBe("course");
      expect(activite.dureeMin).toBe(45);
      expect(activite.allureSecParKm).toBe(270);
      expect(activite.sessionId).toBe(session.id);

      // L'athlète n'a plus à saisir à la main ce que sa montre sait déjà.
      const apres = await prisma.session.findUniqueOrThrow({ where: { id: session.id } });
      expect(apres.status).toBe("faite");
    });

    it("n'importe jamais deux fois la même activité", async () => {
      const { agent, user, jour } = await athleteRelieAvecSeance("doublon@example.com");
      fetchMock.mockImplementation(() => reponseJson([activiteStrava(556, jour)]));

      await agent.post("/api/strava/sync");
      await agent.post("/api/strava/sync");

      expect(await prisma.activity.count({ where: { userId: user.id } })).toBe(1);
    });

    it("n'écrase pas une séance déjà renseignée par l'athlète", async () => {
      const { agent, jour, session } = await athleteRelieAvecSeance("manuel@example.com");
      await prisma.session.update({
        where: { id: session.id },
        data: { status: "manquee", ressenti: "j'ai renoncé" },
      });

      fetchMock.mockImplementationOnce(() => reponseJson([activiteStrava(557, jour)]));
      await agent.post("/api/strava/sync");

      // La saisie manuelle prime sur une déduction automatique.
      const apres = await prisma.session.findUniqueOrThrow({ where: { id: session.id } });
      expect(apres.status).toBe("manquee");
      expect(apres.ressenti).toBe("j'ai renoncé");
    });

    it("importe une activité sans séance correspondante, sans la rattacher", async () => {
      const { agent, user, jour } = await athleteRelieAvecSeance("horsplan@example.com");
      fetchMock.mockImplementationOnce(() => reponseJson([activiteStrava(558, jour, "Swim", 1800, 1500)]));

      const res = await agent.post("/api/strava/sync");
      expect(res.body).toMatchObject({ importees: 1, rapprochees: 0 });

      const activite = await prisma.activity.findFirstOrThrow({ where: { userId: user.id, sport: "natation" } });
      expect(activite.sessionId).toBeNull();
    });

    it("ignore une activité au format inattendu sans faire échouer l'import", async () => {
      const { agent, user, jour } = await athleteRelieAvecSeance("malforme@example.com");
      fetchMock.mockImplementationOnce(() =>
        reponseJson([{ id: "pas-un-nombre" }, activiteStrava(559, jour)])
      );

      const res = await agent.post("/api/strava/sync");
      expect(res.status).toBe(200);
      expect(await prisma.activity.count({ where: { userId: user.id } })).toBe(1);
    });

    it("rafraîchit un jeton expiré au lieu d'échouer", async () => {
      const { agent, user, jour } = await athleteRelieAvecSeance("expire@example.com");
      await prisma.stravaAccount.update({
        where: { userId: user.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      fetchMock
        .mockImplementationOnce(() =>
          reponseJson({
            access_token: "acces-2",
            refresh_token: "rafraichissement-2",
            expires_at: Math.floor(Date.now() / 1000) + 21600,
          })
        )
        .mockImplementationOnce(() => reponseJson([activiteStrava(560, jour)]));

      const res = await agent.post("/api/strava/sync");
      expect(res.status).toBe(200);

      const compte = await prisma.stravaAccount.findUniqueOrThrow({ where: { userId: user.id } });
      expect(compte.accessToken).toBe("acces-2");
      expect(compte.refreshToken).toBe("rafraichissement-2");
    });

    it("explique la limitation de débit de Strava au lieu d'un échec opaque", async () => {
      const { agent } = await athleteRelieAvecSeance("debit@example.com");
      fetchMock.mockImplementationOnce(() => reponseJson({ message: "Rate Limit Exceeded" }, 429));

      const res = await agent.post("/api/strava/sync");
      expect(res.status).toBe(429);
      expect(res.body.error).toContain("Strava");
    });

    it("refuse d'importer sans compte relié", async () => {
      const { agent } = await athlete("sansstrava@example.com");
      const res = await agent.post("/api/strava/sync");
      expect(res.status).toBe(400);
      expect(res.body.error).toContain("Reliez");
    });
  });

  describe("isolation entre comptes", () => {
    it("ne montre jamais les activités d'un autre athlète", async () => {
      const { agent: alice, user: aliceUser } = await athlete("alice-act@example.com");
      await prisma.activity.create({
        data: {
          userId: aliceUser.id,
          externalId: "secret",
          sport: "course",
          name: "Sortie privée d'Alice",
          startedAt: new Date(),
          dureeMin: 60,
        },
      });

      resetAllRateLimits();
      const { agent: bob } = await athlete("bob-act@example.com");
      const res = await bob.get("/api/strava/activities");

      expect(res.body.activities).toEqual([]);
      expect(res.text).not.toContain("Alice");

      const aliceVoit = await alice.get("/api/strava/activities");
      expect(aliceVoit.body.activities).toHaveLength(1);
    });

    it("exige une session", async () => {
      expect((await request(app).get("/api/strava/status")).status).toBe(401);
      expect((await request(app).post("/api/strava/sync")).status).toBe(401);
    });
  });
});
