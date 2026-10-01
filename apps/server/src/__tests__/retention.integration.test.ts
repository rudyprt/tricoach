import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Suppression des comptes inactifs.
 *
 * C'est le seul traitement de l'application qui détruise des données sans que
 * personne ne l'ait demandé. Les tests portent donc autant sur ce qu'il
 * supprime que sur ce qu'il doit laisser intact.
 */
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIfDb = TEST_DATABASE_URL ? describe : describe.skip;

let prisma: import("@prisma/client").PrismaClient;
let runRetention: typeof import("../lib/retention.js").runRetention;
let INACTIVITE_AVANT_PURGE_JOURS: number;
let DELAI_AVERTISSEMENT_JOURS: number;

const JOUR_MS = 24 * 60 * 60 * 1000;
const MAINTENANT = new Date("2026-10-01T12:00:00.000Z");

describeIfDb("purge des comptes inactifs", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    process.env.JWT_SECRET = "secret-de-test-suffisamment-long-pour-zod";
    process.env.NODE_ENV = "test";

    ({ prisma } = await import("../lib/prisma.js"));
    ({ runRetention, INACTIVITE_AVANT_PURGE_JOURS, DELAI_AVERTISSEMENT_JOURS } = await import(
      "../lib/retention.js"
    ));
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.user.deleteMany();
  });

  /** Compte dont la dernière visite remonte à `jours`. */
  async function compte(email: string, jours: number, extra: Record<string, unknown> = {}) {
    return prisma.user.create({
      data: {
        email,
        name: "Athlète",
        passwordHash: "peu-importe",
        lastSeenAt: new Date(MAINTENANT.getTime() - jours * JOUR_MS),
        ...extra,
      },
    });
  }

  const existe = async (id: string) => (await prisma.user.findUnique({ where: { id } })) !== null;

  it("supprime un compte inactif depuis plus de deux ans", async () => {
    const vieux = await compte("oublie@example.com", INACTIVITE_AVANT_PURGE_JOURS + 1);

    const bilan = await runRetention(MAINTENANT);

    expect(bilan.supprimes).toBe(1);
    expect(await existe(vieux.id)).toBe(false);
  });

  it("laisse intact un compte actif, et même un compte inactif depuis un an", async () => {
    const recent = await compte("actif@example.com", 3);
    const unAn = await compte("unan@example.com", 365);

    const bilan = await runRetention(MAINTENANT);

    expect(bilan.supprimes).toBe(0);
    expect(await existe(recent.id)).toBe(true);
    expect(await existe(unAn.id)).toBe(true);
  });

  it("ne supprime pas la veille de l'échéance", async () => {
    // Une erreur d'un jour sur deux ans détruirait des comptes en règle.
    const veille = await compte("veille@example.com", INACTIVITE_AVANT_PURGE_JOURS - 1);

    await runRetention(MAINTENANT);

    expect(await existe(veille.id)).toBe(true);
  });

  it("compte l'inactivité depuis l'inscription quand l'athlète n'est jamais revenu", async () => {
    const jamais = await prisma.user.create({
      data: {
        email: "jamais@example.com",
        name: "Athlète",
        passwordHash: "peu-importe",
        lastSeenAt: null,
        createdAt: new Date(MAINTENANT.getTime() - (INACTIVITE_AVANT_PURGE_JOURS + 10) * JOUR_MS),
      },
    });

    await runRetention(MAINTENANT);

    expect(await existe(jamais.id)).toBe(false);
  });

  it("épargne un administrateur, fût-il inactif", async () => {
    // Supprimer le seul compte capable d'administrer le service serait une
    // panne déguisée en conformité.
    const admin = await compte("admin@example.com", INACTIVITE_AVANT_PURGE_JOURS + 100, { role: "admin" });

    await runRetention(MAINTENANT);

    expect(await existe(admin.id)).toBe(true);
  });

  it("emporte tout ce qui dépendait du compte", async () => {
    const athlete = await compte("cascade@example.com", INACTIVITE_AVANT_PURGE_JOURS + 5);
    const plan = await prisma.trainingPlan.create({
      data: {
        userId: athlete.id,
        weekStart: new Date("2024-01-01T00:00:00.000Z"),
        rawAiJson: "{}",
        sessions: {
          create: [
            {
              userId: athlete.id,
              date: new Date("2024-01-03T00:00:00.000Z"),
              sport: "course",
              titre: "Séance",
              dureeMin: 45,
            },
          ],
        },
      },
    });

    await runRetention(MAINTENANT);

    expect(await prisma.trainingPlan.findUnique({ where: { id: plan.id } })).toBeNull();
    expect(await prisma.session.count({ where: { userId: athlete.id } })).toBe(0);
  });

  describe("avertissement avant suppression", () => {
    beforeEach(() => {
      vi.resetModules();
    });

    it("n'avertit pas quand aucun envoi n'est possible", async () => {
      // Sans SMTP, l'avertissement ne partirait nulle part : le marquer envoyé
      // ferait croire à une alerte que personne n'a reçue.
      const proche = await compte(
        "proche@example.com",
        INACTIVITE_AVANT_PURGE_JOURS - DELAI_AVERTISSEMENT_JOURS + 1
      );

      const bilan = await runRetention(MAINTENANT);

      expect(bilan.avertis).toBe(0);
      expect((await prisma.user.findUniqueOrThrow({ where: { id: proche.id } })).purgeAvertieLe).toBeNull();
      expect(await existe(proche.id)).toBe(true);
    });
  });
});
