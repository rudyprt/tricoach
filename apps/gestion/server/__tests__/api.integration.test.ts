import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import type { Express } from "express";

/**
 * Outil de gestion : accès réservé aux administrateurs, saisie des charges et
 * des encaissements, tableau de bord calculé sur la base de l'application.
 */
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIfDb = TEST_DATABASE_URL ? describe : describe.skip;

let app: Express;
let prisma: import("@prisma/client").PrismaClient;
let reinitialiserTentatives: () => void;

const MOT_DE_PASSE = "motdepasse123";

describeIfDb("outil de gestion", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    process.env.GESTION_SECRET = "secret-de-gestion-suffisamment-long-pour-zod";
    process.env.NODE_ENV = "test";
    ({ prisma } = await import("../prisma.js"));
    ({ reinitialiserTentatives } = await import("../auth.js"));
    app = (await import("../app.js")).createApp();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    reinitialiserTentatives();
    await prisma.gestionCharge.deleteMany();
    await prisma.gestionEncaissement.deleteMany();
    await prisma.gestionParametres.deleteMany();
    await prisma.gestionInstantane.deleteMany();
    await prisma.coutIaMensuel.deleteMany();
    await prisma.aiCall.deleteMany();
    await prisma.adminAction.deleteMany();
    await prisma.user.deleteMany();
  });

  async function compte(email: string, role: string, plan = "free") {
    return prisma.user.create({
      data: { email, name: email, role, plan, passwordHash: await bcrypt.hash(MOT_DE_PASSE, 4) },
    });
  }

  async function admin() {
    await compte("gerant@example.com", "admin");
    const agent = request.agent(app);
    const res = await agent.post("/api/connexion").send({ email: "gerant@example.com", password: MOT_DE_PASSE });
    expect(res.status).toBe(200);
    return agent;
  }

  describe("accès", () => {
    it("refuse tout sans connexion", async () => {
      expect((await request(app).get("/api/tableau")).status).toBe(401);
      expect((await request(app).get("/api/charges")).status).toBe(401);
    });

    it("refuse un athlète, même avec le bon mot de passe", async () => {
      await compte("athlete@example.com", "athlete");
      const res = await request(app).post("/api/connexion").send({ email: "athlete@example.com", password: MOT_DE_PASSE });
      expect(res.status).toBe(401);
      expect(res.headers["set-cookie"]).toBeUndefined();
    });

    it("pose un cookie httpOnly et strict à l'administrateur", async () => {
      await compte("gerant@example.com", "admin");
      const res = await request(app).post("/api/connexion").send({ email: "gerant@example.com", password: MOT_DE_PASSE });
      expect(res.status).toBe(200);
      const cookie = String(res.headers["set-cookie"]);
      expect(cookie).toMatch(/HttpOnly/);
      expect(cookie).toMatch(/SameSite=Strict/);
    });

    it("coupe l'accès dès que le rôle est retiré", async () => {
      const agent = await admin();
      expect((await agent.get("/api/tableau")).status).toBe(200);
      await prisma.user.update({ where: { email: "gerant@example.com" }, data: { role: "athlete" } });
      expect((await agent.get("/api/tableau")).status).toBe(401);
    });

    it("bloque après trop de tentatives", async () => {
      await compte("gerant@example.com", "admin");
      for (let i = 0; i < 8; i++) {
        await request(app).post("/api/connexion").send({ email: "gerant@example.com", password: "mauvais" });
      }
      const res = await request(app).post("/api/connexion").send({ email: "gerant@example.com", password: MOT_DE_PASSE });
      expect(res.status).toBe(429);
    });
  });

  describe("tableau", () => {
    it("compte les utilisateurs sans l'administrateur, et photographie le mois", async () => {
      const agent = await admin();
      await compte("a@example.com", "athlete", "standard");
      await compte("b@example.com", "athlete", "premium");
      await compte("c@example.com", "athlete");

      const res = await agent.get("/api/tableau");
      expect(res.status).toBe(200);
      expect(res.body.utilisateurs).toMatchObject({ inscrits: 3, standard: 1, premium: 1, payants: 2, essais: 1 });
      expect(res.body.revenus.mrrPotentielCents).toBe(1999 + 3490);
      expect(await prisma.gestionInstantane.count()).toBe(1);
    });

    it("intègre charges, encaissements et coût IA du mois", async () => {
      const agent = await admin();
      const t0 = (await agent.get("/api/tableau")).body;
      const mois: string = t0.moisCourant;

      await agent.put("/api/parametres").send({ ...t0.parametres, dateDebutActivite: "2026-01-01", tvaSurIa: 0, tauxUsdEur: 1 });
      await agent.post("/api/charges").send({ libelle: "Render", categorie: "hebergement", montantCents: 700, frequence: "mensuelle", debut: `${mois}-01` });
      await agent.post("/api/encaissements").send({ date: `${mois}-01`, libelle: "Abonnement", montantCents: 10_000, fraisCents: 0 });
      await prisma.coutIaMensuel.create({ data: { mois, coutMicroUsd: 3_000_000, appels: 3 } });

      const { ceMois } = (await agent.get("/api/tableau")).body;
      expect(ceMois).toMatchObject({ caCents: 10_000, chargesCents: 700, coutIaCents: 300, prelevementsCents: 2_130 });
      expect(ceMois.resultatCents).toBe(10_000 - 700 - 300 - 2_130);
    });

    it("refuse une année absurde", async () => {
      const agent = await admin();
      expect((await agent.get("/api/tableau?annee=1990")).status).toBe(400);
    });
  });

  describe("saisies", () => {
    it("crée, modifie et supprime une charge", async () => {
      const agent = await admin();
      const corps = { libelle: "Neon", categorie: "base_de_donnees", montantCents: 1900, frequence: "mensuelle", debut: "2026-09-01" };
      const cree = await agent.post("/api/charges").send(corps);
      expect(cree.status).toBe(201);
      const maj = await agent.put(`/api/charges/${cree.body.id}`).send({ ...corps, fin: "2026-12-31" });
      expect(maj.body.fin).toBe("2026-12-31");
      expect((await agent.delete(`/api/charges/${cree.body.id}`)).status).toBe(204);
      expect((await agent.get("/api/charges")).body).toEqual([]);
    });

    it("refuse une résiliation antérieure au début", async () => {
      const agent = await admin();
      const res = await agent
        .post("/api/charges")
        .send({ libelle: "X", categorie: "autre", montantCents: 1, frequence: "mensuelle", debut: "2026-09-01", fin: "2026-08-01" });
      expect(res.status).toBe(400);
    });

    it("estime l'encaissement du mois une seule fois", async () => {
      const agent = await admin();
      await compte("a@example.com", "athlete", "premium");
      const res = await agent.post("/api/encaissements/estimation");
      expect(res.status).toBe(201);
      expect(res.body.montantCents).toBe(3490);
      expect((await agent.post("/api/encaissements/estimation")).status).toBe(409);
    });

    it("valide les paramètres", async () => {
      const agent = await admin();
      const p = (await agent.get("/api/parametres")).body;
      expect((await agent.put("/api/parametres").send({ ...p, tauxCotisations: 150 })).status).toBe(400);
      expect((await agent.put("/api/parametres").send({ ...p, acre: true })).body.acre).toBe(true);
    });
  });
});
