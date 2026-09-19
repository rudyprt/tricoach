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

function etapesDuCorps(
  sport: string,
  corps: SessionStructure["corps"],
  zones: TrainingZones
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
          durationType: "time",
          durationValue: Math.max(1, corps.dureeMin) * 60 * 1000,
          ...cibleFit(sport, corps.cible, zones),
        },
      ],
      repetition: null,
    };
  }

  const etapes: Etape[] = [
    {
      wktStepName: exercice.repetitions.slice(0, 15),
      intensity: "interval",
      durationType: serie.durationType,
      durationValue: serie.durationValue,
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
export function construireFitWorkout(seance: SeanceAExporter, zones: TrainingZones): Uint8Array | null {
  if (!seance.structure) return null;
  const { echauffement, corps, retourCalme } = seance.structure;
  const fit = SPORTS_FIT[seance.sport] ?? { sport: "generic", subSport: "generic" };

  const etapes: Etape[] = [];

  if (echauffement.dureeMin > 0) {
    etapes.push({
      wktStepName: "Échauffement",
      intensity: "warmup",
      durationType: "time",
      durationValue: echauffement.dureeMin * 60 * 1000,
      ...cibleFit(seance.sport, echauffement.cible, zones),
    });
  }

  const debutCorps = etapes.length;
  const { etapes: etapesCorps, repetition } = etapesDuCorps(seance.sport, corps, zones);
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
      durationType: "time",
      durationValue: retourCalme.dureeMin * 60 * 1000,
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
