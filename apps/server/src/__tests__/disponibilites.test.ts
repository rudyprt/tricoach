import { describe, expect, it } from "vitest";
import {
  disponibilitesPromptLines,
  joursIndisponibles,
  materielPromptLines,
  parseDisponibilites,
  parseMateriel,
  volumeAtteignableMin,
  type Disponibilites,
} from "../lib/disponibilites.js";

/** Lundi 2 mars 2026. */
const LUNDI = new Date("2026-03-02T00:00:00.000Z");

const SEMAINE: Disponibilites = {
  lundi: { disponible: false },
  mardi: { disponible: true, dureeMaxMin: 60, moment: "soir" },
  mercredi: { disponible: true, dureeMaxMin: 75, moment: "midi" },
  jeudi: { disponible: false },
  vendredi: { disponible: true, dureeMaxMin: 60, moment: "soir" },
  samedi: { disponible: true, dureeMaxMin: 180, moment: "matin" },
  dimanche: { disponible: true, dureeMaxMin: 120, moment: "libre" },
};

describe("créneaux d'entraînement", () => {
  it("désigne les jours à forcer en repos", () => {
    expect(joursIndisponibles(SEMAINE, LUNDI)).toEqual(["2026-03-02", "2026-03-05"]);
  });

  it("ne force rien quand rien n'est déclaré", () => {
    expect(joursIndisponibles(null, LUNDI)).toEqual([]);
  });

  it("plafonne le volume à ce qui tient dans les créneaux", () => {
    // 60 + 75 + 60 + 180 + 120 = 495 minutes, soit un peu plus de 8 heures.
    expect(volumeAtteignableMin(SEMAINE)).toBe(495);
  });

  it("ne plafonne rien si aucune durée n'est saisie", () => {
    // Mieux vaut aucune limite qu'une limite fausse.
    const sansDurees: Disponibilites = { lundi: { disponible: true }, mardi: { disponible: true } };
    expect(volumeAtteignableMin(sansDurees)).toBeNull();
    expect(volumeAtteignableMin(null)).toBeNull();
  });

  it("transmet au coach les dates exactes, pas les noms de jours", () => {
    const lignes = disponibilitesPromptLines(SEMAINE, LUNDI).join("\n");
    expect(lignes).toContain("2026-03-02 (lundi) : INDISPONIBLE");
    expect(lignes).toContain("2026-03-07 (samedi) : disponible le matin, 180 min maximum");
    expect(lignes).toContain("sortie longue");
  });

  it("écarte une valeur stockée qui ne colle plus au schéma", () => {
    expect(parseDisponibilites({ lundi: { disponible: "oui" } })).toBeNull();
    expect(parseDisponibilites(null)).toBeNull();
    expect(parseDisponibilites({ lundi: { disponible: true } })).toMatchObject({ lundi: { disponible: true } });
  });
});

describe("matériel", () => {
  it("interdit la natation sans accès à un bassin", () => {
    const lignes = materielPromptLines(parseMateriel({ piscine: "aucune" })).join("\n");
    expect(lignes).toContain("AUCUNE SÉANCE DE NATATION");
  });

  it("interdit les watts sans capteur de puissance", () => {
    const sans = materielPromptLines(parseMateriel({ capteurPuissance: false })).join("\n");
    expect(sans).toContain("jamais une séance de vélo en watts");

    const avec = materielPromptLines(parseMateriel({ capteurPuissance: true })).join("\n");
    expect(avec).not.toContain("jamais une séance de vélo en watts");
  });

  it("adapte les séries à la taille du bassin", () => {
    expect(materielPromptLines(parseMateriel({ piscine: "50m" })).join("\n")).toContain("50m");
    expect(materielPromptLines(parseMateriel({ piscine: "eau_libre" })).join("\n")).toContain("eau libre");
  });

  it("renonce aux intervalles très courts sans home-trainer", () => {
    expect(materielPromptLines(parseMateriel({ homeTrainer: false })).join("\n")).toContain("Pas de home-trainer");
  });

  it("ne dit rien quand le matériel n'est pas renseigné", () => {
    expect(materielPromptLines(null)).toEqual([]);
  });
});
