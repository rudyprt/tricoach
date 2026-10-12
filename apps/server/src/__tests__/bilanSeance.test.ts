import { describe, expect, it } from "vitest";
import { bilanSeance } from "../lib/bilanSeance.js";
import { computeTrainingZones } from "../lib/training.js";
import type { SessionStructure } from "../lib/session.js";

/**
 * Le bilan d'une séance importée compare ce qui a été fait à ce qui était
 * prévu, sans appel au modèle. Il ne propose de réajuster la semaine que
 * lorsque l'écart le justifie.
 */

const zones = computeTrainingZones({ seuilCourseSecParKm: 252, ftpWatts: 240, fcSeuil: 168, fcMax: 189 });

const endurance: SessionStructure = {
  echauffement: { dureeMin: 10, cible: "Z1 récupération", description: "" },
  corps: { dureeMin: 45, cible: "Z2 endurance fondamentale", description: "" },
  retourCalme: { dureeMin: 5, cible: "Z1 récupération", description: "" },
};
const footing = { sport: "course", dureeMin: 60, structure: endurance };
const activite = (surcharge: Partial<{ dureeMin: number; fcMoyenne: number | null; allureSecParKm: number | null; puissanceMoy: number | null }> = {}) => ({
  dureeMin: 60,
  fcMoyenne: 140,
  allureSecParKm: 330,
  puissanceMoy: null,
  ...surcharge,
});

describe("bilan de séance", () => {
  it("dit qu'une séance faite comme prévu est conforme, sans proposer de réajuster", () => {
    const bilan = bilanSeance(footing, activite(), zones);
    expect(bilan.niveau).toBe("conforme");
    expect(bilan.proposerReajustement).toBe(false);
    expect(bilan.constats.map((c) => c.texte).join(" ")).toMatch(/FC moyenne 140 bpm, dans la cible/);
  });

  it("alerte quand le cœur est nettement au-dessus de la cible, et propose de réajuster", () => {
    const bilan = bilanSeance(footing, activite({ fcMoyenne: 168, allureSecParKm: 270 }), zones);
    expect(bilan.niveau).toBe("alerte");
    expect(bilan.proposerReajustement).toBe(true);
    expect(bilan.constats.some((c) => /nettement au-dessus/.test(c.texte))).toBe(true);
    expect(bilan.constats.some((c) => /plus rapide que prévu/.test(c.texte))).toBe(true);
  });

  it("alerte sur une séance écourtée de plus d'un tiers", () => {
    const bilan = bilanSeance(footing, activite({ dureeMin: 30 }), zones);
    expect(bilan.constats[0]).toMatchObject({ niveau: "alerte", texte: "Séance écourtée : 30 min sur 60 prévues." });
    expect(bilan.proposerReajustement).toBe(true);
  });

  it("ne juge pas un fractionné sur ses moyennes", () => {
    const fractionne: SessionStructure = {
      ...endurance,
      corps: { dureeMin: 30, cible: "Z4 seuil", description: "", exercices: [{ repetitions: "6 x 1000m", allure: "Z4 seuil", recuperation: "90s trot" }] },
    };
    const bilan = bilanSeance({ sport: "course", dureeMin: 45, structure: fractionne }, activite({ dureeMin: 45, fcMoyenne: 150 }), zones);
    expect(bilan.niveau).toBe("conforme");
    expect(bilan.constats.some((c) => /fractionnée/.test(c.texte))).toBe(true);
  });

  it("compare la puissance au vélo", () => {
    const bilan = bilanSeance({ sport: "velo", dureeMin: 60, structure: endurance }, activite({ fcMoyenne: null, puissanceMoy: 260, allureSecParKm: null }), zones);
    expect(bilan.constats.some((c) => /Puissance moyenne 260 W, au-dessus/.test(c.texte))).toBe(true);
  });
});
