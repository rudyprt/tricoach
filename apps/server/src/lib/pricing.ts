/**
 * Tarification de l'API Anthropic, en dollars par million de tokens.
 * Relevé le 2026-09-08 — à revérifier sur https://www.anthropic.com/pricing
 * avant de communiquer des chiffres à des tiers.
 */
export interface ModelPricing {
  inputPerMTok: number;
  outputPerMTok: number;
  /** Lecture de cache : environ 10 % du prix d'entrée. */
  cacheReadPerMTok: number;
  /** Écriture de cache : environ 125 % du prix d'entrée. */
  cacheWritePerMTok: number;
}

export const PRICING_UPDATED_AT = "2026-09-08";

const PRICING: Record<string, ModelPricing> = {
  "claude-opus-5": { inputPerMTok: 5, outputPerMTok: 25, cacheReadPerMTok: 0.5, cacheWritePerMTok: 6.25 },
  "claude-sonnet-5": { inputPerMTok: 2, outputPerMTok: 10, cacheReadPerMTok: 0.2, cacheWritePerMTok: 2.5 },
  "claude-haiku-4-5": { inputPerMTok: 1, outputPerMTok: 5, cacheReadPerMTok: 0.1, cacheWritePerMTok: 1.25 },
};

/** Modèle inconnu : on facture au tarif du modèle utilisé par l'application. */
const FALLBACK = PRICING["claude-sonnet-5"];

export function pricingFor(model: string): ModelPricing {
  return PRICING[model] ?? FALLBACK;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

/**
 * Coût en micro-dollars (1 USD = 1 000 000). Un entier évite d'accumuler des
 * erreurs d'arrondi flottant sur des milliers d'appels avant l'affichage.
 */
export function costMicroUsd(model: string, usage: TokenUsage): number {
  const p = pricingFor(model);
  const dollars =
    (usage.inputTokens * p.inputPerMTok +
      usage.outputTokens * p.outputPerMTok +
      usage.cacheReadTokens * p.cacheReadPerMTok +
      usage.cacheWriteTokens * p.cacheWritePerMTok) /
    1_000_000;
  return Math.round(dollars * 1_000_000);
}

export function formatUsd(microUsd: number): string {
  return `${(microUsd / 1_000_000).toFixed(2)} $`;
}
