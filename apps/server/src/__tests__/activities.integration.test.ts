import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";

/**
 * Import de fichiers de séance. C'est la voie sans service tiers : elle doit
 * fonctionner avec toutes les marques de montre, et surtout ne jamais fausser
 * l'historique en rattachant une activité à la mauvaise séance.
 */
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIfDb = TEST_DATABASE_URL ? describe : describe.skip;

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

let app: Express;
let prisma: import("@prisma/client").PrismaClient;
let resetAllRateLimits: () => void;

describeIfDb("import de fichiers", () => {
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
    await prisma.activity.deleteMany();
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
    return { agent, user: res.body as { id: string } };
  }

  /** Crée une séance planifiée le 9 septembre 2026, jour des fixtures. */
  async function seancePrevue(userId: string, sport: string, dureeMin: number) {
    const plan = await prisma.trainingPlan.create({
      data: {
        userId,
        weekStart: new Date("2026-09-07T00:00:00.000Z"),
        rawAiJson: "{}",
        sessions: {
          create: [
            {
              userId,
              date: new Date("2026-09-09T00:00:00.000Z"),
              sport,
              titre: "Séance prévue",
              dureeMin,
            },
          ],
        },
      },
      include: { sessions: true },
    });
    return plan.sessions[0];
  }

  it("importe un .fit et valide la séance de course correspondante", async () => {
    const { agent, user } = await athlete("fit@example.com");
    const session = await seancePrevue(user.id, "course", 45);

    const res = await agent
      .post("/api/activities/import")
      .attach("fichiers", path.join(fixtures, "course.fit"));

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ importees: 1, rapprochees: 1 });
    expect(res.body.resultats[0].statut).toBe("importe_et_rattache");

    const activite = await prisma.activity.findFirstOrThrow({ where: { userId: user.id } });
    expect(activite.source).toBe("fichier");
    expect(activite.sport).toBe("course");
    expect(activite.dureeMin).toBe(45);
    expect(activite.distanceKm).toBe(10);
    expect(activite.allureSecParKm).toBe(270);
    expect(activite.sessionId).toBe(session.id);

    // L'athlète n'a plus à cocher sa séance à la main.
    expect((await prisma.session.findUniqueOrThrow({ where: { id: session.id } })).status).toBe("faite");
  });

  it("importe plusieurs fichiers de formats différents en une fois", async () => {
    const { agent, user } = await athlete("multi@example.com");

    const res = await agent
      .post("/api/activities/import")
      .attach("fichiers", path.join(fixtures, "course.fit"))
      .attach("fichiers", path.join(fixtures, "velo.gpx"))
      .attach("fichiers", path.join(fixtures, "natation.tcx"));

    expect(res.body.importees).toBe(3);
    const sports = (await prisma.activity.findMany({ where: { userId: user.id } })).map((a) => a.sport).sort();
    expect(sports).toEqual(["course", "natation", "velo"]);
  });

  it("n'importe jamais deux fois le même fichier, même renommé", async () => {
    const { agent, user } = await athlete("doublon@example.com");

    await agent.post("/api/activities/import").attach("fichiers", path.join(fixtures, "velo.gpx"));

    // Même contenu, autre nom.
    const copie = path.join(fixtures, "velo.gpx");
    const second = await agent
      .post("/api/activities/import")
      .attach("fichiers", fs.readFileSync(copie), { filename: "ma-sortie-renommee.gpx" });

    expect(second.body.importees).toBe(0);
    expect(second.body.resultats[0].statut).toBe("deja_importe");
    expect(await prisma.activity.count({ where: { userId: user.id } })).toBe(1);
  });

  it("ne rattache pas une activité à une séance d'une autre discipline", async () => {
    const { agent, user } = await athlete("discipline@example.com");
    const session = await seancePrevue(user.id, "natation", 45);

    // Un .fit de course ne doit pas valider une séance de natation.
    const res = await agent
      .post("/api/activities/import")
      .attach("fichiers", path.join(fixtures, "course.fit"));

    expect(res.body).toMatchObject({ importees: 1, rapprochees: 0 });
    expect((await prisma.session.findUniqueOrThrow({ where: { id: session.id } })).status).toBe("planifiee");
    expect((await prisma.activity.findFirstOrThrow({ where: { userId: user.id } })).sessionId).toBeNull();
  });

  it("n'écrase pas une séance déjà renseignée par l'athlète", async () => {
    const { agent, user } = await athlete("manuel@example.com");
    const session = await seancePrevue(user.id, "course", 45);
    await prisma.session.update({
      where: { id: session.id },
      data: { status: "manquee", ressenti: "abandon au 5e km" },
    });

    await agent.post("/api/activities/import").attach("fichiers", path.join(fixtures, "course.fit"));

    const apres = await prisma.session.findUniqueOrThrow({ where: { id: session.id } });
    expect(apres.status).toBe("manquee");
    expect(apres.ressenti).toBe("abandon au 5e km");
  });

  it("signale les fichiers en erreur sans interrompre les autres", async () => {
    const { agent, user } = await athlete("melange@example.com");

    const res = await agent
      .post("/api/activities/import")
      .attach("fichiers", path.join(fixtures, "velo.gpx"))
      .attach("fichiers", Buffer.from("ceci n'est pas un fit"), { filename: "casse.fit" })
      .attach("fichiers", Buffer.from("photo"), { filename: "photo.jpg" });

    expect(res.status).toBe(200);
    expect(res.body.importees).toBe(1);

    const statuts = res.body.resultats.map((r: { statut: string }) => r.statut);
    expect(statuts).toContain("importe");
    expect(statuts).toContain("erreur");
    expect(statuts).toContain("ignore");
    expect(await prisma.activity.count({ where: { userId: user.id } })).toBe(1);
  });

  it("refuse une requête sans fichier", async () => {
    const { agent } = await athlete("vide@example.com");
    const res = await agent.post("/api/activities/import");
    expect(res.status).toBe(400);
  });

  it("n'expose jamais les activités d'un autre athlète", async () => {
    const { agent: alice, user: aliceUser } = await athlete("alice-fic@example.com");
    await alice.post("/api/activities/import").attach("fichiers", path.join(fixtures, "velo.gpx"));

    resetAllRateLimits();
    const { agent: bob } = await athlete("bob-fic@example.com");

    expect((await bob.get("/api/activities")).body.activities).toEqual([]);
    expect((await alice.get("/api/activities")).body.activities).toHaveLength(1);

    // Et Bob ne peut pas supprimer l'activité d'Alice.
    const activiteAlice = await prisma.activity.findFirstOrThrow({ where: { userId: aliceUser.id } });
    expect((await bob.delete(`/api/activities/${activiteAlice.id}`)).status).toBe(404);
    expect(await prisma.activity.count({ where: { userId: aliceUser.id } })).toBe(1);
  });

  it("permet de supprimer une activité importée par erreur", async () => {
    const { agent, user } = await athlete("suppr@example.com");
    await agent.post("/api/activities/import").attach("fichiers", path.join(fixtures, "velo.gpx"));

    const activite = await prisma.activity.findFirstOrThrow({ where: { userId: user.id } });
    expect((await agent.delete(`/api/activities/${activite.id}`)).status).toBe(200);
    expect(await prisma.activity.count({ where: { userId: user.id } })).toBe(0);
  });

  it("exige une session", async () => {
    expect((await request(app).post("/api/activities/import")).status).toBe(401);
    expect((await request(app).get("/api/activities")).status).toBe(401);
  });
});
