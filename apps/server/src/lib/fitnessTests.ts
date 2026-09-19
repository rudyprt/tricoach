import type { TrainingPhase } from "./training.js";

export const TEST_SPORTS = ["course", "velo", "natation"] as const;
export type TestSport = (typeof TEST_SPORTS)[number];

/**
 * Un coach ne devine pas les zones de son athlète : il le teste, puis il
 * réajuste. Sans cela, les zones dérivent — trop dures quand la forme baisse,
 * trop faciles quand elle monte — et le programme s'éloigne peu à peu de la
 * réalité.
 */
export interface TestProtocol {
  sport: TestSport;
  /** Identifiant du protocole, stocké avec le résultat. */
  kind: string;
  titre: string;
  dureeMin: number;
  /** Consigne donnée à l'athlète, et reprise dans la séance générée. */
  protocole: string;
  /** Ce qu'il faut relever pour exploiter le test. */
  mesures: string;
}

export const PROTOCOLS: Record<TestSport, TestProtocol> = {
  course: {
    sport: "course",
    kind: "course_30min",
    titre: "Test de seuil — 30 min contre-la-montre",
    dureeMin: 50,
    protocole:
      "Échauffement 15 min en endurance. Puis 30 minutes à l'allure la plus rapide que tu peux tenir sans faiblir, seul, sur terrain plat et régulier (piste ou route sans arrêts). Pars prudemment : le but est de finir aussi vite que tu as commencé. Retour au calme 5 min.",
    mesures: "Distance parcourue pendant les 30 minutes, et fréquence cardiaque moyenne des 20 dernières minutes.",
  },
  velo: {
    sport: "velo",
    kind: "velo_20min",
    titre: "Test FTP — 20 min contre-la-montre",
    dureeMin: 60,
    protocole:
      "Échauffement 20 min dont 3 accélérations de 1 min. Puis 20 minutes à la puissance la plus élevée que tu peux tenir, sur route régulière ou home-trainer. Retour au calme 10 min.",
    mesures: "Puissance moyenne sur les 20 minutes, et fréquence cardiaque moyenne.",
  },
  natation: {
    sport: "natation",
    kind: "natation_css",
    titre: "Test CSS — 400 m puis 200 m chronométrés",
    dureeMin: 45,
    protocole:
      "Échauffement 600 m progressif. Puis 400 m chronométrés à fond, récupération complète (5 min), puis 200 m chronométrés à fond. Retour au calme 200 m souple.",
    mesures: "Temps sur 400 m et temps sur 200 m.",
  },
};

/**
 * Intervalle visé entre deux tests d'une même discipline.
 *
 * Dix semaines, soit un peu plus de deux mois : c'est le délai au bout duquel
 * un seuil a réellement bougé. À six semaines, l'écart mesuré tenait souvent
 * autant à la forme du jour, à la météo ou au sommeil de la veille qu'à un
 * progrès — et, avec trois disciplines et un test au plus par semaine, une
 * semaine sur deux devenait une semaine de test.
 */
export const TEST_INTERVAL_WEEKS = 10;

/**
 * Un test se court à fond : il fatigue comme une course. Le programmer pendant
 * l'affûtage ou la semaine de l'objectif ruinerait la préparation.
 */
export function phaseAllowsTest(phase: TrainingPhase): boolean {
  return phase === "base" || phase === "developpement" || phase === "specifique";
}

export interface TestCandidate {
  sport: TestSport;
  /** Aucune valeur de seuil connue : le test est prioritaire. */
  premier: boolean;
  /** Semaines écoulées depuis le dernier test, null si jamais testé. */
  semainesDepuis: number | null;
}

export interface SchedulingInputs {
  phase: TrainingPhase;
  weeksToGoal: number;
  /** Dernier test réalisé par discipline. */
  dernierTest: Partial<Record<TestSport, Date>>;
  /** Discipline dont le seuil est déjà connu, testé ou saisi. */
  seuilConnu: Record<TestSport, boolean>;
  /** Un test a-t-il déjà été programmé cette semaine ? */
  dejaProgrammeCetteSemaine: boolean;
  weekStart: Date;
}

/**
 * Choisit au plus un test par semaine. En programmer deux reviendrait à
 * remplacer la semaine d'entraînement par une semaine de tests, et fausserait
 * les deux résultats par la fatigue accumulée.
 */
export function chooseWeeklyTest(inputs: SchedulingInputs): TestProtocol | null {
  if (inputs.dejaProgrammeCetteSemaine) return null;
  if (!phaseAllowsTest(inputs.phase)) return null;

  // Trop près de l'objectif, on ne teste plus : on affûte.
  if (inputs.weeksToGoal >= 0 && inputs.weeksToGoal <= 3) return null;

  const candidats: TestCandidate[] = TEST_SPORTS.map((sport) => {
    const dernier = inputs.dernierTest[sport];
    const semainesDepuis = dernier
      ? Math.floor((inputs.weekStart.getTime() - dernier.getTime()) / (7 * 24 * 3600 * 1000))
      : null;
    return { sport, premier: !inputs.seuilConnu[sport], semainesDepuis };
  }).filter((c) => c.semainesDepuis === null || c.semainesDepuis >= TEST_INTERVAL_WEEKS);

  if (candidats.length === 0) return null;

  // Priorité à une discipline dont on ignore tout : ses zones sont, au mieux,
  // une estimation tirée d'un temps de référence ancien.
  const jamaisTestes = candidats.filter((c) => c.premier);
  const pool = jamaisTestes.length > 0 ? jamaisTestes : candidats;

  // À égalité, la discipline testée il y a le plus longtemps.
  const choisi = pool.reduce((meilleur, c) => {
    const a = c.semainesDepuis ?? Number.MAX_SAFE_INTEGER;
    const b = meilleur.semainesDepuis ?? Number.MAX_SAFE_INTEGER;
    return a > b ? c : meilleur;
  });

  return PROTOCOLS[choisi.sport];
}

/* ------------------------------------------------------------------ */
/* Exploitation des résultats                                          */
/* ------------------------------------------------------------------ */

export interface TestResult {
  /** Course : distance parcourue en 30 min, en mètres. */
  distanceM?: number | null;
  /** Vélo : puissance moyenne sur 20 min, en watts. */
  puissanceMoy?: number | null;
  /** Natation : temps sur 400 m et 200 m, en secondes. */
  temps400S?: number | null;
  temps200S?: number | null;
  /** Fréquence cardiaque moyenne relevée pendant l'effort. */
  fcMoyenne?: number | null;
}

export interface DerivedThresholds {
  seuilCourseSecParKm?: number;
  ftpWatts?: number;
  cssSecPer100m?: number;
  fcSeuil?: number;
  /** Phrase expliquant ce que le test a donné, montrée à l'athlète. */
  resume: string;
}

/**
 * Traduit un résultat de test en valeurs de seuil.
 *
 * Renvoie null si le résultat est inexploitable : mieux vaut ne rien mettre à
 * jour que de recalculer toutes les zones d'un athlète sur une saisie erronée.
 */
export function deriveThresholds(kind: string, result: TestResult): DerivedThresholds | null {
  /*
   * La fréquence au seuil ne se relève pas dans l'eau.
   *
   * Le protocole de natation ne la demande pas — allongé, refroidi, en apnée
   * partielle, un nageur a dix à quinze battements de moins qu'un coureur au
   * même effort. Le formulaire proposait pourtant le champ pour tous les
   * tests : une valeur saisie là aurait tiré vers le bas les zones cardiaques
   * des trois disciplines, puisque l'application n'en retient qu'une.
   */
  const fcExploitable = kind !== "natation_css";
  const fcSeuil =
    fcExploitable && result.fcMoyenne && result.fcMoyenne >= 100 && result.fcMoyenne <= 220
      ? Math.round(result.fcMoyenne)
      : undefined;

  if (kind === "course_30min") {
    const distance = result.distanceM;
    // Bornes larges : 3 km en 30 min est une marche rapide, 12 km un niveau
    // national. Au-delà, c'est une faute de saisie.
    if (!distance || distance < 3000 || distance > 12000) return null;

    // Un contre-la-montre de 30 minutes se court, par définition, très près du
    // seuil : son allure moyenne en est la meilleure estimation de terrain.
    const seuilCourseSecParKm = Math.round(1800 / (distance / 1000));
    return {
      seuilCourseSecParKm,
      fcSeuil,
      resume: `${(distance / 1000).toFixed(2)} km en 30 min, soit une allure au seuil de ${formatMinSec(seuilCourseSecParKm)}/km.`,
    };
  }

  if (kind === "velo_20min") {
    const puissance = result.puissanceMoy;
    if (!puissance || puissance < 60 || puissance > 600) return null;

    // La FTP est l'effort tenable une heure : environ 95 % de la puissance
    // tenue sur 20 minutes.
    const ftpWatts = Math.round(puissance * 0.95);
    return {
      ftpWatts,
      fcSeuil,
      resume: `${puissance} W sur 20 min, soit une FTP de ${ftpWatts} W.`,
    };
  }

  if (kind === "natation_css") {
    const t400 = result.temps400S;
    const t200 = result.temps200S;
    if (!t400 || !t200) return null;
    // Le 400 m doit être plus lent au 100 m que le 200 m, sinon le test est raté.
    if (t400 <= t200 || t400 - t200 < 60 || t400 - t200 > 400) return null;

    // Vitesse critique : CSS = (400 − 200) / (T400 − T200), soit en secondes
    // aux 100 m la moitié de l'écart entre les deux temps.
    const cssSecPer100m = Math.round((t400 - t200) / 2);
    return {
      cssSecPer100m,
      fcSeuil,
      resume: `400 m en ${formatMinSec(t400)} et 200 m en ${formatMinSec(t200)}, soit une CSS de ${formatMinSec(cssSecPer100m)}/100 m.`,
    };
  }

  return null;
}

function formatMinSec(secondes: number): string {
  const m = Math.floor(secondes / 60);
  const s = Math.round(secondes % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * Compare une nouvelle valeur de seuil à l'ancienne, pour dire à l'athlète ce
 * que le test a changé. C'est la partie que retient un athlète : savoir s'il
 * progresse.
 */
export function describeProgress(kind: string, avant: number | null, apres: number): string | null {
  if (!avant || avant === apres) return null;

  // Pour une allure, plus petit vaut mieux ; pour une puissance, l'inverse.
  const plusPetitEstMieux = kind !== "velo_20min";
  const ecart = ((apres - avant) / avant) * 100;
  const progresse = plusPetitEstMieux ? ecart < 0 : ecart > 0;
  const ampleur = Math.abs(ecart);

  if (ampleur < 1) return "Ton niveau est stable depuis le dernier test.";
  return progresse
    ? `Tu progresses : ${ampleur.toFixed(1)} % de mieux qu'au dernier test.`
    : `Léger recul de ${ampleur.toFixed(1)} % par rapport au dernier test. Fatigue, météo ou conditions du jour peuvent l'expliquer.`;
}
