import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { Express } from "express";

const askClaude = vi.fn();

// Le coach IA est simulé : ces tests portent sur la mécanique du fil de
// discussion (fenêtre d'historique, quota, message orphelin), pas sur le modèle.
vi.mock("../lib/anthropic.js", () => ({
  askClaude: (...args: unknown[]) => askClaude(...args),
  isAiConfigured: () => true,
  MODEL: "claude-sonnet-5",
  AiNotConfiguredError: class extends Error {},
}));

/** Réponse du SDK telle que la voit `askClaude`, tokens compris. */
function claudeReply(text: string) {
  return {
    text,
    toolUses: [],
    content: [{ type: "text", text }],
    stopReason: "end_turn",
    model: "claude-sonnet-5",
    usage: { inputTokens: 1200, outputTokens: 300, cacheReadTokens: 0, cacheWriteTokens: 0 },
  };
}

/** Réponse où le modèle demande d'enregistrer une séance. */
function claudeOutilSeance(input: Record<string, unknown>) {
  const bloc = { type: "tool_use", id: "toolu_test", name: "enregistrer_seance", input };
  return {
    text: "",
    toolUses: [{ id: bloc.id, name: bloc.name, input }],
    content: [bloc],
    stopReason: "tool_use",
    model: "claude-sonnet-5",
    usage: { inputTokens: 1200, outputTokens: 120, cacheReadTokens: 0, cacheWriteTokens: 0 },
  };
}

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIfDb = TEST_DATABASE_URL ? describe : describe.skip;

let app: Express;
let prisma: import("@prisma/client").PrismaClient;
let resetAllRateLimits: () => Promise<void>;

describeIfDb("chat", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    process.env.JWT_SECRET = "secret-de-test-suffisamment-long-pour-zod";
    process.env.NODE_ENV = "test";
    process.env.ANTHROPIC_API_KEY = "sk-ant-fake";

    ({ prisma } = await import("../lib/prisma.js"));
    ({ resetAllRateLimits } = await import("../lib/rateLimit.js"));
    app = (await import("../app.js")).createApp();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await resetAllRateLimits();
    askClaude.mockReset();
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
    const res = await agent
      .post("/api/auth/register")
      .send({ email, password: "motdepasse123", name: "Athlète", acceptConditions: true });
    expect(res.status).toBe(201);
    return { agent, user: res.body as { id: string } };
  }

  it("enregistre la question et la réponse dans le bon ordre", async () => {
    const { agent } = await signUp("fil@example.com");
    askClaude.mockResolvedValue(claudeReply("Voici mon conseil."));

    const res = await agent.post("/api/chat").send({ content: "Comment gérer ma semaine ?" });
    expect(res.status).toBe(201);
    expect(res.body.role).toBe("assistant");

    const fil = await agent.get("/api/chat");
    expect(fil.body.messages.map((m: { role: string }) => m.role)).toEqual(["user", "assistant"]);
    expect(fil.body.messages[0].content).toBe("Comment gérer ma semaine ?");
    expect(fil.body.messages[1].content).toBe("Voici mon conseil.");
  });

  it("n'enregistre pas la question si le coach échoue", async () => {
    const { agent } = await signUp("echec@example.com");
    askClaude.mockRejectedValue(new Error("API indisponible"));

    const res = await agent.post("/api/chat").send({ content: "Question perdue" });
    expect(res.status).toBe(502);

    const fil = await agent.get("/api/chat");
    expect(fil.body.messages).toEqual([]);
  });

  it("transmet au modèle les messages les plus récents, pas les plus anciens", async () => {
    const { agent, user } = await signUp("fenetre@example.com");

    // 30 échanges déjà enregistrés : bien au-delà de la fenêtre d'envoi.
    // Datés de l'avant-veille, pour ne pas consommer le quota du jour.
    const base = Date.now() - 2 * 24 * 60 * 60 * 1000;
    await prisma.chatMessage.createMany({
      data: Array.from({ length: 30 }, (_, i) => ({
        userId: user.id,
        role: i % 2 === 0 ? "user" : "assistant",
        content: `message-${i}`,
        createdAt: new Date(base + i * 1000),
      })),
    });

    askClaude.mockResolvedValue(claudeReply("Réponse."));
    expect((await agent.post("/api/chat").send({ content: "Nouvelle question" })).status).toBe(201);

    const history = askClaude.mock.calls[0][0].messages as { role: string; content: string }[];
    // La fenêtre vaut douze messages, question courante comprise. Ici elle
    // tomberait sur une réponse du coach (message-19) : ce tour est écarté, car
    // l'API refuse une conversation qui ne commence pas par l'athlète. Onze
    // messages partent donc, et non douze.
    expect(history).toHaveLength(11);
    expect(history[0].role).toBe("user");
    expect(history[0].content).toBe("message-20");
    expect(history[9].content).toBe("message-29");
    expect(history[10].content).toBe("Nouvelle question");
    // L'historique complet reste en base : seul l'envoi est tronqué.
    expect(await prisma.chatMessage.count({ where: { userId: user.id } })).toBe(32);
  });

  it("ne renvoie jamais plus que la fenêtre, quelle que soit l'ancienneté du fil", async () => {
    const { agent, user } = await signUp("fenetre-longue@example.com");

    // Deux cents messages : sans plafond, c'est tout cela qui partirait à chaque
    // question, et la facture croîtrait avec l'ancienneté du compte.
    const base = Date.now() - 2 * 24 * 60 * 60 * 1000;
    await prisma.chatMessage.createMany({
      data: Array.from({ length: 200 }, (_, i) => ({
        userId: user.id,
        role: i % 2 === 0 ? "user" : "assistant",
        content: `vieux-${i}`,
        createdAt: new Date(base + i * 1000),
      })),
    });

    askClaude.mockResolvedValue(claudeReply("Réponse."));
    await agent.post("/api/chat").send({ content: "Question" });

    const { FENETRE_CHAT } = await import("../lib/chatHistory.js");
    const history = askClaude.mock.calls[0][0].messages as { role: string }[];
    expect(history.length).toBeLessThanOrEqual(FENETRE_CHAT);
    expect(history[0].role).toBe("user");
  });

  it("garde l'historique dans l'ordre chronologique", async () => {
    const { agent, user } = await signUp("ordre@example.com");
    const base = Date.now() - 2 * 24 * 60 * 60 * 1000;
    await prisma.chatMessage.createMany({
      data: [
        { userId: user.id, role: "user", content: "premier", createdAt: new Date(base) },
        { userId: user.id, role: "assistant", content: "deuxieme", createdAt: new Date(base + 1000) },
        { userId: user.id, role: "user", content: "troisieme", createdAt: new Date(base + 2000) },
      ],
    });

    askClaude.mockResolvedValue(claudeReply("Réponse."));
    await agent.post("/api/chat").send({ content: "quatrieme" });

    const history = askClaude.mock.calls[0][0].messages as { content: string }[];
    expect(history.map((m) => m.content)).toEqual(["premier", "deuxieme", "troisieme", "quatrieme"]);
  });

  /** Sème des questions déjà posées aujourd'hui, sans passer par la route. */
  async function questionsDuJour(userId: string, nombre: number) {
    await prisma.chatMessage.createMany({
      data: Array.from({ length: nombre }, (_, i) => ({
        userId,
        role: "user",
        content: `q${i}`,
      })),
    });
  }

  it("refuse au-delà du quota Standard, sans appeler le modèle", async () => {
    const { agent, user } = await signUp("quota@example.com");
    const { QUOTA_CHAT_STANDARD } = await import("../lib/subscription.js");
    await questionsDuJour(user.id, QUOTA_CHAT_STANDARD);

    askClaude.mockResolvedValue(claudeReply("Réponse."));
    const res = await agent.post("/api/chat").send({ content: "Un de trop" });

    expect(res.status).toBe(429);
    expect(res.body.code).toBe("CHAT_QUOTA_REACHED");
    expect(res.body.error).toContain("se réinitialise à minuit, heure de Paris");
    // Le point du plafond : l'appel payant n'a pas lieu.
    expect(askClaude).not.toHaveBeenCalled();
  });

  it("laisse un compte Premium dépasser le quota Standard", async () => {
    const { agent, user } = await signUp("premium-chat@example.com");
    const { QUOTA_CHAT_STANDARD } = await import("../lib/subscription.js");
    await prisma.user.update({ where: { id: user.id }, data: { plan: "premium" } });
    await questionsDuJour(user.id, QUOTA_CHAT_STANDARD + 5);

    askClaude.mockResolvedValue(claudeReply("Réponse."));
    expect((await agent.post("/api/chat").send({ content: "Encore une" })).status).toBe(201);
  });

  it("refuse aussi un compte Premium à son propre plafond", async () => {
    // Sans cela, « Premium » voudrait dire « sans limite de coût ».
    const { agent, user } = await signUp("premium-plafond@example.com");
    const { QUOTA_CHAT_PREMIUM } = await import("../lib/subscription.js");
    await prisma.user.update({ where: { id: user.id }, data: { plan: "premium" } });
    await questionsDuJour(user.id, QUOTA_CHAT_PREMIUM);

    askClaude.mockResolvedValue(claudeReply("Réponse."));
    const res = await agent.post("/api/chat").send({ content: "Un de trop" });

    expect(res.status).toBe(429);
    expect(askClaude).not.toHaveBeenCalled();
  });

  it("ne compte pas les messages de la veille", async () => {
    // Le compteur est une requête datée, pas un champ remis à zéro par une
    // tâche : rien ne doit tourner à minuit pour que le quota se libère.
    const { agent, user } = await signUp("quota-veille@example.com");
    const { QUOTA_CHAT_PREMIUM } = await import("../lib/subscription.js");
    const hier = new Date(Date.now() - 36 * 60 * 60 * 1000);
    await prisma.chatMessage.createMany({
      data: Array.from({ length: QUOTA_CHAT_PREMIUM + 10 }, (_, i) => ({
        userId: user.id,
        role: "user",
        content: `hier-${i}`,
        createdAt: new Date(hier.getTime() + i * 1000),
      })),
    });

    askClaude.mockResolvedValue(claudeReply("Réponse."));
    expect((await agent.post("/api/chat").send({ content: "Aujourd'hui" })).status).toBe(201);
  });

  it("annonce le quota restant avec le fil", async () => {
    // L'interface le lisait dans le navigateur, qui ignore le fuseau de
    // référence et l'offre : elle annonçait un reste que le serveur refusait.
    const { agent, user } = await signUp("quota-affiche@example.com");
    const { QUOTA_CHAT_STANDARD } = await import("../lib/subscription.js");
    await questionsDuJour(user.id, 3);

    const res = await agent.get("/api/chat");
    expect(res.status).toBe(200);
    expect(res.body.quota).toEqual({ utilises: 3, limite: QUOTA_CHAT_STANDARD, bloque: null });
  });

  it("distingue le mur du quota de celui de l'abonnement", async () => {
    // Les annoncer pareil enverrait l'athlète attendre minuit pour rien : un
    // essai terminé ne se débloque pas en patientant.
    const { agent, user } = await signUp("deux-murs@example.com");
    const { QUOTA_CHAT_STANDARD, TRIAL_DAYS } = await import("../lib/subscription.js");

    await questionsDuJour(user.id, QUOTA_CHAT_STANDARD);
    expect((await agent.get("/api/chat")).body.quota.bloque).toBe("quota");

    // Essai expiré : le compte est antidaté au-delà de la période d'essai.
    await prisma.user.update({
      where: { id: user.id },
      data: { createdAt: new Date(Date.now() - (TRIAL_DAYS + 1) * 24 * 60 * 60 * 1000) },
    });
    expect((await agent.get("/api/chat")).body.quota.bloque).toBe("abonnement");
  });

  it("refuse le chat à un essai expiré, comme la génération de programme", async () => {
    // Le chat se payait tout seul : un compte abandonné après l'essai pouvait
    // appeler le modèle indéfiniment sans rien payer.
    const { agent, user } = await signUp("essai-fini@example.com");
    const { TRIAL_DAYS } = await import("../lib/subscription.js");
    await prisma.user.update({
      where: { id: user.id },
      data: { createdAt: new Date(Date.now() - (TRIAL_DAYS + 1) * 24 * 60 * 60 * 1000) },
    });

    askClaude.mockResolvedValue(claudeReply("Réponse."));
    const res = await agent.post("/api/chat").send({ content: "Une question" });

    expect(res.status).toBe(402);
    expect(res.body.code).toBe("SUBSCRIPTION_REQUIRED");
    expect(askClaude).not.toHaveBeenCalled();
  });

  it("laisse écrire un compte payant dont l'essai est depuis longtemps fini", async () => {
    // Le garde-fou doit viser les comptes qui ne paient pas, pas les clients.
    const { agent, user } = await signUp("payant-ancien@example.com");
    const { TRIAL_DAYS } = await import("../lib/subscription.js");
    await prisma.user.update({
      where: { id: user.id },
      data: {
        plan: "standard",
        createdAt: new Date(Date.now() - (TRIAL_DAYS + 90) * 24 * 60 * 60 * 1000),
      },
    });

    askClaude.mockResolvedValue(claudeReply("Réponse."));
    expect((await agent.post("/api/chat").send({ content: "Une question" })).status).toBe(201);
  });

  it("permet d'effacer la conversation", async () => {
    const { agent } = await signUp("reset-chat@example.com");
    askClaude.mockResolvedValue(claudeReply("Réponse."));
    await agent.post("/api/chat").send({ content: "Bonjour" });

    expect((await agent.delete("/api/chat")).status).toBe(200);
    expect((await agent.get("/api/chat")).body.messages).toEqual([]);
  });

  it("enregistre la consommation de tokens et son coût", async () => {
    const { agent, user } = await signUp("cout@example.com");
    askClaude.mockResolvedValue(claudeReply("Réponse."));

    await agent.post("/api/chat").send({ content: "Combien de séances cette semaine ?" });

    const call = await prisma.aiCall.findFirstOrThrow({ where: { userId: user.id } });
    expect(call.kind).toBe("chat");
    expect(call.inputTokens).toBe(1200);
    expect(call.outputTokens).toBe(300);
    expect(call.succeeded).toBe(true);
    // 1200 tokens à 2 $/M + 300 tokens à 10 $/M = 0,0054 $ = 5400 micro-dollars
    expect(call.costMicroUsd).toBe(5400);
  });

  it("enregistre aussi un appel en échec, qui reste facturable", async () => {
    const { agent, user } = await signUp("cout-echec@example.com");
    askClaude.mockRejectedValue(new Error("API indisponible"));

    await agent.post("/api/chat").send({ content: "Question" });

    const call = await prisma.aiCall.findFirstOrThrow({ where: { userId: user.id } });
    expect(call.succeeded).toBe(false);
  });

  it("refuse un message vide ou démesuré", async () => {
    const { agent } = await signUp("bornes@example.com");
    expect((await agent.post("/api/chat").send({ content: "   " })).status).toBe(400);
    expect((await agent.post("/api/chat").send({ content: "x".repeat(5000) })).status).toBe(400);
    expect(askClaude).not.toHaveBeenCalled();
  });

  describe("séance racontée au coach", () => {
    /*
     * « J'ai fait ma sortie longue hier, 1h40 » se perdait dans le fil : ni
     * dans l'historique, ni dans la charge, ni dans la semaine suivante — qui
     * se construit pourtant sur ce qui a été réalisé.
     */
    const hier = () => {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() - 1);
      return d.toISOString().slice(0, 10);
    };

    async function avecProgramme(userId: string) {
      const lundi = new Date();
      lundi.setUTCHours(0, 0, 0, 0);
      lundi.setUTCDate(lundi.getUTCDate() - ((lundi.getUTCDay() + 6) % 7));
      return prisma.trainingPlan.create({
        data: { userId, weekStart: lundi, rawAiJson: "{}" },
      });
    }

    it("marque faite la séance déjà au programme ce jour-là", async () => {
      const { agent, user } = await signUp("declare-planifiee@example.com");
      const plan = await avecProgramme(user.id);
      const seance = await prisma.session.create({
        data: {
          planId: plan.id,
          userId: user.id,
          date: new Date(`${hier()}T00:00:00.000Z`),
          sport: "course",
          titre: "Sortie longue",
          dureeMin: 90,
        },
      });

      askClaude
        .mockResolvedValueOnce(claudeOutilSeance({ date: hier(), sport: "course", dureeMin: 100, ressenti: "bien" }))
        .mockResolvedValueOnce(claudeReply("C'est noté dans ton historique."));

      const res = await agent.post("/api/chat").send({ content: "J'ai fait ma sortie longue hier, 1h40, j'étais bien." });
      expect(res.status).toBe(201);
      expect(res.body.seancesEnregistrees).toBe(1);
      expect(res.body.content).toBe("C'est noté dans ton historique.");

      const apres = await prisma.session.findUniqueOrThrow({ where: { id: seance.id } });
      expect(apres.status).toBe("faite");
      expect(apres.dureeReelleMin).toBe(100);
      expect(apres.ressenti).toBe("bien");
      // Pas de doublon : l'athlète raconte ce que son coach lui avait demandé.
      expect(await prisma.session.count({ where: { userId: user.id } })).toBe(1);
    });

    it("ajoute une séance qui n'était pas au programme", async () => {
      const { agent, user } = await signUp("declare-libre@example.com");
      await avecProgramme(user.id);

      askClaude
        .mockResolvedValueOnce(
          claudeOutilSeance({ date: hier(), sport: "velo", dureeMin: 75, titre: "Sortie imprévue" })
        )
        .mockResolvedValueOnce(claudeReply("Ajoutée."));

      await agent.post("/api/chat").send({ content: "Sortie vélo hier, 1h15, pas prévue." });

      const seance = await prisma.session.findFirstOrThrow({ where: { userId: user.id } });
      expect(seance).toMatchObject({ sport: "velo", status: "faite", dureeMin: 75, dureeReelleMin: 75 });
      expect(seance.titre).toBe("Sortie imprévue");
    });

    it("refuse une date future et le dit au modèle", async () => {
      const { agent, user } = await signUp("declare-futur@example.com");
      await avecProgramme(user.id);
      const demain = new Date();
      demain.setUTCDate(demain.getUTCDate() + 1);

      askClaude
        .mockResolvedValueOnce(
          claudeOutilSeance({ date: demain.toISOString().slice(0, 10), sport: "course", dureeMin: 40 })
        )
        .mockResolvedValueOnce(claudeReply("Elle n'est pas encore faite."));

      const res = await agent.post("/api/chat").send({ content: "Je cours demain 40 min" });
      expect(res.body.seancesEnregistrees).toBe(0);
      expect(await prisma.session.count({ where: { userId: user.id } })).toBe(0);

      // Le modèle reçoit la raison du refus, pour pouvoir l'expliquer.
      const resultat = askClaude.mock.calls[1][0].messages.at(-1).content[0];
      expect(resultat.content).toContain("futur");
    });

    it("ne perd pas le message quand aucun programme ne couvre la date", async () => {
      const { agent, user } = await signUp("declare-sans-plan@example.com");

      askClaude
        .mockResolvedValueOnce(claudeOutilSeance({ date: hier(), sport: "natation", dureeMin: 45 }))
        .mockResolvedValueOnce(claudeReply("Je n'ai pas pu l'enregistrer."));

      const res = await agent.post("/api/chat").send({ content: "J'ai nagé 45 min hier" });
      expect(res.status).toBe(201);
      expect(res.body.seancesEnregistrees).toBe(0);
      // La conversation continue normalement : l'échec d'enregistrement ne
      // doit pas faire perdre la question ni la réponse.
      const fil = await agent.get("/api/chat");
      expect(fil.body.messages).toHaveLength(2);
    });

    it("ne fait qu'un seul appel quand rien n'est déclaré", async () => {
      const { agent } = await signUp("declare-rien@example.com");
      askClaude.mockResolvedValue(claudeReply("Bonne question."));

      await agent.post("/api/chat").send({ content: "Comment gérer ma semaine ?" });
      // Le second appel n'a lieu que si une séance est réellement déclarée :
      // le coût ne double pas à chaque message.
      expect(askClaude).toHaveBeenCalledTimes(1);
    });
  });

});
