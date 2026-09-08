import { describe, expect, it } from "vitest";
import {
  computeTrainingZones,
  formatZonesForPrompt,
  formatPacePerKm,
  parsePerformance,
  periodization,
  riegelEquivalent,
  weeksToGoal,
} from "../lib/training.js";

describe("parsePerformance", () => {
  it("lit les formats saisis dans l'onboarding", () => {
    expect(parsePerformance("1500m en 28min")).toEqual({ distanceM: 1500, durationS: 1680 });
    expect(parsePerformance("40km en 1h15")).toEqual({ distanceM: 40000, durationS: 4500 });
    expect(parsePerformance("10km en 45:30")).toEqual({ distanceM: 10000, durationS: 2730 });
    expect(parsePerformance("21,1 km en 1h35")).toEqual({ distanceM: 21100, durationS: 5700 });
  });

  it("renvoie null quand la saisie n'est pas exploitable", () => {
    expect(parsePerformance("")).toBeNull();
    expect(parsePerformance(null)).toBeNull();
    expect(parsePerformance("je cours vite")).toBeNull();
    expect(parsePerformance("10km")).toBeNull();
    expect(parsePerformance("en 45min")).toBeNull();
  });
});

describe("riegelEquivalent", () => {
  it("ramène un semi-marathon à un 10 km plus rapide au kilomètre", () => {
    const semi = { distanceM: 21100, durationS: 5700 }; // 1h35, soit 4:30/km
    const tenK = riegelEquivalent(semi, 10_000, 1.06);
    const pace = tenK / 10;
    expect(pace).toBeLessThan(5700 / 21.1);
    expect(formatPacePerKm(pace)).toBe("4:18/km");
  });
});

describe("computeTrainingZones", () => {
  it("déduit 5 zones de course des temps de référence", () => {
    const zones = computeTrainingZones({ tempsCourse: "10km en 45min" });
    expect(zones.course).toHaveLength(5);
    expect(zones.course?.map((z) => z.zone)).toEqual(["Z1", "Z2", "Z3", "Z4", "Z5"]);
    // 10 km en 45min = 4:30/km ; seuil = +15s, endurance = +75s
    expect(zones.course?.find((z) => z.zone === "Z4")?.value).toBe("4:45/km");
    expect(zones.course?.find((z) => z.zone === "Z2")?.value).toBe("5:45/km");
  });

  it("utilise la FTP pour les zones de puissance quand elle est renseignée", () => {
    const zones = computeTrainingZones({ tempsVelo: "40km en 1h10", ftpWatts: 250 });
    expect(zones.velo?.find((z) => z.zone === "Z4")?.value).toBe("228-263 W");
  });

  it("retombe sur une estimation par la vitesse sans FTP", () => {
    const zones = computeTrainingZones({ tempsVelo: "40km en 1h20" });
    expect(zones.velo?.find((z) => z.zone === "Z4")?.value).toBe("~30.0 km/h");
  });

  it("calcule la CSS en natation", () => {
    const zones = computeTrainingZones({ tempsNatation: "1500m en 30min" });
    // 30 min sur 1500 m = 2:00/100 m
    expect(zones.natation?.find((z) => z.zone === "Z4")?.value).toBe("2:00/100m");
  });

  it("laisse une correction manuelle remplacer la valeur calculée", () => {
    const zones = computeTrainingZones({
      tempsCourse: "10km en 45min",
      overrides: { course: { Z2: "5:30/km" } },
    });
    const z2 = zones.course?.find((z) => z.zone === "Z2");
    expect(z2?.value).toBe("5:30/km");
    expect(z2?.custom).toBe(true);

    // Les autres zones restent calculées.
    const z4 = zones.course?.find((z) => z.zone === "Z4");
    expect(z4?.value).toBe("4:45/km");
    expect(z4?.custom).toBeUndefined();
  });

  it("accepte des zones saisies pour un sport sans temps de référence", () => {
    const zones = computeTrainingZones({
      overrides: { natation: { Z4: "1:45/100m", Z2: "2:00/100m" } },
    });
    expect(zones.natation).toHaveLength(2);
    expect(zones.natation?.every((z) => z.custom)).toBe(true);
    expect(zones.course).toBeNull();
  });

  it("signale dans les notes les sports corrigés à la main", () => {
    const zones = computeTrainingZones({
      tempsCourse: "10km en 45min",
      overrides: { course: { Z3: "5:00/km" } },
    });
    expect(zones.notes.join(" ")).toContain("corrigées à la main");
    expect(zones.notes.join(" ")).toContain("course");
  });

  it("ignore une correction vide plutôt que d'effacer la zone", () => {
    const zones = computeTrainingZones({
      tempsCourse: "10km en 45min",
      overrides: { course: { Z2: "   " } },
    });
    expect(zones.course?.find((z) => z.zone === "Z2")?.value).toBe("5:45/km");
    expect(zones.course?.find((z) => z.zone === "Z2")?.custom).toBeUndefined();
  });

  it("marque les valeurs fixées par l'athlète dans le texte envoyé au modèle", () => {
    const zones = computeTrainingZones({
      tempsCourse: "10km en 45min",
      overrides: { course: { Z4: "4:38/km" } },
    });
    const prompt = formatZonesForPrompt(zones);
    expect(prompt).toContain("4:38/km (valeur fixée par l'athlète)");
    expect(prompt).not.toContain("4:45/km");
  });

  it("signale l'absence de données plutôt que d'inventer des zones", () => {
    const zones = computeTrainingZones({});
    expect(zones.course).toBeNull();
    expect(zones.velo).toBeNull();
    expect(zones.natation).toBeNull();
    expect(zones.notes[0]).toContain("Aucun temps de référence");
  });
});

describe("weeksToGoal", () => {
  it("compte les semaines pleines jusqu'à la semaine de l'objectif", () => {
    const weekStart = new Date("2026-09-07T00:00:00Z");
    expect(weeksToGoal(weekStart, new Date("2026-09-12T00:00:00Z"))).toBe(0);
    expect(weeksToGoal(weekStart, new Date("2026-09-19T00:00:00Z"))).toBe(1);
    expect(weeksToGoal(weekStart, new Date("2026-12-05T00:00:00Z"))).toBe(12);
    expect(weeksToGoal(weekStart, new Date("2026-08-29T00:00:00Z"))).toBe(-2);
  });
});

describe("periodization", () => {
  const weekStart = new Date("2026-09-07T00:00:00Z");
  const goalIn = (weeks: number) => new Date(weekStart.getTime() + weeks * 7 * 24 * 3600 * 1000);

  it("enchaîne base → développement → spécifique → affûtage → course", () => {
    expect(periodization(weekStart, goalIn(20)).phase).toBe("base");
    expect(periodization(weekStart, goalIn(10)).phase).toBe("developpement");
    expect(periodization(weekStart, goalIn(4)).phase).toBe("specifique");
    expect(periodization(weekStart, goalIn(2)).phase).toBe("affutage");
    expect(periodization(weekStart, goalIn(0)).phase).toBe("course");
  });

  it("bascule en transition une fois l'objectif passé", () => {
    expect(periodization(weekStart, goalIn(-2)).phase).toBe("transition");
  });

  it("réduit le volume à l'approche de la course", () => {
    expect(periodization(weekStart, goalIn(10)).volumeFactor).toBe(1);
    expect(periodization(weekStart, goalIn(2)).volumeFactor).toBeLessThan(1);
    expect(periodization(weekStart, goalIn(0)).volumeFactor).toBeLessThan(
      periodization(weekStart, goalIn(2)).volumeFactor
    );
  });
});
