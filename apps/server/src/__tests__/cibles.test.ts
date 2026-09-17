import { describe, expect, it } from "vitest";
import { bornesNumeriques, corrigerCibles, rafraichirCibles, uniteIncoherente, zoneCitee } from "../lib/cibles.js";
import type { TrainingZones } from "../lib/training.js";

const ZONES: TrainingZones = {
  course: [
    { zone: "Z1", label: "récupération", value: "5:45/km" },
    { zone: "Z2", label: "endurance fondamentale", value: "5:10/km" },
    { zone: "Z4", label: "seuil", value: "4:08/km" },
  ],
  natation: [
    { zone: "Z1", label: "récupération", value: "2:02/100m" },
    { zone: "Z2", label: "endurance", value: "1:56/100m" },
    { zone: "Z4", label: "seuil", value: "1:44/100m" },
  ],
  velo: [
    { zone: "Z2", label: "endurance", value: "150-186 W" },
    { zone: "Z4", label: "seuil", value: "226-260 W" },
  ],
  frequenceCardiaque: [
    { zone: "Z2", label: "endurance", value: "136-149 bpm" },
    { zone: "Z4", label: "seuil", value: "158-166 bpm" },
  ],
  notes: [],
};

/** Athlète sans capteur de puissance, mais avec un cardiofréquencemètre. */
const SANS_CAPTEUR: TrainingZones = { ...ZONES, velo: null };

/** Athlète sans capteur ni cardio : il ne lit qu'une vitesse. */
const SANS_RIEN: TrainingZones = { ...ZONES, velo: null, frequenceCardiaque: null };

const seance = (sport: string, cible: string, allure?: string) => ({
  sport,
  structure: {
    echauffement: { cible: "Z1 récupération — valeur", description: "" },
    corps: {
      cible,
      description: "",
      exercices: allure ? [{ repetitions: "8 × 200 m", allure, recuperation: "20 s" }] : [],
    },
    retourCalme: { cible: "Z1 récupération — valeur", description: "" },
  },
});

describe("détection d'unité", () => {
  it("repère une allure au kilomètre sur une séance de natation", () => {
    expect(uniteIncoherente("natation", "Z4 seuil — 4:08/km", ZONES)).toBe(true);
    expect(uniteIncoherente("natation", "Z4 seuil — 1:44/100m", ZONES)).toBe(false);
  });

  it("repère des watts sur une séance de course", () => {
    expect(uniteIncoherente("course", "Z4 seuil — 240 W", ZONES)).toBe(true);
    expect(uniteIncoherente("course", "Z4 seuil — 4:08/km", ZONES)).toBe(false);
  });

  it("repère une allure à pied sur le vélo", () => {
    expect(uniteIncoherente("velo", "Z4 seuil — 4:08/km", ZONES)).toBe(true);
    expect(uniteIncoherente("velo", "Z4 seuil — 226-260 W", ZONES)).toBe(false);
  });

  it("accepte une cible qui porte la bonne unité, même si elle en cite une autre", () => {
    // Un repère complémentaire ne doit pas déclencher de correction.
    expect(uniteIncoherente("natation", "Z4 seuil — 1:44/100m (soit 17:20 au 1000 m)", ZONES)).toBe(false);
  });

  it("ne juge pas les disciplines sans unité chiffrée", () => {
    expect(uniteIncoherente("renfo", "Z2 — gainage", ZONES)).toBe(false);
    expect(uniteIncoherente("repos", "", ZONES)).toBe(false);
  });

  it("accepte la fréquence cardiaque au vélo quand la FTP manque", () => {
    // Sans capteur, c'est ce que l'athlète lit sur sa montre.
    expect(uniteIncoherente("velo", "Z4 seuil — 158-166 bpm", SANS_CAPTEUR)).toBe(false);
  });

  it("accepte une vitesse au vélo quand rien d'autre n'est mesurable", () => {
    expect(uniteIncoherente("velo", "Z2 endurance — 28 km/h sur le plat", SANS_RIEN)).toBe(false);
  });

  it("écarte des watts inventés quand l'athlète n'a pas de capteur", () => {
    // Il ne pourrait pas les vérifier : la consigne serait inapplicable.
    expect(uniteIncoherente("velo", "Z4 seuil — 240 W", SANS_CAPTEUR)).toBe(true);
    expect(uniteIncoherente("velo", "Z4 seuil — 240 W", SANS_RIEN)).toBe(true);
  });

  it("écarte une vitesse en natation, où elle ne veut rien dire", () => {
    expect(uniteIncoherente("natation", "Z2 endurance — 4 km/h", ZONES)).toBe(true);
  });

  it("retrouve la zone citée, quelle que soit son écriture", () => {
    expect(zoneCitee("Z4 seuil — 4:08/km")).toBe("Z4");
    expect(zoneCitee("Zone 2 endurance")).toBe("Z2");
    expect(zoneCitee("allure modérée")).toBeNull();
  });
});

describe("correction des cibles", () => {
  it("remplace une allure de course par l'allure de natation de la même zone", () => {
    const { seances, corrections } = corrigerCibles([seance("natation", "Z4 seuil — 4:08/km")], ZONES);

    expect(seances[0].structure!.corps!.cible).toBe("Z4 seuil — 1:44/100m");
    expect(corrections).toHaveLength(1);
    expect(corrections[0]).toMatchObject({ sport: "natation", avant: "Z4 seuil — 4:08/km" });
  });

  it("corrige aussi l'allure de chaque exercice", () => {
    const { seances } = corrigerCibles([seance("natation", "Z4 seuil — 1:44/100m", "4:08/km (Z4)")], ZONES);

    expect(seances[0].structure!.corps!.exercices![0].allure).toBe("Z4 seuil — 1:44/100m");
  });

  it("ne touche pas à une cible correcte", () => {
    const originale = seance("natation", "Z4 seuil — 1:44/100m");
    const { seances, corrections } = corrigerCibles([originale], ZONES);

    expect(corrections).toHaveLength(0);
    expect(seances[0]).toBe(originale);
  });

  it("laisse la cible en place si la zone n'est pas identifiable", () => {
    // Sans zone citée, le serveur ne sait pas par quoi remplacer : mieux vaut
    // une cible douteuse qu'une valeur inventée.
    const { seances, corrections } = corrigerCibles([seance("natation", "allure vive — 4:08/km")], ZONES);

    expect(corrections).toHaveLength(0);
    expect(seances[0].structure!.corps!.cible).toBe("allure vive — 4:08/km");
  });

  it("bascule le vélo sur la fréquence cardiaque quand la FTP manque", () => {
    const { seances, corrections } = corrigerCibles([seance("velo", "Z4 seuil — 240 W")], SANS_CAPTEUR);

    expect(corrections).toHaveLength(1);
    expect(seances[0].structure!.corps!.cible).toBe("Z4 seuil — 158-166 bpm");
  });

  it("laisse la cible en place quand aucune valeur de remplacement n'existe", () => {
    // Ni puissance ni fréquence cardiaque : inventer une vitesse serait pire
    // que de laisser passer la cible d'origine.
    const { seances, corrections } = corrigerCibles([seance("velo", "Z4 seuil — 240 W")], SANS_RIEN);

    expect(corrections).toHaveLength(0);
    expect(seances[0].structure!.corps!.cible).toBe("Z4 seuil — 240 W");
  });

  it("ne modifie pas une séance sans structure", () => {
    const repos = { sport: "repos", structure: null };
    const { seances, corrections } = corrigerCibles([repos], ZONES);

    expect(seances[0]).toBe(repos);
    expect(corrections).toHaveLength(0);
  });

  it("corrige plusieurs blocs et plusieurs séances en une passe", () => {
    const programme = [
      seance("natation", "Z4 seuil — 4:08/km"),
      seance("course", "Z2 endurance fondamentale — 240 W"),
      seance("velo", "Z4 seuil — 4:08/km"),
    ];
    const { seances, corrections } = corrigerCibles(programme, ZONES);

    expect(corrections).toHaveLength(3);
    expect(seances[0].structure!.corps!.cible).toContain("/100m");
    expect(seances[1].structure!.corps!.cible).toContain("/km");
    expect(seances[2].structure!.corps!.cible).toContain("W");
  });
});

/* ------------------------------------------------------------------ */

/** Zones telles qu'elles étaient au moment où la semaine a été écrite. */
const AVANT: TrainingZones = {
  course: [
    { zone: "Z2", label: "endurance fondamentale", value: "5:20–5:55/km" },
    { zone: "Z4", label: "seuil", value: "4:20–4:42/km" },
  ],
  natation: [{ zone: "Z4", label: "seuil", value: "1:50–1:56/100m" }],
  velo: [{ zone: "Z4", label: "seuil", value: "210–245 W" }],
  frequenceCardiaque: null,
  notes: [],
};

/** Les mêmes zones après un test de terrain réussi : tout s'est décalé. */
const APRES: TrainingZones = {
  ...AVANT,
  course: [
    { zone: "Z2", label: "endurance fondamentale", value: "5:02–5:35/km" },
    { zone: "Z4", label: "seuil", value: "4:01–4:21/km" },
  ],
  natation: [{ zone: "Z4", label: "seuil", value: "1:44–1:50/100m" }],
  velo: [{ zone: "Z4", label: "seuil", value: "226–260 W" }],
};

const planifiee = (sport: string, cible: string, allure?: string) => ({
  ...seance(sport, cible, allure),
  status: "planifiee",
});

describe("bornes numériques d'une cible", () => {
  it("lit un intervalle d'allures en secondes", () => {
    expect(bornesNumeriques("Z4 seuil — 4:01–4:21/km")).toEqual([241, 261]);
  });

  it("lit une allure unique", () => {
    expect(bornesNumeriques("Z4 seuil — 4:08/km")).toEqual([248, 248]);
  });

  it("lit des watts et des battements", () => {
    expect(bornesNumeriques("Z4 seuil — 223–260 W")).toEqual([223, 260]);
    expect(bornesNumeriques("Z4 seuil — 158–166 bpm")).toEqual([158, 166]);
  });

  it("ne prend pas le chiffre de la zone pour une valeur", () => {
    // Sans l'unité accolée, « Z4 » et « 8 × 200 m » seraient lus comme des
    // intensités et toute comparaison deviendrait absurde.
    expect(bornesNumeriques("Z4 seuil")).toBeNull();
    expect(bornesNumeriques("Z4 — 8 × 200 m")).toBeNull();
  });
});

describe("mise à jour des intensités après un test", () => {
  it("remplace une allure devenue trop lente pour sa zone", () => {
    // L'athlète a progressé samedi : le seuil de dimanche doit suivre.
    const { seances, rafraichies } = rafraichirCibles([planifiee("course", "Z4 seuil — 4:20–4:42/km")], APRES);

    expect(rafraichies).toBe(1);
    expect(seances[0].structure!.corps!.cible).toBe("Z4 seuil — 4:01–4:21/km");
  });

  it("conserve une allure précise encore valable", () => {
    // 4:10 tient dans 4:01–4:21 : la remplacer par l'intervalle entier ferait
    // perdre l'intention du coach sans rien corriger.
    const originale = planifiee("course", "Z4 seuil — 4:10/km");
    const { seances, rafraichies } = rafraichirCibles([originale], APRES);

    expect(rafraichies).toBe(0);
    expect(seances[0]).toBe(originale);
  });

  it("ne réécrit pas une séance déjà faite", () => {
    // L'athlète a couru à l'allure qu'on lui avait donnée : la modifier
    // après coup falsifierait son historique.
    const passee = { ...seance("course", "Z4 seuil — 4:20–4:42/km"), status: "faite" };
    const { seances, rafraichies } = rafraichirCibles([passee], APRES);

    expect(rafraichies).toBe(0);
    expect(seances[0]).toBe(passee);
  });

  it("met aussi à jour l'allure des exercices", () => {
    const { seances } = rafraichirCibles(
      [planifiee("natation", "Z4 seuil — 1:44–1:50/100m", "Z4 — 1:50–1:56/100m")],
      APRES
    );

    expect(seances[0].structure!.corps!.exercices![0].allure).toBe("Z4 seuil — 1:44–1:50/100m");
  });

  it("suit aussi la puissance au vélo", () => {
    const { seances, rafraichies } = rafraichirCibles([planifiee("velo", "Z4 seuil — 210–245 W")], APRES);

    expect(rafraichies).toBe(1);
    expect(seances[0].structure!.corps!.cible).toBe("Z4 seuil — 226–260 W");
  });

  it("ne bouge pas quand les zones n'ont pas changé", () => {
    const programme = [planifiee("course", "Z4 seuil — 4:20–4:42/km")];
    const { seances, rafraichies } = rafraichirCibles(programme, AVANT);

    expect(rafraichies).toBe(0);
    expect(seances[0]).toBe(programme[0]);
  });

  it("laisse en place une cible sans zone identifiable", () => {
    const { seances, rafraichies } = rafraichirCibles([planifiee("course", "allure vive — 4:35/km")], APRES);

    expect(rafraichies).toBe(0);
    expect(seances[0].structure!.corps!.cible).toBe("allure vive — 4:35/km");
  });
});
