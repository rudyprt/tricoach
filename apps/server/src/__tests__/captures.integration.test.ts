import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { Express } from "express";

const askClaude = vi.fn();
vi.mock("../lib/anthropic.js", () => ({
  askClaude: (...args: unknown[]) => askClaude(...args),
  isAiConfigured: () => true,
  AiNotConfiguredError: class extends Error {},
}));

/**
 * Capture d'écran d'une séance : lue, confirmée par l'athlète, puis comptée
 * comme une activité mesurée.
 */
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIfDb = TEST_DATABASE_URL ? describe : describe.skip;

let app: Express;
let prisma: import("@prisma/client").PrismaClient;
let resetAllRateLimits: () => Promise<void>;

// Un PNG d'un pixel : son contenu importe peu, le modèle est simulé.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64"
);

function lecture(json: Record<string, unknown>) {
  const text = JSON.stringify(json);
  return {
    text,
    toolUses: [],
    content: [{ type: "text", text }],
    stopReason: "end_turn",
    model: "claude-haiku-5-5",
    usage: { inputTokens: 1600, outputTokens: 80, cacheReadTokens: 0, cacheWriteTokens: 0 },
  };
}

describeIfDb("captures d'écran de séance", () => {
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
    await resetAllRateLimits();
    askClaude.mockReset();
    await prisma.activity.deleteMany();
    await prisma.trainingPlan.deleteMany();
    await prisma.user.deleteMany();
  });

  async function athlete(email: string) {
    const agent = request.agent(app);
    const res = await agent
      .post("/api/auth/register")
      .send({ email, password: "motdepasse123", name: "Athlète", acceptConditions: true });
    const user = res.body as { id: string };
    const plan = await prisma.trainingPlan.create({
      data: {
        userId: user.id,
        weekStart: new Date("2026-10-12T00:00:00.000Z"),
        rawAiJson: "{}",
        sessions: {
          create: [
            {
              userId: user.id,
              date: new Date("2026-10-12T00:00:00.000Z"),
              sport: "course",
              titre: "Footing",
              dureeMin: 60,
            },
          ],
        },
      },
      include: { sessions: true },
    });
    return { agent, user, seance: plan.sessions[0] };
  }

  it("lit la capture sans rien enregistrer, puis enregistre les valeurs confirmées", async () => {
    const { agent, user, seance } = await athlete("capture@example.com");
    askClaude.mockResolvedValue(
      lecture({ lisible: true, sport: "course", duree: "52:10", distanceKm: 10.2, allure: "5:07 /km", fcMoyenne: 148, fcMax: 171 })
    );

    const lue = await agent.post(`/api/sessions/${seance.id}/capture`).attach("captures", PNG, "strava.png");

    expect(lue.status).toBe(200);
    expect(lue.body.mesures).toMatchObject({ dureeMin: 52, distanceKm: 10.2, allureSecParKm: 307, fcMoyenne: 148 });
    expect(lue.body.avertissements).toEqual([]);
    // L'image part au modèle, rien n'est encore enregistré.
    expect(askClaude.mock.calls[0][0].messages[0].content[0].type).toBe("image");
    expect(await prisma.activity.count({ where: { userId: user.id } })).toBe(0);

    // L'athlète corrige la durée avant de valider.
    const validee = await agent
      .post(`/api/sessions/${seance.id}/capture/valider`)
      .send({ ...lue.body.mesures, dureeMin: 55 });

    expect(validee.status).toBe(200);
    expect(validee.body.session).toMatchObject({ status: "faite", dureeReelleMin: 55 });
    expect(validee.body.bilan.constats[0].texte).toContain("55 min sur 60");
    const activite = await prisma.activity.findFirstOrThrow({ where: { userId: user.id } });
    expect(activite).toMatchObject({ source: "capture", sessionId: seance.id, fcMoyenne: 148, dureeMin: 55 });

    // Revalider corrige l'activité au lieu d'en créer une seconde.
    await agent.post(`/api/sessions/${seance.id}/capture/valider`).send({ dureeMin: 58 });
    expect(await prisma.activity.count({ where: { userId: user.id } })).toBe(1);
  });

  it("prévient quand la capture montre une autre discipline", async () => {
    const { agent, seance } = await athlete("discipline@example.com");
    askClaude.mockResolvedValue(lecture({ lisible: true, sport: "velo", duree: "1:30:00", distanceKm: 45 }));

    const lue = await agent.post(`/api/sessions/${seance.id}/capture`).attach("captures", PNG, "velo.png");

    expect(lue.body.avertissements[0]).toContain("vélo");
  });

  it("refuse ce qui n'est pas une image lisible", async () => {
    const { agent, seance } = await athlete("heic@example.com");
    const res = await agent
      .post(`/api/sessions/${seance.id}/capture`)
      .attach("captures", Buffer.from("x"), { filename: "photo.heic", contentType: "image/heic" });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("HEIC");
    expect(askClaude).not.toHaveBeenCalled();
  });

  it("ne touche pas aux séances d'un autre athlète", async () => {
    const { seance } = await athlete("proprio@example.com");
    const { agent: intrus } = await athlete("intrus@example.com");
    expect((await intrus.post(`/api/sessions/${seance.id}/capture/valider`).send({ dureeMin: 30 })).status).toBe(404);
    expect((await intrus.post(`/api/sessions/${seance.id}/capture`).attach("captures", PNG, "a.png")).status).toBe(404);
  });
});
