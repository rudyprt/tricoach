import { describe, expect, it } from "vitest";
import {
  allureVersSecondes,
  formatDuree,
  formatJourCourt,
  formatJourLong,
  parseChrono,
  secondesVersAllure,
  totalCreneauxMin,
} from "../formats";
import type { Disponibilites } from "../api";

describe("allures", () => {
  it("convertit une allure écrite en secondes", () => {
    expect(allureVersSecondes("4:10")).toBe(250);
    expect(allureVersSecondes("4:10/km")).toBe(250);
    expect(allureVersSecondes("1:45/100m")).toBe(105);
    expect(allureVersSecondes(" 5:00 ")).toBe(300);
  });

  it("refuse une saisie qui n'est pas une allure", () => {
    expect(allureVersSecondes("")).toBeNull();
    expect(allureVersSecondes("quatre dix")).toBeNull();
    expect(allureVersSecondes("410")).toBeNull();
    // Sans garde, « 4:75 » serait enregistré comme 5:15 sans que l'athlète
    // comprenne d'où sort la valeur.
    expect(allureVersSecondes("4:75")).toBeNull();
  });

  it("fait l'aller-retour sans perdre la valeur", () => {
    for (const allure of ["3:05", "4:10", "12:00"]) {
      expect(secondesVersAllure(allureVersSecondes(allure)!)).toBe(allure);
    }
  });

  it("garde deux chiffres aux secondes", () => {
    expect(secondesVersAllure(245)).toBe("4:05");
    expect(secondesVersAllure(240)).toBe("4:00");
  });
});

describe("chronos de test", () => {
  it("accepte les deux façons dont un athlète lit sa montre", () => {
    expect(parseChrono("7:42")).toBe(462);
    expect(parseChrono("7,42")).toBe(462);
    expect(parseChrono("462")).toBe(462);
  });

  it("refuse une saisie impossible plutôt que d'inventer un temps", () => {
    expect(parseChrono("")).toBeNull();
    expect(parseChrono("abc")).toBeNull();
    expect(parseChrono("7:99")).toBeNull();
    expect(parseChrono("-5")).toBeNull();
    expect(parseChrono("1:2:3")).toBeNull();
  });
});

describe("dates", () => {
  it("ne recule pas d'un jour", () => {
    // Une date construite à minuit UTC bascule la veille dans les fuseaux
    // négatifs : l'athlète verrait la veille de sa séance.
    // Une majuscule au premier mot seulement : « Samedi 19 Septembre »
    // trahissait un `capitalize` CSS appliqué à chaque mot.
    expect(formatJourLong("2026-03-07")).toBe("Samedi 7 mars");
    expect(formatJourCourt("2026-03-07")).toBe("7 mars 2026");
  });
});

describe("créneaux", () => {
  const semaine: Disponibilites = {
    lundi: { disponible: false, dureeMaxMin: 60 },
    mardi: { disponible: true, dureeMaxMin: 60 },
    mercredi: { disponible: true, dureeMaxMin: 75 },
    jeudi: { disponible: true },
    samedi: { disponible: true, dureeMaxMin: 180 },
  };

  it("ne compte que les jours disponibles et renseignés", () => {
    // Lundi est indisponible malgré sa durée ; jeudi n'a pas de durée.
    expect(totalCreneauxMin(semaine)).toBe(315);
  });

  it("vaut zéro sans créneau", () => {
    expect(totalCreneauxMin({})).toBe(0);
  });

  it("met en forme un volume, pas une allure", () => {
    expect(formatDuree(315)).toBe("5 h 15 min");
    expect(formatDuree(120)).toBe("2 h");
    expect(formatDuree(45)).toBe("45 min");
  });
});
