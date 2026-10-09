import { Encoder, Profile } from "@garmin/fitsdk";
import { zoneCitee, bornesNumeriques } from "./cibles.js";
import type { TrainingZones } from "./training.js";
import type { SessionStructure } from "./session.js";

/**
 * Séance structurée au format FIT, à importer dans une montre.
 *
 * Le fichier FIT d'entraînement est le seul format qu'acceptent à la fois
 * Garmin Connect, l'application Coros, Wahoo et Suunto. Passer par les API de
 * chaque fabricant donnerait une synchronisation automatique, mais exige une
 * candidature à leur programme développeur, marque par marque : le fichier
 * fonctionne partout et tout de suite.
 *
 * Ce qui est encodé : la suite des blocs, leur durée ou leur distance, et pour
 * chacun l'intensité cible — allure, puissance ou fréquence cardiaque selon ce
 * que l'athlète peut réellement lire sur son poignet.
 */

/** Décalages imposés par le format, faute de quoi la montre lit tout autre chose. */
const DECALAGE_WATTS = 1000; // en deçà, la valeur est un pourcentage de FTP
const DECALAGE_BPM = 100; // en deçà, un pourcentage de FC max

const SPORTS_FIT: Record<string, { sport: string; subSport: string }> = {
  course: { sport: "running", subSport: "generic" },
  velo: { sport: "cycling", subSport: "generic" },
  natation: { sport: "swimming", subSport: "lapSwimming" },
  renfo: { sport: "training", subSport: "strengthTraining" },
};

/**
 * La natation ne s'encode pas comme la course.
 *
 * Une montre compte des longueurs, pas des minutes : une séance en bassin dont
 * les blocs sont exprimés en temps est refusée à l'import, ou démarre sans
 * jamais changer d'étape. Il lui faut des distances, et la longueur du bassin
 * sur l'en-tête du fichier — sans elle, la montre ne sait pas convertir.
 *
 * En eau libre il n'y a pas de longueurs à compter : le temps redevient la
 * bonne unité, et c'est un autre sous-sport.
 */
export type Bassin = "aucune" | "25m" | "50m" | "eau_libre";

function longueurBassinM(bassin: Bassin | null): number | null {
  if (bassin === "25m") return 25;
  if (bassin === "50m") return 50;
  return null;
}

/** Allure de nage la plus lente connue, en secondes aux 100 m. */
function allureNage(zones: TrainingZones, texte: string): number | null {
  const zone = zoneCitee(texte);
  const valeur =
    (zone ? zones.natation?.find((r) => r.zone === zone)?.value : null) ??
    zones.natation?.find((r) => r.zone === "Z2")?.value ??
    zones.natation?.[0]?.value ??
    null;
  const bornes = valeur ? bornesNumeriques(valeur) : null;
  // La borne haute : mieux vaut une distance un peu courte qu'une séance
  // interminable pour qui nage plus lentement que prévu.
  return bornes ? bornes[1] : null;
}

/**
 * Convertit une durée en distance nageable, arrondie à un nombre entier de
 * longueurs. Une étape qui ne tombe pas juste laisse la montre au milieu du
 * bassin, et l'athlète ne sait plus où il en est.
 */
function distanceNage(dureeMin: number, secondesPar100m: number | null, longueur: number): number {
  const allure = secondesPar100m ?? 120; // 2:00/100m : repère prudent faute de mieux.
  const metres = (dureeMin * 60 * 100) / allure;
  const longueurs = Math.max(1, Math.round(metres / longueur));
  return longueurs * longueur;
}

interface Etape {
  wktStepName: string;
  intensity: string;
  durationType: string;
  durationValue?: number;
  targetType: string;
  targetValue?: number;
  customTargetValueLow?: number;
  customTargetValueHigh?: number;
}

/** Cible chiffrée d'un bloc, exprimée dans l'unité que le format attend. */
function cibleFit(
  sport: string,
  texte: string,
  zones: TrainingZones
): Pick<Etape, "targetType" | "customTargetValueLow" | "customTargetValueHigh"> {
  const ouvert = { targetType: "open" as const };
  const zone = zoneCitee(texte);
  if (!zone) return ouvert;

  const valeurDe = (ranges: { zone: string; value: string }[] | null) =>
    ranges?.find((r) => r.zone === zone)?.value ?? null;

  /* Course et natation : une allure. Les bornes sont en secondes, donc la plus
   * petite est la plus rapide — l'ordre s'inverse au passage à la vitesse. */
  if (sport === "course" || sport === "natation") {
    const valeur = valeurDe(sport === "course" ? zones.course : zones.natation);
    const bornes = valeur ? bornesNumeriques(valeur) : null;
    if (!bornes) return ouvert;
    const parUnite = sport === "course" ? 1000 : 100;
    return {
      targetType: "speed",
      customTargetValueLow: Math.round((parUnite / bornes[1]) * 1000),
      customTargetValueHigh: Math.round((parUnite / bornes[0]) * 1000),
    };
  }

  if (sport === "velo") {
    const watts = valeurDe(zones.velo);
    const bornesW = watts ? bornesNumeriques(watts) : null;
    if (bornesW) {
      return {
        targetType: "power",
        customTargetValueLow: bornesW[0] + DECALAGE_WATTS,
        customTargetValueHigh: bornesW[1] + DECALAGE_WATTS,
      };
    }
    const fc = valeurDe(zones.frequenceCardiaque);
    const bornesFc = fc ? bornesNumeriques(fc) : null;
    if (bornesFc) {
      return {
        targetType: "heartRate",
        customTargetValueLow: bornesFc[0] + DECALAGE_BPM,
        customTargetValueHigh: bornesFc[1] + DECALAGE_BPM,
      };
    }
    const kmh = valeurDe(zones.veloVitesse);
    const bornesKmh = kmh ? bornesNumeriques(kmh) : null;
    if (bornesKmh) {
      return {
        targetType: "speed",
        customTargetValueLow: Math.round((bornesKmh[0] / 3.6) * 1000),
        customTargetValueHigh: Math.round((bornesKmh[1] / 3.6) * 1000),
      };
    }
  }

  return ouvert;
}

/**
 * Nombre de répétitions et longueur d'une, depuis « 8 × 200 m » ou « 6 × 3 min ».
 * Renvoie null dès que la forme n'est pas reconnue : mieux vaut un bloc continu
 * qu'une série inventée.
 */
export function lireRepetitions(
  texte: string
): { fois: number; durationType: "distance" | "time"; durationValue: number } | null {
  const m = texte.match(/(\d{1,2})\s*[x×*]\s*(\d{1,4})\s*(m\b|min\b|'|s\b)/i);
  if (!m) return null;
  const fois = Number(m[1]);
  const valeur = Number(m[2]);
  if (fois < 2 || fois > 60 || valeur <= 0) return null;

  const unite = m[3].toLowerCase();
  // Les distances sont en centimètres, les durées en millisecondes.
  if (unite.startsWith("m") && unite !== "min") return { fois, durationType: "distance", durationValue: valeur * 100 };
  if (unite === "min" || unite === "'") return { fois, durationType: "time", durationValue: valeur * 60 * 1000 };
  return { fois, durationType: "time", durationValue: valeur * 1000 };
}

/** Durée d'une récupération écrite en clair : « 20 s », « 1 min 30 », « 2'30 ». */
export function lireRecuperation(texte: string | undefined): number | null {
  if (!texte) return null;

  // Les secondes suivent souvent les minutes sans unité — « 1 min 30 » vaut
  // quatre-vingt-dix secondes, et non soixante.
  const composee = texte.match(/(\d{1,2})\s*(?:min|mn|')\s*(\d{1,2})(?!\s*\d)/i);
  if (composee) return (Number(composee[1]) * 60 + Number(composee[2])) * 1000;

  const min = texte.match(/(\d{1,2})\s*(?:min|mn|')/i);
  const sec = texte.match(/(\d{1,3})\s*s\b/i);
  const total = (min ? Number(min[1]) * 60 : 0) + (sec ? Number(sec[1]) : 0);
  return total > 0 ? total * 1000 : null;
}

/** Durée d'un bloc, en minutes ou en mètres selon qu'on nage en bassin. */
function dureeOuDistance(
  dureeMin: number,
  cible: string,
  zones: TrainingZones,
  longueurBassin: number | null
): Pick<Etape, "durationType" | "durationValue"> {
  if (!longueurBassin) {
    return { durationType: "time", durationValue: dureeMin * 60 * 1000 };
  }
  // Les distances du format sont en centimètres.
  return {
    durationType: "distance",
    durationValue: distanceNage(dureeMin, allureNage(zones, cible), longueurBassin) * 100,
  };
}

function etapesDuCorps(
  sport: string,
  corps: SessionStructure["corps"],
  zones: TrainingZones,
  longueurBassin: number | null
): { etapes: Etape[]; repetition: { fois: number } | null } {
  const exercice = corps.exercices?.[0];
  const serie = exercice ? lireRepetitions(exercice.repetitions) : null;

  // Pas de série lisible : un seul bloc continu, sur la durée annoncée.
  if (!exercice || !serie) {
    return {
      etapes: [
        {
          wktStepName: "Corps de séance",
          intensity: "active",
          ...dureeOuDistance(Math.max(1, corps.dureeMin), corps.cible, zones, longueurBassin),
          ...cibleFit(sport, corps.cible, zones),
        },
      ],
      repetition: null,
    };
  }

  /* En bassin, une répétition annoncée en minutes doit elle aussi devenir une
   * distance : « 6 × 3 min » n'est pas exécutable par une montre qui compte
   * des longueurs. Une série déjà exprimée en mètres passe telle quelle. */
  const enTemps = serie.durationType === "time";
  const duree: Pick<Etape, "durationType" | "durationValue"> =
    longueurBassin && enTemps
      ? {
          durationType: "distance",
          durationValue:
            distanceNage(
              serie.durationValue / 60000,
              allureNage(zones, exercice.allure || corps.cible),
              longueurBassin
            ) * 100,
        }
      : { durationType: serie.durationType, durationValue: serie.durationValue };

  const etapes: Etape[] = [
    {
      wktStepName: exercice.repetitions.slice(0, 15),
      intensity: "interval",
      ...duree,
      ...cibleFit(sport, exercice.allure || corps.cible, zones),
    },
  ];

  const recup = lireRecuperation(exercice.recuperation);
  if (recup) {
    etapes.push({
      wktStepName: "Récupération",
      intensity: "rest",
      durationType: "time",
      durationValue: recup,
      targetType: "open",
    });
  }

  return { etapes, repetition: { fois: serie.fois } };
}

export interface SeanceAExporter {
  sport: string;
  titre: string;
  structure: SessionStructure | null;
}

/**
 * Construit le fichier. Renvoie null si la séance n'a pas de structure : un
 * fichier vide sur une montre est pire que pas de fichier du tout.
 */
export function construireFitWorkout(
  seance: SeanceAExporter,
  zones: TrainingZones,
  bassin: Bassin | null = null
): Uint8Array | null {
  if (!seance.structure) return null;
  const { echauffement, corps, retourCalme } = seance.structure;
  const fit = { ...(SPORTS_FIT[seance.sport] ?? { sport: "generic", subSport: "generic" }) };

  /* En eau libre, rien à compter : la séance reste en temps, et le sous-sport
   * change — une montre réglée sur « bassin » attendrait des longueurs. */
  const longueurBassin = seance.sport === "natation" ? longueurBassinM(bassin) : null;
  if (seance.sport === "natation" && bassin === "eau_libre") fit.subSport = "openWater";

  const etapes: Etape[] = [];

  if (echauffement.dureeMin > 0) {
    etapes.push({
      wktStepName: "Échauffement",
      intensity: "warmup",
      ...dureeOuDistance(echauffement.dureeMin, echauffement.cible, zones, longueurBassin),
      ...cibleFit(seance.sport, echauffement.cible, zones),
    });
  }

  const debutCorps = etapes.length;
  const { etapes: etapesCorps, repetition } = etapesDuCorps(seance.sport, corps, zones, longueurBassin);
  etapes.push(...etapesCorps);

  if (repetition) {
    /* L'étape de répétition renvoie à l'index de la première étape du bloc :
     * c'est ainsi que le format exprime « refaire depuis là ». */
    etapes.push({
      wktStepName: `× ${repetition.fois}`,
      intensity: "active",
      durationType: "repeatUntilStepsCmplt",
      durationValue: debutCorps,
      targetType: "open",
      targetValue: repetition.fois,
    });
  }

  if (retourCalme.dureeMin > 0) {
    etapes.push({
      wktStepName: "Retour au calme",
      intensity: "cooldown",
      ...dureeOuDistance(retourCalme.dureeMin, retourCalme.cible, zones, longueurBassin),
      ...cibleFit(seance.sport, retourCalme.cible, zones),
    });
  }

  if (etapes.length === 0) return null;

  const encodeur = new Encoder();

  encodeur.onMesg(Profile.MesgNum.FILE_ID, {
    type: "workout",
    manufacturer: "development",
    product: 0,
    timeCreated: new Date(),
    serialNumber: 0,
  });

  encodeur.onMesg(Profile.MesgNum.WORKOUT, {
    wktName: seance.titre.slice(0, 30),
    sport: fit.sport,
    subSport: fit.subSport,
    numValidSteps: etapes.length,
    // Sans la longueur du bassin, la montre ne sait pas convertir les
    // distances en longueurs, et refuse la séance.
    ...(longueurBassin ? { poolLength: longueurBassin, poolLengthUnit: "metric" } : {}),
  });

  etapes.forEach((etape, index) => {
    encodeur.onMesg(Profile.MesgNum.WORKOUT_STEP, { messageIndex: index, ...etape });
  });

  return encodeur.close();
}

/** Nom de fichier lisible, sans accent ni espace : certaines montres les refusent. */
export function nomFichierFit(date: Date, sport: string, titre: string): string {
  const jour = date.toISOString().slice(0, 10);
  const propre = titre
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40)
    .toLowerCase();
  return `${jour}-${sport}-${propre || "seance"}.fit`;
}
