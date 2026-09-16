import { describe, expect, it } from "vitest";
import { corrigerCibles, uniteIncoherente, zoneCitee } from "../lib/cibles.js";
import type { TrainingZones } from "../lib/training.js";

const ZONES: TrainingZones = {
  course: [
    { zone: "Z1", label: "récupération", value: "5:45/km" },
    { zone: "Z2", label: "endurance fondamentale", value: "5:10/km" },
    { zone: "Z4", label: "seuil", value: "4:08/km" },
  ],
  natation: [
    { zone: "Z1", label: "récupération", value: "2:02/100m" },
    { zone: "Z2", label: "endurance", value: "1:56/100m" },
    { zone: "Z4", label: "seuil", value: "1:44/100m" },
  ],
  velo: [
    { zone: "Z2", label: "endurance", value: "150-186 W" },
    { zone: "Z4", label: "seuil", value: "226-260 W" },
  ],
  frequenceCardiaque: null,
  notes: [],
};

const seance = (sport: string, cible: string, allure?: string) => ({
  sport,
  structure: {
    echauffement: { cible: "Z1 récupération — valeur", description: "" },
    corps: {
      cible,
      description: "",
      exercices: allure ? [{ repetitions: "8 × 200 m", allure, recuperation: "20 s" }] : [],
    },
    retourCalme: { cible: "Z1 récupération — valeur", description: "" },
  },
});

describe("détection d'unité", () => {
  it("repère une allure au kilomètre sur une séance de natation", () => {
    expect(uniteIncoherente("natation", "Z4 seuil — 4:08/km")).toBe(true);
    expect(uniteIncoherente("natation", "Z4 seuil — 1:44/100m")).toBe(false);
  });

  it("repère des watts sur une séance de course", () => {
    expect(uniteIncoherente("course", "Z4 seuil — 240 W")).toBe(true);
    expect(uniteIncoherente("course", "Z4 seuil — 4:08/km")).toBe(false);
  });

  it("repère une allure à pied sur le vélo", () => {
    expect(uniteIncoherente("velo", "Z4 seuil — 4:08/km")).toBe(true);
    expect(uniteIncoherente("velo", "Z4 seuil — 226-260 W")).toBe(false);
  });

  it("accepte une cible qui porte la bonne unité, même si elle en cite une autre", () => {
    // Un repère complémentaire ne doit pas déclencher de correction.
    expect(uniteIncoherente("natation", "Z4 seuil — 1:44/100m (soit 17:20 au 1000 m)")).toBe(false);
  });

  it("ne juge pas les disciplines sans unité chiffrée", () => {
    expect(uniteIncoherente("renfo", "Z2 — gainage")).toBe(false);
    expect(uniteIncoherente("repos", "")).toBe(false);
  });

  it("retrouve la zone citée, quelle que soit son écriture", () => {
    expect(zoneCitee("Z4 seuil — 4:08/km")).toBe("Z4");
    expect(zoneCitee("Zone 2 endurance")).toBe("Z2");
    expect(zoneCitee("allure modérée")).toBeNull();
  });
});

describe("correction des cibles", () => {
  it("remplace une allure de course par l'allure de natation de la même zone", () => {
    const { seances, corrections } = corrigerCibles([seance("natation", "Z4 seuil — 4:08/km")], ZONES);

    expect(seances[0].structure!.corps!.cible).toBe("Z4 seuil — 1:44/100m");
    expect(corrections).toHaveLength(1);
    expect(corrections[0]).toMatchObject({ sport: "natation", avant: "Z4 seuil — 4:08/km" });
  });

  it("corrige aussi l'allure de chaque exercice", () => {
    const { seances } = corrigerCibles([seance("natation", "Z4 seuil — 1:44/100m", "4:08/km (Z4)")], ZONES);

    expect(seances[0].structure!.corps!.exercices![0].allure).toBe("Z4 seuil — 1:44/100m");
  });

  it("ne touche pas à une cible correcte", () => {
    const originale = seance("natation", "Z4 seuil — 1:44/100m");
    const { seances, corrections } = corrigerCibles([originale], ZONES);

    expect(corrections).toHaveLength(0);
    expect(seances[0]).toBe(originale);
  });

  it("laisse la cible en place si la zone n'est pas identifiable", () => {
    // Sans zone citée, le serveur ne sait pas par quoi remplacer : mieux vaut
    // une cible douteuse qu'une valeur inventée.
    const { seances, corrections } = corrigerCibles([seance("natation", "allure vive — 4:08/km")], ZONES);

    expect(corrections).toHaveLength(0);
    expect(seances[0].structure!.corps!.cible).toBe("allure vive — 4:08/km");
  });

  it("laisse la cible en place si la discipline n'a pas de zones", () => {
    const sansVelo = { ...ZONES, velo: null };
    const { corrections } = corrigerCibles([seance("velo", "Z4 seuil — 4:08/km")], sansVelo);

    expect(corrections).toHaveLength(0);
  });

  it("ne modifie pas une séance sans structure", () => {
    const repos = { sport: "repos", structure: null };
    const { seances, corrections } = corrigerCibles([repos], ZONES);

    expect(seances[0]).toBe(repos);
    expect(corrections).toHaveLength(0);
  });

  it("corrige plusieurs blocs et plusieurs séances en une passe", () => {
    const programme = [
      seance("natation", "Z4 seuil — 4:08/km"),
      seance("course", "Z2 endurance fondamentale — 240 W"),
      seance("velo", "Z4 seuil — 4:08/km"),
    ];
    const { seances, corrections } = corrigerCibles(programme, ZONES);

    expect(corrections).toHaveLength(3);
    expect(seances[0].structure!.corps!.cible).toContain("/100m");
    expect(seances[1].structure!.corps!.cible).toContain("/km");
    expect(seances[2].structure!.corps!.cible).toContain("W");
  });
});
