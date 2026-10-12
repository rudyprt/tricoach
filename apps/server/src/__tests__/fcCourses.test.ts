import { describe, expect, it } from "vitest";
import { facteurSeuil, fcCourseTexte, fcMaxDesCourses, seuilDepuisCourse, seuilsDepuisCourses } from "../lib/fcCourses.js";
import { computeTrainingZones } from "../lib/training.js";

/**
 * La FC d'une course de référence, saisie avec son chrono : faute de test,
 * elle donne le seuil de l'athlète bien mieux que 92 % de sa FC max.
 */

describe("seuil déduit d'une course", () => {
  it("suit la durée de l'effort : au-dessus du seuil sur 5 km, en dessous sur semi", () => {
    expect(facteurSeuil(20 * 60 - 1)).toBe(0.96);
    expect(facteurSeuil(45 * 60)).toBe(1);
    expect(facteurSeuil(100 * 60)).toBe(1.04);
    // Trop court ou trop long : la moyenne ne dit rien du seuil.
    expect(facteurSeuil(5 * 60)).toBeNull();
    expect(facteurSeuil(10 * 3600)).toBeNull();
  });

  it("prend la moyenne d'un 10 km en 45 min comme seuil", () => {
    expect(seuilDepuisCourse("10km en 45min", 172, 186)).toBe(172);
  });

  it("relève la moyenne d'un semi-marathon, plus lent que le seuil", () => {
    expect(seuilDepuisCourse("21km en 1h45", 165, null)).toBe(172);
  });

  it("reste sous la FC max relevée sur la même course", () => {
    expect(seuilDepuisCourse("21km en 1h45", 170, 176)).toBe(173);
  });

  it("ne devine rien sans chrono lisible ni moyenne", () => {
    expect(seuilDepuisCourse("", 170, 185)).toBeNull();
    expect(seuilDepuisCourse("10km en 45min", null, 185)).toBeNull();
  });

  it("estime chaque discipline séparément", () => {
    const seuils = seuilsDepuisCourses({
      tempsCourse: "10km en 45min",
      tempsVelo: "40km en 1h05",
      tempsNatation: "1500m en 28min",
      fcMoyCourse: 172,
      fcMoyVelo: 160,
      fcMoyNatation: null,
    });
    expect(seuils).toEqual({ course: 172, velo: 160, natation: null });
  });

  it("retient la plus haute FC max relevée", () => {
    expect(fcMaxDesCourses({ tempsCourse: "", tempsVelo: "", tempsNatation: "", fcMaxCourse: 188, fcMaxVelo: 181 })).toBe(188);
    expect(fcMaxDesCourses({ tempsCourse: "", tempsVelo: "", tempsNatation: "" })).toBeNull();
  });

  it("se lit en clair pour le coach", () => {
    expect(fcCourseTexte(172, 186)).toBe(" (FC moy 172, max 186)");
    expect(fcCourseTexte(null, 186)).toBe(" (FC max 186)");
    expect(fcCourseTexte(null, null)).toBe("");
  });
});

describe("zones cardiaques", () => {
  const base = { tempsCourse: "10km en 45min", tempsNatation: "", tempsVelo: "", ftpWatts: null, overrides: {} };

  it("partent du seuil de course plutôt que de 92 % de la FC max", () => {
    const zones = computeTrainingZones({ ...base, fcMax: 190, fcSeuilsCourses: { course: 172 } });
    expect(zones.notes.join(" ")).toContain("estimée à 172 bpm d'après la FC moyenne de votre course de référence");
    expect(zones.notes.join(" ")).not.toContain("92 %");
  });

  it("cèdent à une FC au seuil testée", () => {
    const zones = computeTrainingZones({ ...base, fcSeuil: 168, fcMax: 190, fcSeuilsCourses: { course: 172 } });
    expect(zones.notes.join(" ")).toContain("FC au seuil de 168 bpm");
  });

  it("donnent au vélo son propre seuil quand sa course est renseignée", () => {
    const zones = computeTrainingZones({ ...base, fcMax: 190, fcSeuilsCourses: { course: 172, velo: 158 } });
    expect(zones.notes.join(" ")).toContain("à vélo : estimée à 158 bpm d'après la FC moyenne");
  });
});
