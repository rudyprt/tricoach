import { describe, expect, it } from "vitest";
import {
  coursesDeLaSemaine,
  coursesPromptLines,
  facteurVolumeCourses,
  prochaineCourseA,
  type CourseInscrite,
} from "../lib/races.js";

const LUNDI = new Date("2026-05-04T00:00:00.000Z");

function course(partial: Omit<Partial<CourseInscrite>, "date"> & { nom: string; date: string }): CourseInscrite {
  return {
    id: partial.nom,
    nom: partial.nom,
    date: new Date(`${partial.date}T00:00:00.000Z`),
    format: partial.format ?? "olympique",
    priorite: partial.priorite ?? "A",
    lieu: partial.lieu ?? "",
    objectifTemps: partial.objectifTemps ?? "",
  };
}

describe("calendrier de courses", () => {
  const saison = [
    course({ nom: "Triathlon de Gérardmer", date: "2026-05-09", priorite: "C", format: "sprint" }),
    course({ nom: "Half de Deauville", date: "2026-06-20", priorite: "B", format: "half" }),
    course({ nom: "Ironman de Nice", date: "2026-09-05", priorite: "A", format: "ironman" }),
    course({ nom: "Ironman de Vichy", date: "2025-08-24", priorite: "A", format: "ironman" }),
  ];

  it("pilote la saison sur la prochaine course A, pas sur la plus proche", () => {
    const principale = prochaineCourseA(saison, LUNDI);
    // Gérardmer est plus proche, mais c'est une course C.
    expect(principale?.nom).toBe("Ironman de Nice");
  });

  it("ignore une course A déjà passée", () => {
    expect(prochaineCourseA([saison[3]], LUNDI)).toBeNull();
  });

  it("ne retient que les courses de la semaine générée", () => {
    const semaine = coursesDeLaSemaine(saison, LUNDI);
    expect(semaine.map((c) => c.nom)).toEqual(["Triathlon de Gérardmer"]);
  });

  it("n'allège pas la semaine pour une course d'entraînement", () => {
    // Gérardmer est une course C : elle se court dans la charge, sans affûtage.
    expect(facteurVolumeCourses(saison, LUNDI)).toBeNull();
  });

  it("allège modérément pour un objectif secondaire", () => {
    const semaineDuHalf = new Date("2026-06-15T00:00:00.000Z");
    expect(facteurVolumeCourses(saison, semaineDuHalf)).toBe(0.75);
  });

  it("laisse la périodisation gérer la semaine de l'objectif principal", () => {
    // Un double allègement ferait descendre le volume bien trop bas.
    const semaineDeNice = new Date("2026-08-31T00:00:00.000Z");
    expect(facteurVolumeCourses(saison, semaineDeNice)).toBeNull();
  });

  it("donne au coach une consigne différente selon la priorité", () => {
    const c = coursesPromptLines(saison, LUNDI).join("\n");
    expect(c).toContain("Course d'ENTRAÎNEMENT");
    expect(c).not.toContain("affûtage court");

    const b = coursesPromptLines(saison, new Date("2026-06-15T00:00:00.000Z")).join("\n");
    expect(b).toContain("affûtage court");
    expect(b).toContain("Objectif SECONDAIRE");

    const a = coursesPromptLines(saison, new Date("2026-08-31T00:00:00.000Z")).join("\n");
    expect(a).toContain("OBJECTIF PRINCIPAL");
  });

  it("annonce les courses suivantes pour que le coach garde le cap", () => {
    const lignes = coursesPromptLines(saison, LUNDI).join("\n");
    expect(lignes).toContain("Half de Deauville");
    expect(lignes).toContain("Ironman de Nice");
  });

  it("ne dit rien quand aucune course n'est inscrite", () => {
    expect(coursesPromptLines([], LUNDI)).toEqual([]);
  });
});
