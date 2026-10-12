import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Ce que chaque appel envoie réellement à l'API : le modèle, le plafond de
 * sortie, la partie du prompt mise en cache, et la ligne de journal qui permet
 * de vérifier ce que coûte chaque appel.
 */

const create = vi.fn();
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: (...args: unknown[]) => create(...args) };
  },
}));
vi.mock("../lib/env.js", () => ({ env: () => ({ ANTHROPIC_API_KEY: "cle-de-test" }) }));

const { askClaude, journalAppel } = await import("../lib/anthropic.js");
const { MODELE_CHAT, MODELE_PLAN } = await import("../lib/modeles.js");

function reponse(model: string) {
  return {
    model,
    stop_reason: "end_turn",
    content: [{ type: "text", text: "ok" }],
    usage: { input_tokens: 812, output_tokens: 95, cache_read_input_tokens: 1450, cache_creation_input_tokens: 0 },
  };
}

describe("appel au modèle", () => {
  beforeEach(() => create.mockReset());

  it("met les consignes en cache et laisse le contexte après", async () => {
    create.mockResolvedValue(reponse(MODELE_CHAT));
    await askClaude({
      modele: MODELE_CHAT,
      etiquette: "chat",
      system: "Consignes communes",
      contexte: "Profil de l'athlète",
      messages: [{ role: "user", content: "Bonjour" }],
      maxTokens: 600,
    });
    const params = create.mock.calls[0][0];
    expect(params.model).toBe("claude-haiku-5-5");
    expect(params.max_tokens).toBe(600);
    expect(params.system).toEqual([
      { type: "text", text: "Consignes communes", cache_control: { type: "ephemeral" } },
      { type: "text", text: "Profil de l'athlète" },
    ]);
    expect(params.thinking).toEqual({ type: "disabled" });
  });

  it("laisse sa réflexion au modèle des plans, qui ne peut pas la couper", async () => {
    create.mockResolvedValue(reponse(MODELE_PLAN));
    await askClaude({
      modele: MODELE_PLAN,
      etiquette: "plan_progression",
      system: "Consignes",
      messages: [{ role: "user", content: "Semaine" }],
      maxTokens: 16000,
    });
    const params = create.mock.calls[0][0];
    expect(params.model).toBe("claude-opus-5-5");
    expect(params).not.toHaveProperty("thinking");
    expect(params.system).toHaveLength(1);
  });

  it("journalise les tokens d'entrée, de sortie et de cache de chaque appel", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    create.mockResolvedValue(reponse(MODELE_CHAT));
    const r = await askClaude({
      modele: MODELE_CHAT,
      etiquette: "chat",
      system: "Consignes",
      messages: [{ role: "user", content: "Bonjour" }],
      maxTokens: 600,
    });
    expect(r.usage).toEqual({ inputTokens: 812, outputTokens: 95, cacheReadTokens: 1450, cacheWriteTokens: 0 });
    expect(info).toHaveBeenCalledWith(
      "[ia] chat modele=claude-haiku-5-5 entree=812 sortie=95 cache_lu=1450 cache_ecrit=0 cout=0.00014$"
    );
    info.mockRestore();
  });

  it("chiffre le coût au tarif du modèle", () => {
    const ligne = journalAppel("plan_progression", "claude-opus-5-5", {
      inputTokens: 3000,
      outputTokens: 5000,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    });
    // 3 000 × 4 $ + 5 000 × 20 $ par million.
    expect(ligne).toContain("cout=0.11200$");
  });
});
