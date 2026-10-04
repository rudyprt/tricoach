import { describe, expect, it } from "vitest";
import {
  disponibilitesPromptLines,
  joursIndisponibles,
  materielPromptLines,
  parseDisponibilites,
  parseMateriel,
  volumeAtteignableMin,
  disciplinesImposees,
  type Disponibilites,
} from "../lib/disponibilites.js";
import { joursDeRepos, jourDeLaDate } from "../lib/reposDeclare.js";

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
})

describe("discipline imposée sur un créneau", () => {
  /*
   * Un athlète n'a pas toujours le choix : la piscine n'ouvre que le mardi
   * soir, le club court le samedi. Sans cette contrainte, le coach plaçait la
   * natation le jour où l'athlète ne peut pas nager.
   */
  it("laisse le coach choisir par défaut", () => {
    const lignes = disponibilitesPromptLines({ mardi: { disponible: true } }, LUNDI);
    expect(lignes.join("\n")).not.toContain("DOIT être une séance");
  });

  it("impose la discipline quand elle est choisie", () => {
    const lignes = disponibilitesPromptLines(
      { mardi: { disponible: true, discipline: "natation" } },
      LUNDI
    ).join("\n");

    expect(lignes).toContain("2026-03-03");
    expect(lignes).toContain("DOIT être une séance de natation");
    expect(lignes).toContain('sport: "natation"');
  });

  it("dit au modèle que ce n'est pas une préférence", () => {
    // Formulé comme un goût, le modèle s'en écarte dès que ça l'arrange.
    const lignes = disponibilitesPromptLines(
      { jeudi: { disponible: true, discipline: "velo" } },
      LUNDI
    ).join("\n");
    expect(lignes).toContain("n'est pas négociable");
  });

  it("n'impose rien sur un jour indisponible", () => {
    const lignes = disponibilitesPromptLines(
      { dimanche: { disponible: false, discipline: "course" } },
      LUNDI
    ).join("\n");
    expect(lignes).toContain("INDISPONIBLE");
    expect(lignes).not.toContain("DOIT être une séance");
  });

  it("relit une discipline stockée, et écarte une valeur inconnue", () => {
    expect(parseDisponibilites({ mardi: { disponible: true, discipline: "velo" } })?.mardi?.discipline).toBe("velo");
    expect(parseDisponibilites({ mardi: { disponible: true, discipline: "escalade" } })).toBeNull();
  });

  it("recense les dates réservées, et seulement celles-là", () => {
    const imposees = disciplinesImposees(
      {
        lundi: { disponible: true, discipline: "natation" },
        mardi: { disponible: true, discipline: "libre" },
        mercredi: { disponible: true },
        dimanche: { disponible: false, discipline: "course" },
      },
      LUNDI
    );

    expect([...imposees.entries()]).toEqual([["2026-03-02", "natation"]]);
  });
});

describe("jour de repos déclaré après coup", () => {
  /*
   * Le bug signalé par les athlètes : la génération respectait bien le jour
   * indisponible, mais le déclarer ENSUITE ne touchait pas la séance déjà
   * posée. Ces deux fonctions sont ce sur quoi repose la correction.
   */
  it("retrouve le jour de la semaine d'une date de séance", () => {
    expect(jourDeLaDate(new Date("2026-03-02T00:00:00.000Z"))).toBe("lundi");
    // Le dimanche : le cas même du bug, et celui que `getUTCDay` place en tête.
    expect(jourDeLaDate(new Date("2026-03-08T00:00:00.000Z"))).toBe("dimanche");
    expect(jourDeLaDate(new Date("2026-03-07T00:00:00.000Z"))).toBe("samedi");
  });

  it("ne retient que les jours explicitement déclarés indisponibles", () => {
    expect([...joursDeRepos(SEMAINE)]).toEqual(["lundi", "jeudi"]);
    // Un jour absent du formulaire n'est pas un jour de repos : rien n'a été dit.
    expect([...joursDeRepos({ mardi: { disponible: true } })]).toEqual([]);
    expect([...joursDeRepos(null)]).toEqual([]);
  });
});
