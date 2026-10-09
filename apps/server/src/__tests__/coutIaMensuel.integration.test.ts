import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

/**
 * Le coût IA agrégé par mois doit survivre à la suppression des comptes : sans
 * lui, une suppression effaçait rétroactivement une dépense déjà facturée.
 */
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIfDb = TEST_DATABASE_URL ? describe : describe.skip;

let prisma: import("@prisma/client").PrismaClient;
let recordAiCall: typeof import("../lib/aiUsage.js").recordAiCall;
let moisParis: typeof import("../lib/aiUsage.js").moisParis;

describeIfDb("coût IA mensuel", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    process.env.JWT_SECRET = "secret-de-test-suffisamment-long-pour-zod";
    process.env.NODE_ENV = "test";
    ({ prisma } = await import("../lib/prisma.js"));
    ({ recordAiCall, moisParis } = await import("../lib/aiUsage.js"));
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.aiCall.deleteMany();
    await prisma.coutIaMensuel.deleteMany();
    await prisma.user.deleteMany({ where: { email: "cout-ia@example.com" } });
  });

  it("cumule les appels du mois et les conserve après suppression du compte", async () => {
    const user = await prisma.user.create({
      data: { email: "cout-ia@example.com", passwordHash: "x", name: "Coût" },
    });
    const response: import("../lib/anthropic.js").ClaudeResponse = {
      text: "",
      model: "claude-sonnet-5",
      usage: { inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
    };
    await recordAiCall({ userId: user.id, kind: "chat", response, succeeded: true });
    await recordAiCall({ userId: user.id, kind: "chat", response, succeeded: true });

    await prisma.user.delete({ where: { id: user.id } });

    const ligne = await prisma.coutIaMensuel.findUnique({ where: { mois: moisParis(new Date()) } });
    expect(ligne?.appels).toBe(2);
    // 1 M de tokens d'entrée à 2 $ le million, deux fois.
    expect(Number(ligne?.coutMicroUsd)).toBe(4_000_000);
  });

  it("range un appel dans le mois civil de Paris, pas celui d'UTC", () => {
    expect(moisParis(new Date("2026-10-31T23:30:00Z"))).toBe("2026-11");
    expect(moisParis(new Date("2026-10-31T21:30:00Z"))).toBe("2026-10");
  });
});
