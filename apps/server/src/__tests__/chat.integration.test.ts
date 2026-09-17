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
    model: "claude-sonnet-5",
    usage: { inputTokens: 1200, outputTokens: 300, cacheReadTokens: 0, cacheWriteTokens: 0 },
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

    // 30 échanges déjà enregistrés : au-delà de la fenêtre de 20 messages.
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

    const history = askClaude.mock.calls[0][0].messages as { content: string }[];
    // 20 messages d'historique + la question courante
    expect(history).toHaveLength(21);
    expect(history[0].content).toBe("message-10");
    expect(history[19].content).toBe("message-29");
    expect(history[20].content).toBe("Nouvelle question");
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

  it("applique le quota quotidien aux comptes non premium", async () => {
    const { agent, user } = await signUp("quota@example.com");
    const { CHAT_DAILY_LIMIT } = await import("../lib/subscription.js");

    await prisma.chatMessage.createMany({
      data: Array.from({ length: CHAT_DAILY_LIMIT }, (_, i) => ({
        userId: user.id,
        role: "user",
        content: `q${i}`,
      })),
    });

    askClaude.mockResolvedValue(claudeReply("Réponse."));
    const res = await agent.post("/api/chat").send({ content: "Un de trop" });
    expect(res.status).toBe(402);
    expect(res.body.code).toBe("SUBSCRIPTION_REQUIRED");
    expect(askClaude).not.toHaveBeenCalled();
  });

  it("ne limite pas les comptes premium", async () => {
    const { agent, user } = await signUp("premium-chat@example.com");
    const { CHAT_DAILY_LIMIT } = await import("../lib/subscription.js");
    await prisma.user.update({ where: { id: user.id }, data: { plan: "premium" } });
    await prisma.chatMessage.createMany({
      data: Array.from({ length: CHAT_DAILY_LIMIT + 5 }, (_, i) => ({
        userId: user.id,
        role: "user",
        content: `q${i}`,
      })),
    });

    askClaude.mockResolvedValue(claudeReply("Réponse."));
    expect((await agent.post("/api/chat").send({ content: "Encore une" })).status).toBe(201);
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
});
