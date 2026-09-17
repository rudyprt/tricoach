import { describe, expect, it } from "vitest";
import {
  PROTOCOLS,
  TEST_INTERVAL_WEEKS,
  chooseWeeklyTest,
  deriveThresholds,
  describeProgress,
  phaseAllowsTest,
  type SchedulingInputs,
} from "../lib/fitnessTests.js";

const LUNDI = new Date("2026-03-02T00:00:00.000Z");

function inputs(partial: Partial<SchedulingInputs> = {}): SchedulingInputs {
  return {
    phase: "base",
    weeksToGoal: 20,
    dernierTest: {},
    seuilConnu: { course: false, velo: false, natation: false },
    dejaProgrammeCetteSemaine: false,
    weekStart: LUNDI,
    ...partial,
  };
}

describe("programmation des tests", () => {
  it("ne teste pas pendant l'affûtage ni la semaine de course", () => {
    expect(phaseAllowsTest("base")).toBe(true);
    expect(phaseAllowsTest("specifique")).toBe(true);
    expect(phaseAllowsTest("affutage")).toBe(false);
    expect(phaseAllowsTest("course")).toBe(false);
    expect(phaseAllowsTest("transition")).toBe(false);
  });

  it("ne programme pas deux tests la même semaine", () => {
    expect(chooseWeeklyTest(inputs({ dejaProgrammeCetteSemaine: true }))).toBeNull();
  });

  it("ne teste plus dans les trois semaines qui précèdent l'objectif", () => {
    expect(chooseWeeklyTest(inputs({ weeksToGoal: 3 }))).toBeNull();
    expect(chooseWeeklyTest(inputs({ weeksToGoal: 4 }))).not.toBeNull();
  });

  it("commence par une discipline dont le seuil est inconnu", () => {
    const choisi = chooseWeeklyTest(
      inputs({
        seuilConnu: { course: true, velo: true, natation: false },
        dernierTest: { course: new Date("2025-01-01"), velo: new Date("2025-01-01") },
      })
    );
    expect(choisi?.sport).toBe("natation");
  });

  it("attend l'intervalle avant de retester une discipline", () => {
    const recent = new Date(LUNDI.getTime() - 2 * 7 * 24 * 3600 * 1000);
    const tousConnus = { course: true, velo: true, natation: true };
    const choisi = chooseWeeklyTest(
      inputs({
        seuilConnu: tousConnus,
        dernierTest: { course: recent, velo: recent, natation: recent },
      })
    );
    expect(choisi).toBeNull();
  });

  it("reteste la discipline testée il y a le plus longtemps", () => {
    const semaines = (n: number) => new Date(LUNDI.getTime() - n * 7 * 24 * 3600 * 1000);
    const choisi = chooseWeeklyTest(
      inputs({
        seuilConnu: { course: true, velo: true, natation: true },
        dernierTest: {
          course: semaines(TEST_INTERVAL_WEEKS + 1),
          velo: semaines(TEST_INTERVAL_WEEKS + 9),
          natation: semaines(TEST_INTERVAL_WEEKS),
        },
      })
    );
    expect(choisi?.sport).toBe("velo");
  });
});

describe("exploitation des résultats", () => {
  it("déduit l'allure au seuil d'un 30 minutes", () => {
    // 7,5 km en 30 min = 4:00/km, qui est bien l'allure moyenne tenue.
    const derive = deriveThresholds(PROTOCOLS.course.kind, { distanceM: 7500 });
    expect(derive?.seuilCourseSecParKm).toBe(240);
  });

  it("déduit la FTP des 95 % de la puissance sur 20 minutes", () => {
    const derive = deriveThresholds(PROTOCOLS.velo.kind, { puissanceMoy: 240 });
    expect(derive?.ftpWatts).toBe(228);
  });

  it("déduit la CSS de l'écart entre 400 m et 200 m", () => {
    // 400 m en 6:40 (400 s) et 200 m en 3:10 (190 s) → CSS = 105 s/100 m.
    const derive = deriveThresholds(PROTOCOLS.natation.kind, { temps400S: 400, temps200S: 190 });
    expect(derive?.cssSecPer100m).toBe(105);
  });

  it("refuse un résultat invraisemblable plutôt que de fausser les zones", () => {
    expect(deriveThresholds("course_30min", { distanceM: 42195 })).toBeNull();
    expect(deriveThresholds("course_30min", { distanceM: 900 })).toBeNull();
    expect(deriveThresholds("velo_20min", { puissanceMoy: 1200 })).toBeNull();
    // Un 200 m plus lent que le 400 m : le test a été mal exécuté ou mal saisi.
    expect(deriveThresholds("natation_css", { temps400S: 400, temps200S: 420 })).toBeNull();
  });

  it("ne retient une fréquence cardiaque que si elle est plausible", () => {
    expect(deriveThresholds("course_30min", { distanceM: 7500, fcMoyenne: 168 })?.fcSeuil).toBe(168);
    expect(deriveThresholds("course_30min", { distanceM: 7500, fcMoyenne: 40 })?.fcSeuil).toBeUndefined();
  });

  it("dit à l'athlète s'il progresse, dans le bon sens selon la mesure", () => {
    // Une allure plus basse est une progression ; une puissance plus haute aussi.
    expect(describeProgress("course_30min", 250, 240)).toMatch(/progresses/);
    expect(describeProgress("course_30min", 240, 250)).toMatch(/recul/);
    expect(describeProgress("velo_20min", 200, 220)).toMatch(/progresses/);
    expect(describeProgress("velo_20min", 220, 200)).toMatch(/recul/);
    expect(describeProgress("course_30min", null, 240)).toBeNull();
  });
});
