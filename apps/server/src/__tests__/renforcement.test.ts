import { describe, expect, it } from "vitest";
import { Decoder, Stream } from "@garmin/fitsdk";
import { buildSystemPrompt, parseAiPlan } from "../routes/plans.js";
import { computeTrainingZones, periodization } from "../lib/training.js";
import { renfoPromptLines } from "../lib/renforcement.js";
import { materielPromptLines, parseMateriel } from "../lib/disponibilites.js";
import { construireFitWorkout, lireSeriesRenfo } from "../lib/fitWorkout.js";
import type { SessionStructure } from "../lib/session.js";

/**
 * Le renforcement se prescrit comme une fiche de salle — exercices nommés,
 * séries, répétitions, charge, repos — et suit la préparation : force loin de
 * la course, entretien léger à son approche, rien la semaine du jour J.
 */

const LUNDI = new Date("2026-03-02T00:00:00.000Z");
const dansSemaines = (n: number) => new Date(LUNDI.getTime() + n * 7 * 24 * 3600 * 1000);

describe("consignes de renforcement", () => {
  it("demande des exercices nommés, chiffrés et dosés en RPE", () => {
    const texte = renfoPromptLines("base").join("\n");
    expect(texte).toMatch(/5 à 7 exercices/);
    expect(texte).toMatch(/"nom"/);
    expect(texte).toMatch(/RPE/);
    expect(texte).toMatch(/Blessures ou contraintes/);
  });

  it("suit la phase de préparation", () => {
    expect(renfoPromptLines("base").join("\n")).toMatch(/10 à 15 répétitions/);
    expect(renfoPromptLines("developpement").join("\n")).toMatch(/5 à 8 répétitions/);
    expect(renfoPromptLines("affutage").join("\n")).toMatch(/Aucun renforcement dans les 4 jours/);
    expect(renfoPromptLines("course").join("\n")).toMatch(/pas de renforcement/);
  });

  it("figure dans le prompt de génération, avec la phase courante", () => {
    const loin = buildSystemPrompt(false, periodization(LUNDI, dansSemaines(30)));
    expect(loin).toMatch(/SÉANCES DE RENFORCEMENT/);
    expect(loin).toMatch(/force générale/);
    const proche = buildSystemPrompt(false, periodization(LUNDI, dansSemaines(1)));
    expect(proche).toMatch(/affûtage|Semaine de course/i);
    expect(proche).not.toMatch(/force générale/);
  });
});

describe("matériel de renforcement", () => {
  it("prescrit au poids du corps quand rien n'est déclaré", () => {
    // Profils enregistrés avant l'ajout du champ.
    expect(parseMateriel({ piscine: "25m" })?.renfo).toBe("poids_du_corps");
    expect(materielPromptLines(parseMateriel({})).join("\n")).toMatch(/poids du corps uniquement/);
  });

  it("dose en RPE en salle, faute de connaître les charges", () => {
    expect(materielPromptLines(parseMateriel({ renfo: "salle" })).join("\n")).toMatch(/salle de musculation.*RPE/);
  });
});

describe("séance générée", () => {
  it("conserve le nom et la consigne de chaque exercice", () => {
    const raw = JSON.stringify({
      sessions: [
        {
          date: "2026-03-03",
          sport: "renfo",
          titre: "Force générale",
          dureeMin: 40,
          structure: {
            echauffement: { dureeMin: 8, cible: "RPE 3/10", description: "Mobilité" },
            corps: {
              dureeMin: 27,
              cible: "RPE 7/10",
              description: "Circuit force",
              exercices: [
                { nom: "Fentes bulgares", repetitions: "3 x 10 par jambe", allure: "poids du corps", recuperation: "60 s", consigne: "Genou dans l'axe du pied" },
              ],
            },
            retourCalme: { dureeMin: 5, cible: "RPE 2/10", description: "Étirements" },
          },
        },
      ],
    });
    const exercice = parseAiPlan(raw, ["2026-03-03"]).sessions[0].structure?.corps.exercices?.[0];
    expect(exercice?.nom).toBe("Fentes bulgares");
    expect(exercice?.consigne).toBe("Genou dans l'axe du pied");
  });
});

describe("export vers la montre", () => {
  const zones = computeTrainingZones({
    tempsCourse: "",
    tempsNatation: "",
    tempsVelo: "",
    seuilCourseSecParKm: null,
    ftpWatts: null,
    cssSecPer100m: null,
    fcSeuil: null,
    fcMax: null,
    overrides: {},
  });

  const structure: SessionStructure = {
    echauffement: { dureeMin: 8, cible: "RPE 3/10", description: "Mobilité" },
    corps: {
      dureeMin: 25,
      cible: "RPE 7/10",
      description: "Force",
      exercices: [
        { nom: "Squat goblet", repetitions: "3 x 12", allure: "RPE 7/10", recuperation: "60 s", consigne: "Dos droit" },
        { nom: "Planche latérale", repetitions: "2 x 40 s par côté", allure: "poids du corps", recuperation: "30 s" },
      ],
    },
    retourCalme: { dureeMin: 5, cible: "RPE 2/10", description: "Étirements" },
  };

  it("lit des séries en répétitions ou en secondes", () => {
    expect(lireSeriesRenfo("3 x 12")).toEqual({ fois: 3, durationType: "reps", durationValue: 12 });
    expect(lireSeriesRenfo("3 x 10 par jambe")).toEqual({ fois: 3, durationType: "reps", durationValue: 10 });
    expect(lireSeriesRenfo("2 x 40 s par côté")).toEqual({ fois: 2, durationType: "time", durationValue: 40000 });
    expect(lireSeriesRenfo("au choix")).toBeNull();
  });

  it("donne une étape par exercice, nommée, répétée par série", () => {
    const octets = construireFitWorkout({ sport: "renfo", titre: "Force", structure }, zones);
    expect(octets).not.toBeNull();
    const decodeur = new Decoder(Stream.fromByteArray(octets!));
    expect(decodeur.checkIntegrity()).toBe(true);
    const { messages, errors } = decodeur.read();
    expect(errors).toHaveLength(0);
    const etapes = messages.workoutStepMesgs as Record<string, unknown>[];

    const squat = etapes.findIndex((e) => e.wktStepName === "Squat goblet");
    expect(squat).toBeGreaterThan(0);
    expect(etapes[squat]).toMatchObject({ durationType: "reps", durationReps: 12 });
    expect(String(etapes[squat].notes)).toMatch(/Dos droit/);
    // Repos, puis retour au début de l'exercice pour les deux autres séries.
    expect(etapes[squat + 1]).toMatchObject({ wktStepName: "Repos", intensity: "rest" });
    expect(etapes[squat + 2]).toMatchObject({ durationType: "repeatUntilStepsCmplt", durationStep: squat, repeatSteps: 3 });

    const planche = etapes.findIndex((e) => e.wktStepName === "Planche latéral");
    expect(etapes[planche]).toMatchObject({ durationType: "time", durationTime: 40 });
    expect(etapes.at(-1)?.intensity).toBe("cooldown");
  });
});
