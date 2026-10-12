import { describe, expect, it } from "vitest";
import {
  calculerRavitaillement,
  cibleCourseGH,
  intensiteSeance,
  reperesCourse,
  sudationRetenue,
  tauxSudation,
  toleranceDigestive,
} from "../lib/nutrition.js";
import type { SessionStructure } from "../lib/session.js";

/**
 * Le ravitaillement suit la durée et l'intensité de la séance, puis ce que
 * l'on sait de l'athlète : sa sudation, ce que son estomac tolère, la course
 * qu'il prépare.
 */

const bloc = (dureeMin: number, cible: string) => ({ dureeMin, cible, description: "" });
const structure = (corps: string, dureeCorps: number): SessionStructure => ({
  echauffement: bloc(15, "Z1 endurance"),
  corps: bloc(dureeCorps, corps),
  retourCalme: bloc(10, "Z1"),
});

const sortie = (sport: string, dureeMin: number, corps = "Z2 endurance") => ({
  sport,
  titre: "Sortie",
  dureeMin,
  structure: structure(corps, dureeMin - 25),
});

describe("intensité d'une séance", () => {
  it("se lit dans les zones des blocs", () => {
    expect(intensiteSeance(sortie("course", 60, "Z4 seuil")).max).toBe(4);
    expect(intensiteSeance(sortie("velo", 180)).moyenne).toBeLessThan(2.5);
  });

  it("se devine au titre faute de structure", () => {
    expect(intensiteSeance({ sport: "course", titre: "Fractionné VMA", dureeMin: 50 }).max).toBe(4);
  });
});

describe("ravitaillement pendant la séance", () => {
  it("rien sous trois quarts d'heure", () => {
    const r = calculerRavitaillement(sortie("course", 40));
    expect(r?.pendant).toBeNull();
  });

  it("monte avec la durée", () => {
    const g = (dureeMin: number) => calculerRavitaillement(sortie("velo", dureeMin))!.pendant!.glucidesGH;
    expect(g(90)).toBeGreaterThan(0);
    expect(g(150)).toBeGreaterThan(g(90));
    expect(g(240)).toBeGreaterThanOrEqual(75);
  });

  it("reste plus prudent en course à pied qu'à vélo", () => {
    const course = calculerRavitaillement(sortie("course", 200))!.pendant!;
    expect(course.fourchetteGH[1]).toBeLessThanOrEqual(70);
  });

  it("cale la boisson sur la sudation mesurée, sans tout compenser", () => {
    const r = calculerRavitaillement(sortie("velo", 120), { sudation: { velo: 1200 } })!;
    expect(r.pendant!.boissonMlH).toBe(850);
    expect(r.sources[0]).toContain("1200 ml/h");
  });

  it("ajoute du sodium sur les séances longues, davantage si la sueur est salée", () => {
    const normal = calculerRavitaillement(sortie("velo", 150))!.pendant!.sodiumMgH;
    const sale = calculerRavitaillement(sortie("velo", 150), { sueurSalee: true })!.pendant!.sodiumMgH;
    expect(normal).toBeGreaterThan(0);
    expect(sale).toBeGreaterThan(normal);
  });

  it("propose les doses dans les formats de l'athlète", () => {
    const r = calculerRavitaillement(sortie("velo", 180), { formats: ["boisson", "barre"] })!;
    expect(r.pendant!.exemple).toMatch(/boisson d'effort à 6 %.*barre/);
    const course = calculerRavitaillement(sortie("course", 120), { formats: ["gel", "barre"] })!;
    expect(course.pendant!.exemple).toContain("gel");
  });

  it("ne dépasse pas ce que l'estomac a toléré, ni la dose qui a posé problème", () => {
    expect(calculerRavitaillement(sortie("velo", 240), { toleranceGH: 50 })!.pendant!.glucidesGH).toBe(60);
    expect(calculerRavitaillement(sortie("velo", 240), { limiteGH: 70 })!.pendant!.glucidesGH).toBeLessThanOrEqual(60);
  });
});

describe("entraînement digestif", () => {
  const ironman = { nom: "Ironman de Nice", semainesRestantes: 10, cibleCourseGH: 90 };

  it("augmente la dose par paliers vers celle du jour J", () => {
    const r = calculerRavitaillement(sortie("velo", 180), { toleranceGH: 70 }, { objectifDigestif: ironman })!;
    expect(r.pendant!.glucidesGH).toBe(80);
    expect(r.entrainementDigestif).toContain("Ironman de Nice");
  });

  it("ne concerne que les sorties longues", () => {
    expect(calculerRavitaillement(sortie("course", 50), {}, { objectifDigestif: ironman })!.entrainementDigestif).toBeNull();
  });

  it("vise la dose de course selon l'épreuve", () => {
    expect(cibleCourseGH({ format: "ironman" })).toBe(90);
    expect(cibleCourseGH({ format: "sprint" })).toBeNull();
    expect(cibleCourseGH({ format: "autre", discipline: "velo", distanceKm: 160 })).toBe(80);
  });
});

describe("avant et après", () => {
  it("dose au poids quand il est connu", () => {
    const r = calculerRavitaillement(sortie("velo", 150, "Z4 seuil"), { poidsKg: 70, cafeine: true })!;
    expect(r.avant.join(" ")).toContain("70 à 140 g");
    expect(r.avant.join(" ")).toContain("210 mg");
    expect(r.apres.join(" ")).toContain("21 g");
  });

  it("insiste sur la récupération quand une séance suit le lendemain", () => {
    const r = calculerRavitaillement(sortie("course", 60), {}, { seanceLeLendemain: true })!;
    expect(r.apres.join(" ")).toContain("demain");
  });

  it("ne dit rien pour un jour de repos", () => {
    expect(calculerRavitaillement({ sport: "repos", titre: "Repos", dureeMin: 0 })).toBeNull();
  });
});

describe("mesures de l'athlète", () => {
  it("calcule la sudation d'un test de pesée", () => {
    expect(tauxSudation({ poidsAvantKg: 70, poidsApresKg: 69.2, boissonMl: 500, dureeMin: 90 })).toBe(867);
    expect(sudationRetenue([{ sport: "velo", tauxMlH: 900 }, { sport: "velo", tauxMlH: 1000 }, { sport: "course", tauxMlH: 1300 }], "velo")).toBe(950);
  });

  it("tire du journal la dose tolérée et la limite", () => {
    expect(
      toleranceDigestive([
        { glucidesG: 120, dureeMin: 120, tolerance: "bien" },
        { glucidesG: 210, dureeMin: 180, tolerance: "bien" },
        { glucidesG: 270, dureeMin: 180, tolerance: "troubles" },
        // Des troubles sous une dose déjà tolérée ne fixent pas de limite.
        { glucidesG: 60, dureeMin: 120, tolerance: "troubles" },
      ])
    ).toEqual({ toleranceGH: 70, limiteGH: 90 });
  });

  it("donne au plan de course les doses tolérées à l'entraînement", () => {
    const r = reperesCourse({ toleranceGH: 70, sudation: { velo: 1000 } }, { format: "ironman" });
    expect(r.velo).toEqual({ glucidesGH: 70, boissonMlH: 700, sodiumMgH: 400 });
    expect(r.teste).toBe(true);
  });
});
