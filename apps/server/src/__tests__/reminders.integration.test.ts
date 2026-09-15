import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { Express } from "express";

/**
 * Rappels par e-mail. Deux propriétés comptent plus que le contenu des
 * messages : ne jamais envoyer deux fois le même, et pouvoir s'en désabonner
 * sans se connecter.
 */
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIfDb = TEST_DATABASE_URL ? describe : describe.skip;

const envoyes: { to: string; subject: string; text: string; headers?: Record<string, string> }[] = [];

vi.mock("../lib/mailer.js", async () => {
  const reel = await vi.importActual<typeof import("../lib/mailer.js")>("../lib/mailer.js");
  return {
    ...reel,
    isMailConfigured: () => true,
    sendMail: async (mail: { to: string; subject: string; text: string; headers?: Record<string, string> }) => {
      envoyes.push(mail);
    },
  };
});

let app: Express;
let prisma: import("@prisma/client").PrismaClient;
let resetAllRateLimits: () => void;
let runReminders: typeof import("../lib/reminders.js").runReminders;
let unsubscribeToken: typeof import("../lib/reminders.js").unsubscribeToken;
let cleSemaine: typeof import("../lib/reminders.js").cleSemaine;

/** Dimanche 8 mars 2026, 19 h à Paris (18 h UTC). */
const DIMANCHE_SOIR = new Date("2026-03-08T19:00:00.000Z");
/** Jeudi 5 mars 2026, 19 h à Paris. */
const JEUDI_SOIR = new Date("2026-03-05T19:00:00.000Z");
const LUNDI = new Date("2026-03-02T00:00:00.000Z");

describeIfDb("rappels par e-mail", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    process.env.JWT_SECRET = "secret-de-test-suffisamment-long-pour-zod";
    process.env.NODE_ENV = "test";
    process.env.APP_URL = "https://tricoach.test";

    ({ prisma } = await import("../lib/prisma.js"));
    ({ resetAllRateLimits } = await import("../lib/rateLimit.js"));
    ({ runReminders, unsubscribeToken, cleSemaine } = await import("../lib/reminders.js"));
    app = (await import("../app.js")).createApp();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    envoyes.length = 0;
    resetAllRateLimits();
    await prisma.reminder.deleteMany();
    await prisma.session.deleteMany();
    await prisma.trainingPlan.deleteMany();
    await prisma.athleteProfile.deleteMany();
    await prisma.user.deleteMany();
  });

  /** Un athlète éligible : profil renseigné, adresse confirmée, rappels actifs. */
  async function athlete(email: string, options: { plan?: string; creeLe?: Date } = {}) {
    const agent = request.agent(app);
    const res = await agent
      .post("/api/auth/register")
      .send({ email, password: "motdepasse123", name: "Athlète", acceptConditions: true });
    const user = res.body as { id: string };

    await prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerifiedAt: new Date(),
        plan: options.plan ?? "standard",
        timezone: "Europe/Paris",
        ...(options.creeLe ? { createdAt: options.creeLe } : {}),
      },
    });
    await prisma.athleteProfile.create({
      data: {
        userId: user.id,
        objectif: "Triathlon olympique",
        objectifDate: new Date("2026-09-05T00:00:00.000Z"),
        heuresSemaine: 7,
      },
    });
    // L'inscription envoie un message de vérification : il ne doit pas être
    // compté parmi les rappels.
    envoyes.length = 0;
    return { agent, user };
  }

  async function semaineAvecSeances(userId: string, statuts: string[]) {
    await prisma.trainingPlan.create({
      data: {
        userId,
        weekStart: LUNDI,
        rawAiJson: "{}",
        sessions: {
          create: statuts.map((status, i) => ({
            userId,
            date: new Date(`2026-03-0${2 + i}T00:00:00.000Z`),
            sport: "course",
            titre: "Séance",
            dureeMin: 45,
            status,
          })),
        },
      },
    });
  }

  it("relance le dimanche soir quand la semaine suivante n'est pas générée", async () => {
    const { user } = await athlete("dimanche@example.com");
    await semaineAvecSeances(user.id, ["faite", "faite"]);

    const bilan = await runReminders(DIMANCHE_SOIR);

    expect(bilan.envoyes).toBe(1);
    expect(envoyes[0].subject).toContain("semaine d'entraînement");
    expect(envoyes[0].headers?.["List-Unsubscribe"]).toContain(user.id);
  });

  it("n'envoie jamais deux fois le même rappel, même relancé", async () => {
    const { user } = await athlete("idempotent@example.com");
    await semaineAvecSeances(user.id, ["faite", "faite"]);

    await runReminders(DIMANCHE_SOIR);
    await runReminders(DIMANCHE_SOIR);
    await runReminders(new Date("2026-03-08T21:00:00.000Z"));

    expect(envoyes).toHaveLength(1);
    expect(await prisma.reminder.count({ where: { userId: user.id } })).toBe(1);
  });

  it("se tait le dimanche soir si la semaine suivante existe déjà", async () => {
    const { user } = await athlete("deja@example.com");
    await semaineAvecSeances(user.id, ["faite", "faite"]);
    await prisma.trainingPlan.create({
      data: { userId: user.id, weekStart: new Date("2026-03-09T00:00:00.000Z"), rawAiJson: "{}" },
    });

    expect((await runReminders(DIMANCHE_SOIR)).envoyes).toBe(0);
  });

  it("relance sur les séances passées restées sans réponse", async () => {
    const { user } = await athlete("oubli@example.com");
    await semaineAvecSeances(user.id, ["planifiee", "planifiee", "planifiee"]);

    const bilan = await runReminders(JEUDI_SOIR);

    expect(bilan.parType.seances_oubliees).toBe(1);
    // Les trois séances (lundi, mardi, mercredi) sont passées sans réponse.
    expect(envoyes[0].text).toContain("3 séances");
    expect(await prisma.reminder.findFirst({ where: { userId: user.id } })).toMatchObject({
      kind: "seances_oubliees",
      periode: cleSemaine(LUNDI),
    });
  });

  it("ne relance pas pour une seule séance en attente", async () => {
    const { user } = await athlete("patience@example.com");
    await semaineAvecSeances(user.id, ["planifiee", "faite", "faite"]);

    expect((await runReminders(JEUDI_SOIR)).envoyes).toBe(0);
  });

  it("prévient avant la fin de l'essai, et une seule fois", async () => {
    // Compte gratuit créé 12 jours avant : l'essai de 14 jours finit dans 2.
    await athlete("essai@example.com", {
      plan: "free",
      creeLe: new Date(JEUDI_SOIR.getTime() - 12 * 86400000),
    });

    await runReminders(JEUDI_SOIR);
    await runReminders(new Date("2026-03-06T19:00:00.000Z"));

    expect(envoyes).toHaveLength(1);
    expect(envoyes[0].subject).toContain("essai");
  });

  it("n'écrit à personne avant le soir", async () => {
    const { user } = await athlete("matin@example.com");
    await semaineAvecSeances(user.id, ["planifiee", "planifiee", "planifiee"]);

    // 9 h à Paris : l'athlète n'a pas encore eu sa journée pour s'entraîner.
    expect((await runReminders(new Date("2026-03-05T08:00:00.000Z"))).envoyes).toBe(0);
  });

  it("épargne les adresses non confirmées et les comptes désabonnés", async () => {
    const { user: nonConfirme } = await athlete("nonconfirme@example.com");
    await prisma.user.update({ where: { id: nonConfirme.id }, data: { emailVerifiedAt: null } });
    await semaineAvecSeances(nonConfirme.id, ["faite", "faite"]);

    const { user: desabonne } = await athlete("desabonne@example.com");
    await prisma.user.update({ where: { id: desabonne.id }, data: { rappelsEmail: false } });
    await semaineAvecSeances(desabonne.id, ["faite", "faite"]);

    expect((await runReminders(DIMANCHE_SOIR)).envoyes).toBe(0);
  });

  it("permet de se désabonner sans se connecter", async () => {
    const { user } = await athlete("stop@example.com");

    const res = await request(app)
      .post("/api/privacy/rappels/desabonner")
      .send({ userId: user.id, token: unsubscribeToken(user.id) });

    expect(res.status).toBe(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).rappelsEmail).toBe(false);
  });

  it("refuse un jeton de désabonnement forgé", async () => {
    const { user } = await athlete("forge@example.com");

    const res = await request(app)
      .post("/api/privacy/rappels/desabonner")
      .send({ userId: user.id, token: "0".repeat(32) });

    expect(res.status).toBe(400);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).rappelsEmail).toBe(true);
  });

  it("laisse réactiver les rappels depuis le compte", async () => {
    const { agent, user } = await athlete("reactive@example.com");
    await prisma.user.update({ where: { id: user.id }, data: { rappelsEmail: false } });

    const res = await agent.patch("/api/privacy/rappels").send({ rappelsEmail: true });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ rappelsEmail: true });
  });

  it("n'envoie qu'un seul message par soir et par athlète", async () => {
    // Cet athlète coche les deux cas : dimanche soir sans semaine suivante,
    // et des séances passées sans réponse.
    const { user } = await athlete("cumul@example.com");
    await semaineAvecSeances(user.id, ["planifiee", "planifiee", "planifiee"]);

    await runReminders(DIMANCHE_SOIR);

    expect(envoyes).toHaveLength(1);
  });
});
