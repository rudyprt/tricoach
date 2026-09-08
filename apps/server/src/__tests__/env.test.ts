import { describe, expect, it } from "vitest";
import { loadEnv } from "../lib/env.js";

const valid = {
  DATABASE_URL: "postgresql://user:pass@localhost:5432/db",
  JWT_SECRET: "x".repeat(32),
};

describe("loadEnv", () => {
  it("accepte une configuration minimale et applique les défauts", () => {
    const env = loadEnv(valid as NodeJS.ProcessEnv);
    expect(env.PORT).toBe(3001);
    expect(env.NODE_ENV).toBe("development");
    expect(env.BILLING_MODE).toBe("disabled");
    expect(env.ANTHROPIC_API_KEY).toBe("");
  });

  it("refuse un JWT_SECRET trop court plutôt que de démarrer", () => {
    expect(() => loadEnv({ ...valid, JWT_SECRET: "trop-court" } as NodeJS.ProcessEnv)).toThrow(/JWT_SECRET/);
  });

  it("refuse une DATABASE_URL absente", () => {
    expect(() => loadEnv({ JWT_SECRET: "x".repeat(32) } as NodeJS.ProcessEnv)).toThrow(/DATABASE_URL/);
  });

  it("nettoie les espaces autour de la clé API collée depuis un hébergeur", () => {
    const env = loadEnv({ ...valid, ANTHROPIC_API_KEY: "  sk-ant-test\n" } as NodeJS.ProcessEnv);
    expect(env.ANTHROPIC_API_KEY).toBe("sk-ant-test");
  });
});
