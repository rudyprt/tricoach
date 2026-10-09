import { afterEach, describe, expect, it, vi } from "vitest";

/** Les valeurs collées depuis un téléphone arrivent souvent avec un retour à la ligne final. */
describe("configuration", () => {
  const avant = { ...process.env };

  afterEach(() => {
    process.env = { ...avant };
    vi.resetModules();
  });

  it("ignore les espaces et retours à la ligne autour des valeurs", async () => {
    process.env.NODE_ENV = "production\n";
    process.env.DATABASE_URL = " postgresql://u:p@h/db\n";
    process.env.GESTION_SECRET = "secret-de-gestion-suffisamment-long-pour-zod\n";
    const { env } = await import("../env.js");
    expect(env().NODE_ENV).toBe("production");
    expect(env().DATABASE_URL).toBe("postgresql://u:p@h/db");
  });
});
