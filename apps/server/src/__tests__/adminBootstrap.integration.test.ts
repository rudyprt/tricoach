import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";

/**
 * Promotion du premier administrateur par variable d'environnement, pour les
 * cas où aucun terminal n'est disponible (téléphone, hébergement sans shell).
 */
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIfDb = TEST_DATABASE_URL ? describe : describe.skip;

let app: Express;
let prisma: import("@prisma/client").PrismaClient;
let resetAllRateLimits: () => void;

const PATRON = "patron@tricoach.fr";

describeIfDb("amorçage admin par ADMIN_EMAILS", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    process.env.JWT_SECRET = "secret-de-test-suffisamment-long-pour-zod";
    process.env.NODE_ENV = "test";
    // Deux adresses, dont une avec espaces et majuscules : la configuration est
    // saisie à la main dans un tableau de bord, elle doit tolérer ça.
    process.env.ADMIN_EMAILS = ` ${PATRON.toUpperCase()} , associe@tricoach.fr `;

    ({ prisma } = await import("../lib/prisma.js"));
    ({ resetAllRateLimits } = await import("../lib/rateLimit.js"));
    app = (await import("../app.js")).createApp();
  });

  afterAll(async () => {
    await prisma.$disconnect();
    delete process.env.ADMIN_EMAILS;
  });

  beforeEach(async () => {
    resetAllRateLimits();
    await prisma.adminAction.deleteMany();
    await prisma.aiCall.deleteMany();
    await prisma.chatMessage.deleteMany();
    await prisma.session.deleteMany();
    await prisma.trainingPlan.deleteMany();
    await prisma.athleteProfile.deleteMany();
    await prisma.passwordResetToken.deleteMany();
    await prisma.user.deleteMany();
  });

  async function signUp(email: string) {
    const agent = request.agent(app);
    const res = await agent.post("/api/auth/register").send({ email, password: "motdepasse123", name: "Compte" });
    expect(res.status).toBe(201);
    return { agent, user: res.body as { id: string } };
  }

  it("promeut le compte listé dès la première consultation de /me", async () => {
    const { agent, user } = await signUp(PATRON);

    // À l'inscription, le compte est encore un athlète ordinaire.
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).role).toBe("athlete");

    const me = await agent.get("/api/auth/me");
    expect(me.status).toBe(200);
    expect(me.body.role).toBe("admin");

    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).role).toBe("admin");
    expect((await agent.get("/api/admin/overview")).status).toBe(200);
  });

  it("promeut aussi à la connexion, quelle que soit la casse saisie", async () => {
    await signUp(PATRON);

    const agent = request.agent(app);
    const login = await agent.post("/api/auth/login").send({ email: PATRON, password: "motdepasse123" });
    expect(login.status).toBe(200);
    expect(login.body.role).toBe("admin");
  });

  it("donne l'accès admin même sans passer par /me au préalable", async () => {
    const { agent } = await signUp("associe@tricoach.fr");
    expect((await agent.get("/api/admin/users")).status).toBe(200);
  });

  it("laisse les autres comptes en athlète", async () => {
    const { agent, user } = await signUp("quelquun@example.com");
    const me = await agent.get("/api/auth/me");
    expect(me.body.role).toBe("athlete");
    expect((await agent.get("/api/admin/overview")).status).toBe(404);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).role).toBe("athlete");
  });

  it("ne crée jamais de compte : une adresse listée mais non inscrite reste libre", async () => {
    // Le garde-fou important : la variable ne réserve pas l'adresse. Un tiers
    // qui s'inscrirait avec elle obtiendrait le rôle — d'où la consigne de
    // s'inscrire AVANT de renseigner la variable.
    expect(await prisma.user.count({ where: { email: PATRON } })).toBe(0);
    expect(await prisma.user.count({ where: { role: "admin" } })).toBe(0);
  });

  it("journalise la promotion", async () => {
    const { agent, user } = await signUp(PATRON);
    await agent.get("/api/auth/me");

    const action = await prisma.adminAction.findFirstOrThrow({ where: { action: "role.bootstrap" } });
    expect(action.targetUserId).toBe(user.id);
    expect(action.details).toMatchObject({ de: "athlete", vers: "admin", source: "ADMIN_EMAILS" });
  });

  it("ne rétrograde pas un admin retiré de la variable", async () => {
    const { agent, user } = await signUp("ancien@example.com");
    await prisma.user.update({ where: { id: user.id }, data: { role: "admin" } });

    const me = await agent.get("/api/auth/me");
    expect(me.body.role).toBe("admin");
  });

  it("lit la liste une seule fois, au démarrage", async () => {
    const { isBootstrapAdmin } = await import("../lib/adminBootstrap.js");
    expect(isBootstrapAdmin(PATRON)).toBe(true);

    // La configuration est validée et figée au boot : modifier la variable sur
    // un serveur déjà lancé ne change rien. Chez l'hébergeur, enregistrer une
    // variable d'environnement redémarre le service, ce qui la prend en compte.
    process.env.ADMIN_EMAILS = "";
    expect(isBootstrapAdmin(PATRON)).toBe(true);
  });
});
