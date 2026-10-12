import { describe, expect, it } from "vitest";
import { analysePromptLines, chiffresCourse, dureeLibre, resultatSchema } from "../lib/analyseCourse.js";

const resultat = (r: Record<string, unknown>) => resultatSchema.parse(r);

describe("chiffres d'une course", () => {
  it("calcule durées, parts du total et allures sur les distances du format", () => {
    const c = chiffresCourse(
      resultat({ natation: "25:00", t1: "1:30", velo: "1:05:00", t2: "1:00", course: "45:00" }),
      { format: "olympique" },
      ""
    );
    expect(c.total).toBe("2:17:30");
    const [natation, , velo, , course] = c.segments;
    expect(natation.allure).toBe("1:40/100m");
    expect(velo.allure).toBe("36.9 km/h");
    expect(course.allure).toBe("4:30/km");
    expect(velo.part).toBe(47.3);
  });

  it("préfère le temps officiel à la somme des segments", () => {
    const c = chiffresCourse(resultat({ velo: "35:00", total: "1:10:12" }), { format: "sprint" }, "");
    expect(c.total).toBe("1:10:12");
    expect(c.segments).toHaveLength(1);
  });

  it("ne totalise pas des segments incomplets", () => {
    expect(chiffresCourse(resultat({ natation: "25:00", velo: "1:05:00" }), { format: "olympique" }, "").total).toBeNull();
  });

  it("prend les distances saisies quand le format n'en a pas", () => {
    const c = chiffresCourse(resultat({ course: "50:00", distances: { courseKm: 10 } }), { format: "autre" }, "");
    expect(c.segments[0].allure).toBe("5:00/km");
  });

  it("mesure l'écart au temps visé", () => {
    const c = chiffresCourse(resultat({ total: "2:36:00" }), { format: "olympique" }, "sub 2h30");
    expect(c.ecartObjectifS).toBe(360);
  });
});

describe("épreuve d'une seule discipline", () => {
  it("donne l'allure d'un 10 km à partir du seul temps saisi", () => {
    const c = chiffresCourse(resultat({ total: "44:30" }), { format: "autre", discipline: "course", distanceKm: 10 }, "45min");
    expect(c.segments).toEqual([expect.objectContaining({ segment: "course", duree: "44:30", allure: "4:27/km" })]);
    expect(c.total).toBe("44:30");
  });

  it("donne la vitesse d'une cyclosportive et le temps aux 100 m d'une traversée", () => {
    expect(
      chiffresCourse(resultat({ velo: "4:00:00" }), { format: "autre", discipline: "velo", distanceKm: 120 }, "").segments[0]
        .allure
    ).toBe("30.0 km/h");
    expect(
      chiffresCourse(resultat({ total: "1:00:00" }), { format: "autre", discipline: "natation", distanceKm: 3 }, "")
        .segments[0].allure
    ).toBe("2:00/100m");
  });

  it("ignore les autres segments", () => {
    const c = chiffresCourse(resultat({ course: "44:30", velo: "1:00:00" }), { format: "autre", discipline: "course", distanceKm: 10 }, "");
    expect(c.segments.map((x) => x.segment)).toEqual(["course"]);
  });
});

describe("saisie du résultat", () => {
  it("exige au moins un temps", () => {
    expect(resultatSchema.safeParse({ ressenti: "Super" }).success).toBe(false);
  });

  it("refuse une durée illisible", () => {
    expect(resultatSchema.safeParse({ velo: "1h10" }).success).toBe(false);
    expect(resultatSchema.safeParse({ velo: "1:75:00" }).success).toBe(false);
  });
});

describe("temps visé en texte libre", () => {
  it("lit les écritures courantes", () => {
    expect(dureeLibre("2h30")).toBe(9000);
    expect(dureeLibre("sub 5h")).toBe(18000);
    expect(dureeLibre("2:30:00")).toBe(9000);
    expect(dureeLibre("vite")).toBeNull();
  });
});

describe("retour dans les semaines générées", () => {
  it("transmet les axes de progrès de la dernière course analysée", () => {
    const lignes = analysePromptLines({
      nom: "Triathlon de Paris",
      date: new Date("2026-10-04T00:00:00.000Z"),
      analyse: {
        resume: "r",
        segments: [],
        pointsForts: [],
        axesProgres: [{ titre: "Enchaînement", pourquoi: "p", travail: "Enchaînés vélo-course" }],
        prochaineCourse: "x",
      },
    }).join("\n");
    expect(lignes).toContain("Triathlon de Paris");
    expect(lignes).toContain("- Enchaînement : Enchaînés vélo-course");
  });

  it("ne dit rien sans analyse valide", () => {
    expect(analysePromptLines(null)).toEqual([]);
    expect(analysePromptLines({ nom: "x", date: new Date(), analyse: { bidon: true } })).toEqual([]);
  });
});
