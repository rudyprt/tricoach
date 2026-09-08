import { describe, expect, it } from "vitest";
import { hasStandardAccess, isPremium, isTrialActive, TRIAL_DAYS, trialEndsAt } from "../lib/subscription.js";

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 3600 * 1000);
}

describe("essai gratuit", () => {
  it("dure TRIAL_DAYS jours à partir de la création du compte", () => {
    const createdAt = new Date("2026-09-01T10:00:00Z");
    const end = trialEndsAt(createdAt);
    expect(Math.round((end.getTime() - createdAt.getTime()) / (24 * 3600 * 1000))).toBe(TRIAL_DAYS);
  });

  it("couvre deux semaines pleines, pour permettre un renouvellement", () => {
    // L'intérêt du produit tient à l'enchaînement d'une semaine sur l'autre :
    // l'essai doit laisser le temps de vivre ce cycle au moins une fois.
    expect(TRIAL_DAYS).toBeGreaterThanOrEqual(14);
    expect(hasStandardAccess({ plan: "free", createdAt: daysAgo(8) })).toBe(true);
    expect(hasStandardAccess({ plan: "free", createdAt: daysAgo(13) })).toBe(true);
  });

  it("est actif le jour même et expiré au-delà", () => {
    expect(isTrialActive(daysAgo(1))).toBe(true);
    expect(isTrialActive(daysAgo(TRIAL_DAYS + 1))).toBe(false);
  });
});

describe("hasStandardAccess", () => {
  it("laisse passer un compte gratuit pendant l'essai", () => {
    expect(hasStandardAccess({ plan: "free", createdAt: daysAgo(2) })).toBe(true);
  });

  it("bloque un compte gratuit après l'essai", () => {
    expect(hasStandardAccess({ plan: "free", createdAt: daysAgo(TRIAL_DAYS + 1) })).toBe(false);
  });

  it("laisse passer un abonné même après l'essai", () => {
    expect(hasStandardAccess({ plan: "standard", createdAt: daysAgo(400) })).toBe(true);
    expect(hasStandardAccess({ plan: "premium", createdAt: daysAgo(400) })).toBe(true);
  });
});

describe("isPremium", () => {
  it("ne considère premium que le plan premium", () => {
    expect(isPremium({ plan: "premium" })).toBe(true);
    expect(isPremium({ plan: "standard" })).toBe(false);
    expect(isPremium({ plan: "free" })).toBe(false);
  });
});
