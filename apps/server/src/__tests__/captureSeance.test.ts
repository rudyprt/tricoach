import { describe, expect, it } from "vitest";
import { interpreterLecture } from "../lib/captureSeance.js";

/** Ce que le modèle lit est converti et vérifié avant d'être proposé. */

const brute = (r: Record<string, unknown>) => ({
  lisible: true,
  sport: null,
  duree: null,
  distanceKm: null,
  allure: null,
  fcMoyenne: null,
  fcMax: null,
  puissanceMoy: null,
  denivelePosM: null,
  remarque: null,
  ...r,
});

describe("lecture d'une capture", () => {
  it("convertit durée et allure affichées", () => {
    const l = interpreterLecture(brute({ sport: "course", duree: "1:02:30", distanceKm: 12.5, allure: "5:00 /km", fcMoyenne: 151 }));
    expect(l.mesures).toMatchObject({ dureeMin: 63, distanceKm: 12.5, allureSecParKm: 300, fcMoyenne: 151 });
  });

  it("déduit l'allure d'une course quand l'écran ne la donne pas", () => {
    expect(interpreterLecture(brute({ sport: "course", duree: "45:00", distanceKm: 9 })).mesures.allureSecParKm).toBe(300);
  });

  it("n'invente pas d'allure au kilomètre pour une natation", () => {
    expect(interpreterLecture(brute({ sport: "natation", duree: "40:00", distanceKm: 2, allure: "2:00/100m" })).mesures.allureSecParKm).toBeNull();
  });

  it("écarte les valeurs impossibles", () => {
    const l = interpreterLecture(brute({ duree: "abc", fcMoyenne: 400, puissanceMoy: -5, distanceKm: 5000 }));
    expect(l.mesures).toMatchObject({ dureeMin: undefined, fcMoyenne: null, puissanceMoy: null, distanceKm: null });
  });
});
