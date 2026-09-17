import { describe, expect, it } from "vitest";
import { etatDeReprise, joursInterrompus, semainesDeReprise, reprisePromptLines } from "../lib/pause.js";

/** Lundi 9 mars 2026. */
const LUNDI = new Date("2026-03-09T00:00:00.000Z");

describe("reprise après interruption", () => {
  it("ignore un arrêt de moins d'une semaine", () => {
    // Deux jours d'arrêt ne changent rien à la condition physique.
    expect(semainesDeReprise(2)).toBe(0);
    expect(semainesDeReprise(6)).toBe(0);
  });

  it("compte une semaine de reprise par semaine d'arrêt, plafonnée à quatre", () => {
    expect(semainesDeReprise(7)).toBe(1);
    expect(semainesDeReprise(10)).toBe(2);
    expect(semainesDeReprise(21)).toBe(3);
    // Au-delà d'un mois, ce n'est plus une reprise mais une nouvelle base.
    expect(semainesDeReprise(90)).toBe(4);
  });

  it("mesure la durée d'un arrêt terminé", () => {
    const pause = { debut: new Date("2026-02-01T00:00:00.000Z"), finReelle: new Date("2026-02-15T00:00:00.000Z") };
    expect(joursInterrompus(pause, LUNDI)).toBe(14);
  });

  it("fait remonter le volume par paliers, de la moitié jusqu'au complet", () => {
    // Trois semaines d'arrêt, reprise le lundi 9 mars : trois semaines de remise en route.
    const pause = {
      debut: new Date("2026-02-16T00:00:00.000Z"),
      finReelle: new Date("2026-03-09T00:00:00.000Z"),
      raison: "blessure",
    };

    const s1 = etatDeReprise(pause, LUNDI);
    const s2 = etatDeReprise(pause, new Date("2026-03-16T00:00:00.000Z"));
    const s3 = etatDeReprise(pause, new Date("2026-03-23T00:00:00.000Z"));

    expect(s1).toMatchObject({ semaine: 1, total: 3, facteurVolume: 0.5 });
    expect(s2).toMatchObject({ semaine: 2, total: 3, facteurVolume: 0.75 });
    expect(s3).toMatchObject({ semaine: 3, total: 3, facteurVolume: 1 });
  });

  it("n'applique plus rien une fois la reprise terminée", () => {
    const pause = {
      debut: new Date("2026-02-16T00:00:00.000Z"),
      finReelle: new Date("2026-03-09T00:00:00.000Z"),
      raison: "maladie",
    };
    expect(etatDeReprise(pause, new Date("2026-03-30T00:00:00.000Z"))).toBeNull();
  });

  it("n'applique rien tant que l'athlète n'a pas repris", () => {
    const pause = { debut: new Date("2026-02-16T00:00:00.000Z"), finReelle: null, raison: "blessure" };
    expect(etatDeReprise(pause, LUNDI)).toBeNull();
  });

  it("met en garde spécifiquement après une blessure", () => {
    const reprise = { semaine: 1, total: 3, facteurVolume: 0.5, joursArret: 21, raison: "blessure" };
    const lignes = reprisePromptLines(reprise, "genou droit").join("\n");

    expect(lignes).toContain("BLESSURE");
    expect(lignes).toContain("genou droit");
    expect(lignes).toContain("21 jour(s)");

    const maladie = reprisePromptLines({ ...reprise, raison: "maladie" }, "").join("\n");
    expect(maladie).not.toContain("BLESSURE");
  });
});
