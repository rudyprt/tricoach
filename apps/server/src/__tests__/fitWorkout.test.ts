import { describe, expect, it } from "vitest";
import { Decoder, Stream } from "@garmin/fitsdk";
import { construireFitWorkout, lireRecuperation, lireRepetitions, nomFichierFit } from "../lib/fitWorkout.js";
import { computeTrainingZones } from "../lib/training.js";
import type { SessionStructure } from "../lib/session.js";

const PROFIL: Parameters<typeof computeTrainingZones>[0] = {
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

const zonesAvec = (surcharge: Partial<Parameters<typeof computeTrainingZones>[0]> = {}) =>
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

/**
 * La natation ne s'encode pas comme la course.
 *
 * Un testeur a signalé que ses séances de natation ne s'importaient pas sur sa
 * montre. La cause : les blocs étaient exprimés en minutes, alors qu'une montre
 * en bassin compte des longueurs — et la longueur du bassin manquait à
 * l'en-tête, sans quoi elle ne peut rien convertir.
 */
describe("natation", () => {
  const seanceNage = (exercices?: SessionStructure["corps"]["exercices"]) => ({
    sport: "natation",
    titre: "Seuil en bassin",
    structure: {
      echauffement: { dureeMin: 10, cible: "Z2 endurance", description: "" },
      corps: { dureeMin: 20, cible: "Z4 seuil", description: "", exercices },
      retourCalme: { dureeMin: 5, cible: "Z2 endurance", description: "" },
    } as SessionStructure,
  });

  it("inscrit la longueur du bassin, sans quoi la montre refuse le fichier", () => {
    const octets = construireFitWorkout(seanceNage(), zonesAvec(), "25m")!;
    const { valide, erreurs, messages } = relire(octets);

    expect(valide).toBe(true);
    expect(erreurs).toBe(0);
    expect(messages.workoutMesgs?.[0]).toMatchObject({
      sport: "swimming",
      subSport: "lapSwimming",
      poolLength: 25,
      poolLengthUnit: "metric",
    });
  });

  it("exprime les blocs en distance, et non en minutes", () => {
    const etapes = relire(construireFitWorkout(seanceNage(), zonesAvec(), "25m")!).messages.workoutStepMesgs!;

    for (const etape of etapes) {
      expect(etape.durationType).toBe("distance");
    }
  });

  it("tombe sur un nombre entier de longueurs", () => {
    // Une étape qui s'arrête au milieu du bassin laisse l'athlète sans repère.
    for (const [bassin, longueur] of [["25m", 25], ["50m", 50]] as const) {
      const etapes = relire(construireFitWorkout(seanceNage(), zonesAvec(), bassin)!).messages.workoutStepMesgs!;
      for (const etape of etapes) {
        // Les distances du format sont en centimètres.
        expect((etape.durationValue as number) / 100 % longueur).toBe(0);
      }
    }
  });

  it("convertit la durée avec l'allure de nage de l'athlète", () => {
    // CSS à 1:44/100m : la borne lente de Z2 tourne autour de 2 min/100 m,
    // donc dix minutes d'échauffement valent quelques centaines de mètres.
    const etapes = relire(construireFitWorkout(seanceNage(), zonesAvec(), "25m")!).messages.workoutStepMesgs!;
    const echauffement = (etapes[0].durationValue as number) / 100;
    expect(echauffement).toBeGreaterThan(300);
    expect(echauffement).toBeLessThan(800);
  });

  it("garde en distance une série déjà annoncée en mètres", () => {
    const etapes = relire(
      construireFitWorkout(
        seanceNage([{ repetitions: "8 × 100 m", allure: "Z4 seuil", recuperation: "20 s" }]),
        zonesAvec(),
        "25m"
      )!
    ).messages.workoutStepMesgs!;

    expect(etapes[1]).toMatchObject({ durationType: "distance", durationValue: 100 * 100 });
    // La récupération reste un temps : on attend au mur, on ne nage pas.
    expect(etapes[2]).toMatchObject({ durationType: "time", durationValue: 20 * 1000 });
  });

  it("convertit aussi une série annoncée en minutes", () => {
    const etapes = relire(
      construireFitWorkout(
        seanceNage([{ repetitions: "6 × 3 min", allure: "Z4 seuil", recuperation: "20 s" }]),
        zonesAvec(),
        "25m"
      )!
    ).messages.workoutStepMesgs!;

    expect(etapes[1].durationType).toBe("distance");
    expect((etapes[1].durationValue as number) / 100 % 25).toBe(0);
  });

  it("reste en temps en eau libre, où il n'y a pas de longueurs à compter", () => {
    const octets = construireFitWorkout(seanceNage(), zonesAvec(), "eau_libre")!;
    const { messages } = relire(octets);

    expect(messages.workoutMesgs?.[0]).toMatchObject({ sport: "swimming", subSport: "openWater" });
    expect(messages.workoutMesgs?.[0].poolLength).toBeFalsy();
    expect(messages.workoutStepMesgs![0].durationType).toBe("time");
  });

  it("laisse la course en minutes, bassin déclaré ou non", () => {
    const etapes = relire(
      construireFitWorkout({ sport: "course", titre: "Endurance", structure: structure() }, zonesAvec(), "25m")!
    ).messages.workoutStepMesgs!;

    expect(etapes[0].durationType).toBe("time");
  });
});

