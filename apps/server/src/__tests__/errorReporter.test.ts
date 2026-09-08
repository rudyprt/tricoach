import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Sans remontée, une panne ne se découvre que lorsqu'un athlète écrit pour se
 * plaindre. Ce module doit donc fonctionner, et surtout ne jamais faire
 * échouer la requête qu'il observe.
 */
describe("remontée d'erreurs", () => {
  const baseEnv = { ...process.env };
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/db";
    process.env.JWT_SECRET = "x".repeat(32);
    fetchMock = vi.fn(() => Promise.resolve(new Response("ok")));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = { ...baseEnv };
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("journalise en JSON structuré, exploitable par un agrégateur", async () => {
    process.env.ERROR_WEBHOOK_URL = "";
    const { reportError } = await import("../lib/errorReporter.js");
    const erreur = vi.mocked(console.error);

    reportError(new Error("base indisponible"), { method: "POST", path: "/api/plans/generate" });

    const ligne = JSON.parse(erreur.mock.calls[0][0] as string);
    expect(ligne).toMatchObject({
      niveau: "erreur",
      message: "base indisponible",
      method: "POST",
      path: "/api/plans/generate",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("pousse vers le récepteur configuré", async () => {
    process.env.ERROR_WEBHOOK_URL = "https://hooks.example.com/abc";
    const { reportError } = await import("../lib/errorReporter.js");

    reportError(new Error("panne"), { method: "GET", path: "/api/sessions", statusCode: 500 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://hooks.example.com/abc");
    expect(JSON.parse(init.body as string)).toMatchObject({ message: "panne", path: "/api/sessions" });
  });

  it("dédoublonne une erreur qui se répète en boucle", async () => {
    process.env.ERROR_WEBHOOK_URL = "https://hooks.example.com/abc";
    const { reportError } = await import("../lib/errorReporter.js");

    for (let i = 0; i < 20; i++) {
      reportError(new Error("même panne"), { method: "GET", path: "/api/sessions" });
    }
    // Une panne en boucle ne doit pas inonder le récepteur.
    expect(fetchMock).toHaveBeenCalledTimes(1);

    reportError(new Error("autre panne"), { method: "GET", path: "/api/sessions" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("ne propage jamais une panne du récepteur", async () => {
    process.env.ERROR_WEBHOOK_URL = "https://hooks.example.com/abc";
    fetchMock.mockRejectedValue(new Error("récepteur injoignable"));
    const { reportError } = await import("../lib/errorReporter.js");

    expect(() => reportError(new Error("panne initiale"), { path: "/api/x" })).not.toThrow();
  });

  it("n'inclut pas l'identité de l'athlète dans la signature de déduplication", async () => {
    process.env.ERROR_WEBHOOK_URL = "https://hooks.example.com/abc";
    const { reportError } = await import("../lib/errorReporter.js");

    reportError(new Error("panne"), { method: "GET", path: "/api/x", userId: "athlete-1" });
    reportError(new Error("panne"), { method: "GET", path: "/api/x", userId: "athlete-2" });

    // C'est le défaut qu'on dédoublonne, pas la personne qui l'a rencontré.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // Et l'identifiant ne part pas vers le service externe.
    expect(fetchMock.mock.calls[0][1]).not.toHaveProperty("userId");
    expect(JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string).userId).toBeUndefined();
  });
});
