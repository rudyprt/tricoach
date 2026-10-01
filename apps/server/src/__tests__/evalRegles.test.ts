import { describe, expect, it } from "vitest";
import { REGLES, evaluer, estDure, type ContexteEval, type SeanceGeneree } from "../eval/regles.js";
import { PROFILS } from "../eval/profils.js";
import { computeTrainingZones } from "../lib/training.js";

/**
 * Les règles du banc d'essai, éprouvées sur des programmes fabriqués.
 *
 * Sans cela, le banc donnerait un score sans qu'on sache ce qu'il mesure : une
 * règle qui ne détecte rien affiche cent pour cent, et une règle trop stricte
 * condamne un programme correct. Ces tests ne coûtent rien — aucun appel au
 * modèle — et c'est précisément pourquoi ils doivent exister.
 */

const JOURS = [
  "2026-10-05",
  "2026-10-06",
  "2026-10-07",
  "2026-10-08",
  "2026-10-09",
  "2026-10-10",
  "2026-10-11",
];

const ZONES = computeTrainingZones({
  tempsCourse: "",
  tempsNatation: "",
  tempsVelo: "",
  seuilCourseSecParKm: 248,
  ftpWatts: 248,
  cssSecPer100m: 104,
  fcSeuil: 168,
  fcMax: 188,
  overrides: {},
});

const profilDe = (cle: string) => PROFILS.find((p) => p.cle === cle)!;

function contexte(cle = "cadre-ironman", maxVolumeMin = 600): ContexteEval {
  return { profil: profilDe(cle), zones: ZONES, maxVolumeMin, jours: JOURS };
}

function seance(partiel: Partial<SeanceGeneree> & { date: string; sport: string }): SeanceGeneree {
  const duree = partiel.dureeMin ?? 60;
  return {
    titre: "Séance",
    dureeMin: duree,
    distanceKm: null,
    description: "",
    objectif: partiel.sport === "repos" ? null : "Développer l'endurance.",
    structure:
      partiel.sport === "repos"
        ? null
        : {
            echauffement: { dureeMin: Math.round(duree * 0.2), cible: "Z1 récupération", description: "" },
            corps: { dureeMin: Math.round(duree * 0.6), cible: "Z2 endurance fondamentale", description: "" },
            retourCalme: { dureeMin: Math.round(duree * 0.2), cible: "Z1 récupération", description: "" },
          },
    ...partiel,
  };
}

/** Semaine correcte : sert de point de départ qu'on dégrade règle par règle. */
function semaineCorrecte(): SeanceGeneree[] {
  return [
    seance({ date: JOURS[0], sport: "repos", dureeMin: 0 }),
    seance({ date: JOURS[1], sport: "natation", dureeMin: 60 }),
    seance({ date: JOURS[2], sport: "velo", dureeMin: 90 }),
    seance({ date: JOURS[3], sport: "course", dureeMin: 60 }),
    seance({ date: JOURS[4], sport: "repos", dureeMin: 0 }),
    seance({ date: JOURS[5], sport: "velo", dureeMin: 120 }),
    seance({ date: JOURS[6], sport: "course", dureeMin: 75 }),
  ];
}

describe("semaine irréprochable", () => {
  it("ne déclenche aucune règle", () => {
    // Si ce test casse, une règle est devenue trop stricte et le score du banc
    // ne voudra plus rien dire.
    const resultat = evaluer(semaineCorrecte(), contexte());

    expect(resultat.manquements).toEqual([]);
    expect(resultat.reussies).toBe(REGLES.length);
  });
});

describe("chaque règle attrape ce qu'elle vise", () => {
  const manquementsPour = (seances: SeanceGeneree[], ctx = contexte()) =>
    evaluer(seances, ctx).manquements.map((m) => m.regle);

  it("repère un jour manquant", () => {
    const semaine = semaineCorrecte().slice(0, 6);
    expect(manquementsPour(semaine)).toContain("sept-jours");
  });

  it("repère un volume qui déborde", () => {
    // 405 min générées pour 300 autorisées, bien au-delà de la marge de 10 %.
    expect(manquementsPour(semaineCorrecte(), contexte("cadre-ironman", 300))).toContain("volume-respecte");
  });

  it("tolère un léger dépassement d'arrondi", () => {
    // Le modèle arrondit les durées : refuser cinq minutes rendrait la règle
    // tatillonne plutôt qu'utile.
    expect(manquementsPour(semaineCorrecte(), contexte("cadre-ironman", 400))).not.toContain("volume-respecte");
  });

  it("repère une allure au kilomètre dans un bassin", () => {
    const semaine = semaineCorrecte();
    semaine[1].structure!.corps.cible = "Z4 seuil — 4:08/km";
    expect(manquementsPour(semaine)).toContain("unites-executables");
  });

  it("repère des watts chez un athlète sans capteur", () => {
    const sansCapteur = computeTrainingZones({
      tempsCourse: "",
      tempsNatation: "",
      tempsVelo: "",
      seuilCourseSecParKm: 248,
      ftpWatts: null,
      cssSecPer100m: 104,
      fcSeuil: 168,
      fcMax: 188,
      overrides: {},
    });
    const semaine = semaineCorrecte();
    semaine[2].structure!.corps.cible = "Z4 seuil — 240 W";

    const ctx = { ...contexte("sans-capteur"), zones: sansCapteur };
    expect(manquementsPour(semaine, ctx)).toContain("unites-executables");
  });

  it("repère une séance sans structure", () => {
    const semaine = semaineCorrecte();
    semaine[3].structure = null;
    expect(manquementsPour(semaine)).toContain("structure-complete");
  });

  it("repère des blocs qui ne font pas la durée annoncée", () => {
    const semaine = semaineCorrecte();
    semaine[2].structure!.corps.dureeMin = 5;
    expect(manquementsPour(semaine)).toContain("duree-coherente");
  });

  it("repère deux séances dures consécutives", () => {
    const semaine = semaineCorrecte();
    semaine[2].structure!.corps.cible = "Z4 seuil";
    semaine[3].structure!.corps.cible = "Z5 VO2max";
    expect(manquementsPour(semaine)).toContain("pas-deux-dures-de-suite");
  });

  it("repère une séance sans objectif", () => {
    const semaine = semaineCorrecte();
    semaine[1].objectif = "";
    expect(manquementsPour(semaine)).toContain("objectif-present");
  });

  it("repère une discipline absente", () => {
    const semaine = semaineCorrecte().map((s) => (s.sport === "natation" ? { ...s, sport: "velo" } : s));
    expect(manquementsPour(semaine)).toContain("trois-disciplines");
  });

  it("repère une semaine sans aucun repos", () => {
    const semaine = semaineCorrecte().map((s) => (s.sport === "repos" ? { ...s, sport: "renfo", dureeMin: 30 } : s));
    expect(manquementsPour(semaine)).toContain("au-moins-un-repos");
  });

  it("repère une natation le week-end quand la piscine est fermée", () => {
    const semaine = semaineCorrecte();
    semaine[6] = seance({ date: JOURS[6], sport: "natation", dureeMin: 60 });
    expect(manquementsPour(semaine, contexte("sans-piscine-weekend"))).toContain("contrainte-respectee");
  });

  it("repère une blessure au genou ignorée", () => {
    const semaine = semaineCorrecte().map((s) =>
      s.sport === "velo" ? { ...s, sport: "course" } : s
    );
    expect(manquementsPour(semaine, contexte("genou-blesse"))).toContain("contrainte-respectee");
  });

  it("ne crie pas sur une blessure effectivement ménagée", () => {
    const semaine = semaineCorrecte().map((s) => (s.sport === "course" ? { ...s, sport: "velo" } : s));
    expect(manquementsPour(semaine, contexte("genou-blesse"))).not.toContain("contrainte-respectee");
  });
});

describe("détection d'une séance dure", () => {
  it("tient Z4 et Z5 pour dures, Z1 et Z2 pour faciles", () => {
    const facile = seance({ date: JOURS[0], sport: "course" });
    const dure = seance({ date: JOURS[0], sport: "course" });
    dure.structure!.corps.cible = "Z5 VO2max — 3:40/km";

    expect(estDure(facile)).toBe(false);
    expect(estDure(dure)).toBe(true);
  });

  it("regarde aussi les allures des exercices", () => {
    const s = seance({ date: JOURS[0], sport: "course" });
    s.structure!.corps.exercices = [{ repetitions: "6 × 400 m", allure: "Z4 seuil — 4:08/km" }];
    expect(estDure(s)).toBe(true);
  });
});

describe("profils du banc", () => {
  it("couvre des contraintes distinctes, sans doublon", () => {
    const cles = PROFILS.map((p) => p.cle);
    expect(new Set(cles).size).toBe(cles.length);
    expect(PROFILS.length).toBeGreaterThanOrEqual(8);
  });

  it("décrit pour chacun ce qu'il met à l'épreuve", () => {
    for (const p of PROFILS) expect(p.intention.length).toBeGreaterThan(20);
  });
});
