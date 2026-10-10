import { describe, expect, it } from "vitest";
import { buildFirstWeekPrompt, type ProfileForPrompt } from "../routes/plans.js";
import { computeTrainingZones } from "../lib/training.js";
import { periodization } from "../lib/training.js";

/**
 * Terminer une course et viser un chrono ne s'entraînent pas pareil.
 *
 * Le premier demande de tenir la distance, le second du travail d'allure.
 * Sans cette distinction, le coach suppose un objectif de temps et prescrit à
 * un premier finisher des séances dont il n'a pas besoin.
 */
const PROFIL: ProfileForPrompt = {
  objectif: "Half Ironman de Nice",
  objectifDate: new Date("2027-06-01T00:00:00.000Z"),
  tempsNatation: "",
  tempsVelo: "",
  tempsCourse: "10km en 45min",
  heuresSemaine: 8,
  contraintes: "",
  ftpWatts: null,
  seuilCourseSecParKm: 270,
  cssSecPer100m: null,
  fcSeuil: null,
  fcMax: null,
  customZones: null,
  disponibilites: null,
  materiel: null,
};

const zones = computeTrainingZones({
  tempsCourse: "10km en 45min",
  tempsNatation: "",
  tempsVelo: "",
  ftpWatts: null,
  overrides: {},
});

const phase = periodization(new Date("2026-03-02T00:00:00.000Z"), PROFIL.objectifDate);

const prompt = (profil: Partial<ProfileForPrompt>) =>
  buildFirstWeekPrompt(
    { ...PROFIL, ...profil },
    ["2026-03-02", "2026-03-03"],
    phase,
    300,
    [],
    [],
    zones,
    []
  );

describe("intention sur l'objectif", () => {
  it("transmet le temps visé au coach", () => {
    const texte = prompt({ objectifTemps: "sub 5h" });
    expect(texte).toContain("Temps visé sur cette course : sub 5h");
    expect(texte).not.toContain("LA TERMINER");
  });

  it("dit au coach de ne pas parler de chrono quand l'athlète veut terminer", () => {
    const texte = prompt({ objectifFinir: true, objectifTemps: "" });
    expect(texte).toContain("LA TERMINER");
    expect(texte).toContain("endurance");
    expect(texte).not.toContain("Temps visé");
  });

  it("ne suppose aucun chrono quand rien n'est renseigné", () => {
    const texte = prompt({});
    expect(texte).toContain("Aucun temps visé renseigné");
    expect(texte).not.toContain("LA TERMINER");
  });

  it("fait primer la volonté de terminer sur un chrono resté en base", () => {
    // Ceinture et bretelles : le serveur vide déjà le champ à l'enregistrement.
    const texte = prompt({ objectifFinir: true, objectifTemps: "4h30" });
    expect(texte).toContain("LA TERMINER");
    expect(texte).not.toContain("4h30");
  });
});
