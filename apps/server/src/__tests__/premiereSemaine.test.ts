import { describe, expect, it } from "vitest";
import { fenetrePremiereSemaine } from "../routes/plans.js";

/**
 * La toute première semaine d'un nouveau compte.
 *
 * Elle était produite du lundi au dimanche, quel que soit le jour de
 * l'inscription : un athlète inscrit un vendredi recevait quatre jours déjà
 * passés, et dépensait deux de ses quatorze jours d'essai sur une semaine à
 * moitié périmée.
 */
const LUNDI = new Date("2026-03-02T00:00:00.000Z"); // lundi 2 mars 2026

describe("fenêtre de la première semaine", () => {
  it("donne la semaine entière à qui s'inscrit le lundi", () => {
    const { debut, dates } = fenetrePremiereSemaine(LUNDI, "2026-03-02");
    expect(debut.toISOString().slice(0, 10)).toBe("2026-03-02");
    expect(dates).toHaveLength(7);
    expect(dates[0]).toBe("2026-03-02");
  });

  it("ne donne que les jours restants à qui s'inscrit le vendredi", () => {
    const { debut, dates } = fenetrePremiereSemaine(LUNDI, "2026-03-06");
    // La semaine reste celle du lundi : c'est elle qui porte le programme.
    expect(debut.toISOString().slice(0, 10)).toBe("2026-03-02");
    expect(dates).toEqual(["2026-03-06", "2026-03-07", "2026-03-08"]);
  });

  it("garde deux jours quand il n'en reste que deux", () => {
    expect(fenetrePremiereSemaine(LUNDI, "2026-03-07").dates).toEqual(["2026-03-07", "2026-03-08"]);
  });

  it("passe à la semaine suivante quand il ne reste que le dimanche", () => {
    // Une « semaine » d'un seul jour ne montre rien du produit.
    const { debut, dates } = fenetrePremiereSemaine(LUNDI, "2026-03-08");
    expect(debut.toISOString().slice(0, 10)).toBe("2026-03-09");
    expect(dates).toHaveLength(7);
    expect(dates[0]).toBe("2026-03-09");
  });

  it("ne produit jamais de date déjà passée", () => {
    for (const jour of ["2026-03-02", "2026-03-04", "2026-03-06", "2026-03-07", "2026-03-08"]) {
      for (const date of fenetrePremiereSemaine(LUNDI, jour).dates) {
        expect(date >= jour).toBe(true);
      }
    }
  });
});
