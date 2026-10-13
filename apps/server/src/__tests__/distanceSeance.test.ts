import { describe, expect, it } from "vitest";
import { harmoniserDistances, titreAjuste } from "../lib/distanceSeance.js";
import { computeTrainingZones } from "../lib/training.js";

/**
 * La distance totale d'une séance est la somme de ses blocs : ce qui est
 * annoncé et ce qui est prescrit ne peuvent plus diverger.
 */

const zones = computeTrainingZones({
  tempsCourse: "10km en 50min",
  tempsNatation: "1500m en 30min",
  tempsVelo: "",
  ftpWatts: 230,
  overrides: {},
});

interface Bloc {
  dureeMin: number;
  cible: string;
  description: string;
  exercices?: object[];
  distanceKm?: number;
}

const bloc = (dureeMin: number, cible: string, description = "", exercices?: object[]): Bloc => ({
  dureeMin,
  cible,
  description,
  ...(exercices ? { exercices } : {}),
});

describe("distance d'une séance", () => {
  it("additionne des blocs de natation écrits en mètres", () => {
    const [s] = harmoniserDistances(
      [
        {
          sport: "natation",
          dureeMin: 45,
          distanceKm: 2.5,
          structure: {
            echauffement: bloc(10, "Z1 — 2:15/100m", "400 m crawl souple"),
            corps: bloc(28, "Z3 — 1:55/100m", "Séries", [{ repetitions: "8 x 100m", allure: "1:55/100m", recuperation: "20s" }]),
            retourCalme: bloc(7, "Z1", "200 m dos"),
          },
        },
      ],
      zones
    );
    expect(s.distanceKm).toBe(1.4);
    expect(s.structure!.corps!.distanceKm).toBe(0.8);
    expect(s.structure!.echauffement!.distanceKm).toBe(0.4);
  });

  it("chiffre un footing à l'allure de sa zone", () => {
    const [s] = harmoniserDistances(
      [
        {
          sport: "course",
          dureeMin: 50,
          distanceKm: 8,
          structure: {
            echauffement: bloc(10, "Z1 — 6:00/km"),
            corps: bloc(35, "Z2 — 5:30/km"),
            retourCalme: bloc(5, "Z1 — 6:00/km"),
          },
        },
      ],
      zones
    );
    // 10 min à 6:00 + 35 min à 5:30 + 5 min à 6:00 ≈ 8,9 km.
    expect(s.distanceKm).toBe(8.9);
  });

  it("compte répétitions et récupérations d'un fractionné", () => {
    const [s] = harmoniserDistances(
      [
        {
          sport: "course",
          dureeMin: 55,
          distanceKm: 12,
          structure: {
            echauffement: bloc(15, "Z1 — 6:00/km"),
            corps: bloc(30, "Z4 — 4:30/km", "", [
              { repetitions: "6 x 800m", allure: "Z4 — 4:30/km", recuperation: "200 m trot" },
            ]),
            retourCalme: bloc(10, "Z1 — 6:00/km"),
          },
        },
      ],
      zones
    );
    // 2,5 + 6 x (0,8 + 0,2) + 1,67 ≈ 10,2 km.
    expect(s.distanceKm).toBe(10.2);
    expect(s.structure!.corps!.distanceKm).toBe(6);
  });

  it("chiffre des répétitions au temps à l'allure prescrite", () => {
    const [s] = harmoniserDistances(
      [
        {
          sport: "course",
          dureeMin: 45,
          distanceKm: null,
          structure: {
            echauffement: bloc(15, "Z1 — 6:00/km"),
            corps: bloc(20, "Z4", "", [{ repetitions: "5 x 3 min", allure: "4:00/km", recuperation: "1 min sur place" }]),
            retourCalme: bloc(10, "Z1 — 6:00/km"),
          },
        },
      ],
      zones
    );
    expect(s.structure!.corps!.distanceKm).toBe(3.8);
  });

  it("laisse la distance du coach quand un bloc ne se chiffre pas", () => {
    const seance = {
      sport: "velo",
      dureeMin: 90,
      distanceKm: 40,
      structure: {
        echauffement: bloc(15, "Z1 — 130 W"),
        corps: bloc(65, "Z3 — 190 W"),
        retourCalme: bloc(10, "Z1 — 130 W"),
      },
    };
    const zonesSansVitesse = { ...zones, veloVitesse: null };
    expect(harmoniserDistances([seance], zonesSansVitesse)[0]).toBe(seance);
  });

  it("écarte un résultat invraisemblable", () => {
    const seance = {
      sport: "course",
      dureeMin: 30,
      distanceKm: 6,
      structure: {
        echauffement: bloc(5, "Z1"),
        corps: bloc(20, "Z2", "", [{ repetitions: "20 x 1000m" }]),
        retourCalme: bloc(5, "Z1"),
      },
    };
    expect(harmoniserDistances([seance], zones)[0].distanceKm).toBe(6);
  });

  it("ne touche ni au renforcement ni à une séance sans plan", () => {
    const renfo = { sport: "renfo", dureeMin: 40, distanceKm: null, structure: null };
    expect(harmoniserDistances([renfo], zones)[0]).toBe(renfo);
  });
});

describe("titre de la séance", () => {
  it("suit la distance calculée, dans l'unité du coach", () => {
    expect(titreAjuste("Sortie longue 18 km", 15.5)).toBe("Sortie longue 15,5 km");
    expect(titreAjuste("Natation 2500 m", 1.4)).toBe("Natation 1400 m");
    expect(titreAjuste("Footing 10km", 8.9)).toBe("Footing 8,9km");
    expect(titreAjuste("Endurance 12.5 km", 11)).toBe("Endurance 11 km");
  });

  it("ne touche ni aux répétitions ni aux titres qui citent plusieurs distances", () => {
    expect(titreAjuste("Fractionné 6 x 800 m", 10.2)).toBe("Fractionné 6 x 800 m");
    expect(titreAjuste("Seuil 2 x (4 x 200 m)", 6)).toBe("Seuil 2 x (4 x 200 m)");
    expect(titreAjuste("Sortie 12 km dont 4 km au seuil", 10)).toBe("Sortie 12 km dont 4 km au seuil");
    expect(titreAjuste("Footing récupération", 6)).toBe("Footing récupération");
  });

  it("laisse un écart d'arrondi", () => {
    expect(titreAjuste("Footing 9 km", 8.9)).toBe("Footing 9 km");
  });

  it("est réécrit avec la distance de la séance", () => {
    const [s] = harmoniserDistances(
      [
        {
          sport: "natation",
          titre: "Technique 2500 m",
          dureeMin: 45,
          distanceKm: 2.5,
          structure: {
            echauffement: bloc(10, "Z1 — 2:15/100m", "400 m crawl souple"),
            corps: bloc(28, "Z3 — 1:55/100m", "Séries", [{ repetitions: "8 x 100m", allure: "1:55/100m" }]),
            retourCalme: bloc(7, "Z1", "200 m dos"),
          },
        },
      ],
      zones
    );
    expect(s.titre).toBe("Technique 1400 m");
  });
});
