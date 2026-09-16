import { describe, expect, it } from "vitest";
import { parseAiPlan } from "../routes/plans.js";

const WEEK = [
  "2026-09-07",
  "2026-09-08",
  "2026-09-09",
  "2026-09-10",
  "2026-09-11",
  "2026-09-12",
  "2026-09-13",
];

function session(date: string, extra: Record<string, unknown> = {}) {
  return { date, sport: "course", titre: "Footing", dureeMin: 45, ...extra };
}

describe("parseAiPlan", () => {
  it("accepte une réponse valide, même entourée de texte", () => {
    const raw = `Voici le programme :\n${JSON.stringify({ sessions: [session("2026-09-07")] })}\nBon entraînement !`;
    expect(parseAiPlan(raw, WEEK).sessions).toHaveLength(1);
  });

  it("rejette une réponse sans JSON", () => {
    expect(() => parseAiPlan("Je ne peux pas générer ce programme.", WEEK)).toThrow(/pas de JSON/);
  });

  it("rejette un JSON tronqué au lieu de le laisser passer", () => {
    // Coupé en plein milieu : plus aucune accolade fermante.
    expect(() => parseAiPlan('{"sessions":[{"date":"2026-09-07","sport":"cou', WEEK)).toThrow(/pas de JSON/);
    // Coupé après un objet imbriqué : du JSON semble présent mais reste illisible.
    expect(() =>
      parseAiPlan('{"sessions":[{"date":"2026-09-07","sport":"course","titre":"F","dureeMin":45}', WEEK)
    ).toThrow(/illisible ou tronqué/);
  });

  it("rejette une date mal formée, qui produirait un Invalid Date en base", () => {
    const raw = JSON.stringify({ sessions: [session("lundi")] });
    expect(() => parseAiPlan(raw, WEEK)).toThrow();
  });

  it("rejette un sport inconnu", () => {
    const raw = JSON.stringify({ sessions: [session("2026-09-07", { sport: "escalade" })] });
    expect(() => parseAiPlan(raw, WEEK)).toThrow();
  });

  it("rejette une durée absurde", () => {
    const raw = JSON.stringify({ sessions: [session("2026-09-07", { dureeMin: 5000 })] });
    expect(() => parseAiPlan(raw, WEEK)).toThrow();
  });

  it("écarte les séances hors de la semaine demandée", () => {
    const raw = JSON.stringify({ sessions: [session("2026-09-07"), session("2027-01-01")] });
    const parsed = parseAiPlan(raw, WEEK);
    expect(parsed.sessions.map((s) => s.date)).toEqual(["2026-09-07"]);
  });

  it("échoue si aucune séance ne tombe dans la semaine demandée", () => {
    const raw = JSON.stringify({ sessions: [session("2027-01-01")] });
    expect(() => parseAiPlan(raw, WEEK)).toThrow(/aucune séance/);
  });

  it("valide la structure de séance quand elle est fournie", () => {
    const structure = {
      echauffement: { dureeMin: 10, cible: "Z2", description: "footing" },
      corps: { dureeMin: 30, cible: "Z4 seuil", description: "6x400m", exercices: [{ repetitions: "6 x 400m", allure: "4:10/km" }] },
      retourCalme: { dureeMin: 5, cible: "Z1", description: "retour au calme" },
    };
    const raw = JSON.stringify({ sessions: [session("2026-09-07", { structure })] });
    expect(parseAiPlan(raw, WEEK).sessions[0].structure?.corps.exercices?.[0].repetitions).toBe("6 x 400m");
  });

  it("rejette une structure incomplète", () => {
    const raw = JSON.stringify({
      sessions: [session("2026-09-07", { structure: { echauffement: { dureeMin: 10, cible: "Z2", description: "x" } } })],
    });
    expect(() => parseAiPlan(raw, WEEK)).toThrow();
  });

  it("conserve le débrief quand il est présent", () => {
    const raw = JSON.stringify({ debrief: "Belle semaine !", sessions: [session("2026-09-07")] });
    expect(parseAiPlan(raw, WEEK).debrief).toBe("Belle semaine !");
  });
});

describe("jours indisponibles", () => {
  const semaine = ["2026-03-02", "2026-03-03", "2026-03-04"];

  function reponse(sessions: unknown[]): string {
    return JSON.stringify({ sessions });
  }

  const seance = (date: string) => ({
    date,
    sport: "course",
    titre: "Endurance",
    dureeMin: 45,
    distanceKm: 8,
    description: "Footing",
    objectif: "Entretenir l'endurance",
    structure: null,
  });

  it("force en repos une séance placée un jour déclaré indisponible", () => {
    // La consigne du prompt ne suffit pas à le garantir, et une séance ce
    // jour-là ne serait de toute façon pas faite.
    const plan = parseAiPlan(reponse(semaine.map(seance)), semaine, new Set(["2026-03-03"]));

    const mardi = plan.sessions.find((s) => s.date === "2026-03-03")!;
    expect(mardi.sport).toBe("repos");
    expect(mardi.dureeMin).toBe(0);
    expect(mardi.structure).toBeNull();
  });

  it("laisse intactes les séances des jours disponibles", () => {
    const plan = parseAiPlan(reponse(semaine.map(seance)), semaine, new Set(["2026-03-03"]));

    expect(plan.sessions.find((s) => s.date === "2026-03-02")!.sport).toBe("course");
    expect(plan.sessions.find((s) => s.date === "2026-03-04")!.dureeMin).toBe(45);
  });

  it("ne touche à rien quand aucun jour n'est indisponible", () => {
    const plan = parseAiPlan(reponse(semaine.map(seance)), semaine);
    expect(plan.sessions.every((s) => s.sport === "course")).toBe(true);
  });
});
