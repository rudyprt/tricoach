import { describe, expect, it } from "vitest";
import { Decoder, Stream } from "@garmin/fitsdk";
import { construireFitWorkout, lireRecuperation, lireRepetitions, nomFichierFit } from "../lib/fitWorkout.js";
import { computeTrainingZones } from "../lib/training.js";
import type { SessionStructure } from "../lib/session.js";

const PROFIL = {
  tempsCourse: "",
  tempsNatation: "",
  tempsVelo: "40km en 1h15",
  seuilCourseSecParKm: 248,
  ftpWatts: 248,
  cssSecPer100m: 104,
  fcSeuil: 168,
  fcMax: 188,
  overrides: {},
};

const zonesAvec = (surcharge: Partial<typeof PROFIL> = {}) =>
  computeTrainingZones({ ...PROFIL, ...surcharge });

const structure = (exercice?: SessionStructure["corps"]["exercices"]): SessionStructure => ({
  echauffement: { dureeMin: 15, cible: "Z1 récupération", description: "" },
  corps: { dureeMin: 30, cible: "Z4 seuil", description: "", exercices: exercice },
  retourCalme: { dureeMin: 10, cible: "Z1 récupération", description: "" },
});

/** Relit le fichier avec le décodeur officiel : la seule preuve qui vaille. */
function relire(octets: Uint8Array) {
  const decodeur = new Decoder(Stream.fromByteArray(octets));
  const valide = decodeur.isFIT() && decodeur.checkIntegrity();
  const { messages, errors } = decodeur.read();
  return { valide, erreurs: errors.length, messages };
}

describe("lecture des séries", () => {
  it("comprend les formes courantes", () => {
    expect(lireRepetitions("8 × 400 m")).toEqual({ fois: 8, durationType: "distance", durationValue: 40000 });
    expect(lireRepetitions("6 x 3 min")).toEqual({ fois: 6, durationType: "time", durationValue: 180000 });
    expect(lireRepetitions("10 × 30 s")).toEqual({ fois: 10, durationType: "time", durationValue: 30000 });
  });

  it("renonce plutôt que d'inventer une série", () => {
    // Une séance décrite en prose donnera un bloc continu, ce qui est juste.
    expect(lireRepetitions("pyramidal 200-400-600")).toBeNull();
    expect(lireRepetitions("1 × 20 min")).toBeNull();
  });

  it("lit une récupération, y compris minutes et secondes mêlées", () => {
    expect(lireRecuperation("1 min 30")).toBe(90000);
    expect(lireRecuperation("20 s")).toBe(20000);
    expect(lireRecuperation("2'30")).toBe(150000);
    expect(lireRecuperation("récupération complète")).toBeNull();
  });
});

describe("fichier d'entraînement", () => {
  it("produit un fichier que le décodeur officiel accepte", () => {
    const octets = construireFitWorkout(
      { sport: "course", titre: "Seuil", structure: structure([{ repetitions: "8 × 400 m", allure: "Z4 seuil", recuperation: "1 min 30" }]) },
      zonesAvec()
    )!;
    const { valide, erreurs, messages } = relire(octets);

    expect(valide).toBe(true);
    expect(erreurs).toBe(0);
    expect(messages.workoutMesgs?.[0]).toMatchObject({ sport: "running", numValidSteps: 5 });
  });

  it("enchaîne échauffement, série, récupération, répétition et retour au calme", () => {
    const octets = construireFitWorkout(
      { sport: "course", titre: "Seuil", structure: structure([{ repetitions: "8 × 400 m", allure: "Z4 seuil", recuperation: "1 min 30" }]) },
      zonesAvec()
    )!;
    const etapes = relire(octets).messages.workoutStepMesgs!;

    expect(etapes.map((e) => e.intensity)).toEqual(["warmup", "interval", "rest", "active", "cooldown"]);
    // L'étape de répétition renvoie à l'index de la première étape du bloc.
    expect(etapes[3]).toMatchObject({ durationType: "repeatUntilStepsCmplt", durationValue: 1, targetValue: 8 });
  });

  it("exprime l'allure de course en vitesse, bornes remises à l'endroit", () => {
    const octets = construireFitWorkout(
      { sport: "course", titre: "Seuil", structure: structure() },
      zonesAvec()
    )!;
    const corps = relire(octets).messages.workoutStepMesgs!.find((e) => e.intensity === "active")!;

    // Z4 vaut 4:01–4:21/km, soit 241 à 261 s : la vitesse basse est la plus lente.
    expect(corps.targetType).toBe("speed");
    expect(corps.customTargetValueLow).toBe(Math.round((1000 / 261) * 1000));
    expect(corps.customTargetValueHigh).toBe(Math.round((1000 / 241) * 1000));
  });

  it("donne des watts à vélo, décalés comme le format l'exige", () => {
    const octets = construireFitWorkout({ sport: "velo", titre: "Seuil", structure: structure() }, zonesAvec())!;
    const corps = relire(octets).messages.workoutStepMesgs!.find((e) => e.intensity === "active")!;

    // Sous 1000, la montre lirait un pourcentage de FTP.
    expect(corps.targetType).toBe("power");
    expect(corps.customTargetValueLow).toBe(223 + 1000);
    expect(corps.customTargetValueHigh).toBe(260 + 1000);
  });

  it("bascule sur la fréquence cardiaque quand la FTP manque", () => {
    const octets = construireFitWorkout(
      { sport: "velo", titre: "Seuil", structure: structure() },
      zonesAvec({ ftpWatts: null })
    )!;
    const corps = relire(octets).messages.workoutStepMesgs!.find((e) => e.intensity === "active")!;

    // Sous 100, la montre lirait un pourcentage de FC max.
    expect(corps.targetType).toBe("heartRate");
    expect(corps.customTargetValueLow).toBeGreaterThan(100);
  });

  it("laisse la cible ouverte plutôt que d'inventer une valeur", () => {
    const sansZone = structure();
    sansZone.corps.cible = "à la sensation";
    const octets = construireFitWorkout({ sport: "course", titre: "Libre", structure: sansZone }, zonesAvec())!;
    const corps = relire(octets).messages.workoutStepMesgs!.find((e) => e.intensity === "active")!;

    expect(corps.targetType).toBe("open");
  });

  it("ne produit rien pour une séance sans structure", () => {
    // Un fichier vide sur une montre est pire que pas de fichier.
    expect(construireFitWorkout({ sport: "repos", titre: "Repos", structure: null }, zonesAvec())).toBeNull();
  });

  it("nomme le fichier sans accent ni espace", () => {
    expect(nomFichierFit(new Date("2026-09-22T00:00:00Z"), "course", "Séance au seuil — 8 × 400 m")).toBe(
      "2026-09-22-course-seance-au-seuil-8-400-m.fit"
    );
  });
});
