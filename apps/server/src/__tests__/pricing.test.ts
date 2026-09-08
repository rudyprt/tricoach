import { describe, expect, it } from "vitest";
import { costMicroUsd, formatUsd, pricingFor } from "../lib/pricing.js";

const noCache = { cacheReadTokens: 0, cacheWriteTokens: 0 };

describe("tarification", () => {
  it("applique les tarifs de claude-sonnet-5", () => {
    const p = pricingFor("claude-sonnet-5");
    expect(p.inputPerMTok).toBe(2);
    expect(p.outputPerMTok).toBe(10);
  });

  it("calcule le coût d'un appel typique de chat", () => {
    // 1 M de tokens d'entrée à 2 $ + 1 M de sortie à 10 $ = 12 $
    const cost = costMicroUsd("claude-sonnet-5", {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      ...noCache,
    });
    expect(cost).toBe(12_000_000);
    expect(formatUsd(cost)).toBe("12.00 $");
  });

  it("valorise les lectures de cache dix fois moins que l'entrée", () => {
    const plein = costMicroUsd("claude-sonnet-5", { inputTokens: 100_000, outputTokens: 0, ...noCache });
    const cache = costMicroUsd("claude-sonnet-5", {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 100_000,
      cacheWriteTokens: 0,
    });
    expect(cache * 10).toBe(plein);
  });

  it("distingue les tarifs entre modèles", () => {
    const usage = { inputTokens: 1_000_000, outputTokens: 0, ...noCache };
    expect(costMicroUsd("claude-opus-5", usage)).toBe(5_000_000);
    expect(costMicroUsd("claude-sonnet-5", usage)).toBe(2_000_000);
    expect(costMicroUsd("claude-haiku-4-5", usage)).toBe(1_000_000);
  });

  it("retombe sur un tarif connu pour un modèle inconnu, sans planter", () => {
    const usage = { inputTokens: 1_000_000, outputTokens: 0, ...noCache };
    expect(costMicroUsd("modele-inexistant", usage)).toBe(2_000_000);
  });

  it("renvoie un entier, sans accumulation d'erreurs d'arrondi", () => {
    const cost = costMicroUsd("claude-sonnet-5", { inputTokens: 1337, outputTokens: 42, ...noCache });
    expect(Number.isInteger(cost)).toBe(true);
    expect(cost).toBe(3094);
  });
});
