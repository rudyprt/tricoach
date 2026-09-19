/**
 * Logique d'entraînement pure : analyse des temps de référence, calcul des
 * zones et périodisation. Aucun accès base ni réseau, donc entièrement testable.
 */

export interface ParsedPerformance {
  /** Distance de référence, en mètres. */
  distanceM: number;
  /** Durée de référence, en secondes. */
  durationS: number;
}

const DISTANCE_RE = /(\d+(?:[.,]\d+)?)\s*(km|k|m)\b/i;

/**
 * Vitesses au-delà desquelles une lecture est forcément fausse, toutes
 * disciplines confondues : de la nage la plus lente au sprint cycliste. Elles
 * ne servent qu'à écarter l'absurde, jamais à juger un athlète.
 */
const VITESSE_MIN_MS = 0.3;
const VITESSE_MAX_MS = 20;

/**
 * Durées possibles pour un texte. Plusieurs, car « 1:45 » ne se lit pas seul :
 * c'est 1 min 45 s sur un 400 m, 1 h 45 sur un semi-marathon. La distance
 * tranche, et elle n'est connue qu'un cran plus haut.
 *
 * "1h15", "1h15min", "45min", "48:30", "28 min", "1:05:30"
 */
function dureesPossibles(text: string): number[] {
  const hms = text.match(/(\d{1,2}):(\d{2}):(\d{2})/);
  if (hms) return [Number(hms[1]) * 3600 + Number(hms[2]) * 60 + Number(hms[3])];

  const hoursMin = text.match(/(\d{1,2})\s*h\s*(\d{1,2})?/i);
  if (hoursMin) {
    const minutes = hoursMin[2] ? Number(hoursMin[2]) : 0;
    return [Number(hoursMin[1]) * 3600 + minutes * 60];
  }

  const ms = text.match(/(\d{1,3}):(\d{2})(?!\d)/);
  // La lecture en minutes d'abord : c'est la plus courante, et la seule
  // possible dès que le second nombre dépasse 59 minutes.
  if (ms) {
    const a = Number(ms[1]);
    const b = Number(ms[2]);
    return b < 60 ? [a * 60 + b, a * 3600 + b * 60] : [a * 60 + b];
  }

  const minutes = text.match(/(\d{1,3})\s*(?:min|mn|')/i);
  if (minutes) return [Number(minutes[1]) * 60];

  return [];
}

function parseDistance(text: string): number | null {
  const match = text.match(DISTANCE_RE);
  if (!match) return null;
  const value = Number(match[1].replace(",", "."));
  if (!Number.isFinite(value) || value <= 0) return null;
  const unit = match[2].toLowerCase();
  return unit === "m" ? value : value * 1000;
}

/**
 * Extrait distance + durée d'un temps de référence saisi en texte libre
 * ("1500m en 28min", "40km en 1h15", "10km en 45:30").
 */
export function parsePerformance(text: string | null | undefined): ParsedPerformance | null {
  if (!text) return null;
  const distanceM = parseDistance(text);
  if (!distanceM) return null;

  /*
   * Entre deux lectures d'un « 1:45 », celle qui donne une vitesse humaine.
   *
   * « 21km en 1:45 » était lu 1 min 45 s : 589 km/h, accepté sans broncher, et
   * l'athlète se retrouvait avec des zones à sept secondes au kilomètre. Une
   * allure impossible n'est pas une allure : elle disqualifie la lecture.
   */
  /*
   * Une allure saisie à la place d'un temps : « 42,2 km en 5:00/km ». Le
   * suffixe la désigne sans ambiguïté, et la distance permet d'en tirer le
   * temps total. Sans cette lecture, « 5:00 » passait pour cinq heures — un
   * marathon plausible, donc accepté, et pourtant faux d'une heure et demie.
   */
  const allure = text.match(/(\d{1,3})\s*:\s*(\d{2})\s*\/\s*(km|100\s?m)\b/i);
  if (allure) {
    const parUnite = Number(allure[1]) * 60 + Number(allure[2]);
    const unites = allure[3].toLowerCase().startsWith("km") ? distanceM / 1000 : distanceM / 100;
    const total = Math.round(parUnite * unites);
    const vitesse = distanceM / total;
    if (total >= 30 && total <= 24 * 3600 && vitesse >= VITESSE_MIN_MS && vitesse <= VITESSE_MAX_MS) {
      return { distanceM, durationS: total };
    }
    return null;
  }

  const candidates = dureesPossibles(text)
    .filter((d) => d >= 30 && d <= 24 * 3600)
    .filter((d) => {
      const vitesse = distanceM / d;
      return vitesse >= VITESSE_MIN_MS && vitesse <= VITESSE_MAX_MS;
    });

  if (candidates.length === 0) return null;
  return { distanceM, durationS: candidates[0] };
}

/**
 * Formule de Riegel : t2 = t1 * (d2/d1)^exposant. Permet de ramener n'importe
 * quel temps de référence à une distance étalon avant d'en déduire les zones.
 */
export function riegelEquivalent(perf: ParsedPerformance, targetDistanceM: number, exponent: number): number {
  return perf.durationS * Math.pow(targetDistanceM / perf.distanceM, exponent);
}

export function formatPacePerKm(secondsPerKm: number): string {
  const total = Math.round(secondsPerKm);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}/km`;
}

export function formatPacePer100m(secondsPer100m: number): string {
  const total = Math.round(secondsPer100m);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}/100m`;
}

export interface ZoneRange {
  zone: string;
  label: string;
  value: string;
  /** true si la valeur a été saisie par l'athlète et non calculée. */
  custom?: boolean;
  /**
   * Fréquence cardiaque de la même zone, quand elle est connue. Deuxième
   * repère et non second jeu de zones : l'allure se tient, la fréquence se
   * constate — elle retarde en début d'effort et dérive à la chaleur.
   */
  fc?: string;
}

export const ZONE_SPORTS = ["course", "natation", "velo"] as const;
export type ZoneSport = (typeof ZONE_SPORTS)[number];

/** Corrections manuelles : { course: { Z2: "5:30/km" }, ... }. */
export type ZoneOverrides = Partial<Record<ZoneSport, Record<string, string>>>;

export interface TrainingZones {
  course: ZoneRange[] | null;
  natation: ZoneRange[] | null;
  velo: ZoneRange[] | null;
  /**
   * Repères de vitesse à vélo, quand ni la puissance ni la fréquence
   * cardiaque ne sont connues. Séparés des zones de puissance : ce ne sont pas
   * les mêmes valeurs, et ce ne sont pas les mêmes garanties.
   */
  veloVitesse: ZoneRange[] | null;
  /** Zones de fréquence cardiaque, communes aux trois disciplines. */
  frequenceCardiaque: ZoneRange[] | null;
  /** Explique d'où viennent les valeurs, pour l'affichage et pour le prompt. */
  notes: string[];
}

/* ------------------------------------------------------------------ */
/* Modèle de zones                                                     */
/* ------------------------------------------------------------------ */

/**
 * Les zones sont exprimées en fraction de la vitesse (ou de la puissance) au
 * seuil, et non par des écarts fixes en secondes par kilomètre.
 *
 * C'est la différence entre un modèle juste et un modèle faux : avec des
 * écarts fixes, « allure 10 km + 75 s » représente +19 % pour un coureur à
 * 6:30/km mais +40 % pour un coureur à 3:06/km. Le débutant se retrouvait avec
 * une endurance fondamentale bien trop rapide — or c'est exactement lui qui
 * court déjà trop vite à l'entraînement.
 */
interface ZoneBand {
  zone: string;
  label: string;
  /** Borne basse, en fraction de la valeur au seuil. */
  from: number;
  /** Borne haute, en fraction de la valeur au seuil. */
  to: number;
}

/** Course à pied : fractions de la vitesse au seuil (VMA anaérobie exclue). */
/**
 * Bornes calées sur les tables de Jack Daniels, rapportées à la vitesse au
 * seuil plutôt qu'au VDOT.
 *
 * La version précédente plaçait l'endurance fondamentale entre 80 et 88 % de
 * la vitesse au seuil, soit 4:42–5:10/km pour un seuil à 4:08 — quand Daniels
 * donne 5:07–5:39 pour le même coureur. Cette zone recouvrait donc l'allure
 * marathon : l'athlète courait ses sorties faciles bien trop vite, ce qui est
 * précisément le défaut que ce modèle devait corriger.
 */
const RUN_BANDS: ZoneBand[] = [
  { zone: "Z1", label: "récupération", from: 0.65, to: 0.74 },
  // « Easy » chez Daniels : l'allure des quatre cinquièmes du volume.
  { zone: "Z2", label: "endurance fondamentale", from: 0.74, to: 0.84 },
  // Englobe l'allure marathon, à 94 % environ de la vitesse au seuil.
  { zone: "Z3", label: "tempo", from: 0.84, to: 0.95 },
  { zone: "Z4", label: "seuil", from: 0.95, to: 1.03 },
  { zone: "Z5", label: "VO2max", from: 1.03, to: 1.15 },
];

/**
 * Natation : les zones sont bien plus resserrées qu'en course. L'eau impose
 * une résistance qui croît avec le carré de la vitesse, si bien qu'un écart de
 * quelques secondes aux 100 m change radicalement l'effort.
 */
const SWIM_BANDS: ZoneBand[] = [
  { zone: "Z1", label: "récupération", from: 0.85, to: 0.9 },
  { zone: "Z2", label: "endurance fondamentale", from: 0.9, to: 0.95 },
  { zone: "Z3", label: "tempo", from: 0.95, to: 0.98 },
  { zone: "Z4", label: "seuil (CSS)", from: 0.98, to: 1.02 },
  { zone: "Z5", label: "vitesse", from: 1.02, to: 1.1 },
];

/** Vélo : pourcentages de FTP, selon le découpage de référence de Coggan. */
/**
 * Zones de puissance de Coggan, en fraction de la FTP.
 *
 * Bornes rendues jointives : Coggan les publie en pourcentages entiers —
 * « Z2 : 56 à 75 %, Z3 : 76 à 90 % » — ce qui, converti en watts, laissait des
 * trous. Un cycliste roulant à 187 W avec une FTP de 248 n'était dans aucune
 * zone, alors que 186 et 188 en avaient une.
 */
const BIKE_BANDS: ZoneBand[] = [
  { zone: "Z1", label: "récupération", from: 0.4, to: 0.55 },
  { zone: "Z2", label: "endurance fondamentale", from: 0.55, to: 0.75 },
  { zone: "Z3", label: "tempo", from: 0.75, to: 0.9 },
  { zone: "Z4", label: "seuil", from: 0.9, to: 1.05 },
  { zone: "Z5", label: "PMA", from: 1.05, to: 1.2 },
];

/**
 * Zones de fréquence cardiaque du modèle Joe Friel à cinq zones, en pourcentage
 * de la fréquence cardiaque au seuil.
 *
 * La version précédente transposait les tables détaillées de Friel, écrites en
 * pourcentages entiers — « Z3 : 90 à 93 %, Z4 : 94 à 99 % » — ce qui laissait
 * des battements orphelins une fois converti, et plaçait le seuil lui-même
 * hors de la zone qui porte son nom. Ce découpage-ci est jointif, et sa
 * quatrième zone encadre le seuil.
 */
const HR_BANDS: ZoneBand[] = [
  { zone: "Z1", label: "récupération", from: 0.65, to: 0.85 },
  { zone: "Z2", label: "endurance fondamentale", from: 0.85, to: 0.9 },
  { zone: "Z3", label: "tempo", from: 0.9, to: 0.95 },
  { zone: "Z4", label: "seuil", from: 0.95, to: 1.02 },
  // Friel n'assigne pas de plafond à la cinquième zone. Faute de fréquence
  // cardiaque maximale connue, on s'arrête un peu au-dessus du seuil : mieux
  // vaut une borne prudente qu'un intervalle ouvert sur une valeur
  // qu'aucun athlète n'atteindra.
  { zone: "Z5", label: "VO2max", from: 1.02, to: 1.06 },
];

/**
 * Vitesse soutenable pendant `targetS` secondes, déduite d'une performance de
 * référence par la formule de Riegel.
 *
 * Le seuil correspond à l'effort tenable environ une heure en course, environ
 * trente minutes en natation : on résout donc Riegel pour cette durée plutôt
 * que de ramener à une distance étalon arbitraire.
 */
export function thresholdSpeed(perf: ParsedPerformance, targetS: number, exponent: number): number {
  const distance = perf.distanceM * Math.pow(targetS / perf.durationS, 1 / exponent);
  return distance / targetS;
}

/** Plage d'allure, de la plus rapide à la plus lente, unité mentionnée une fois. */
function formatPaceBand(thresholdSpeedMs: number, band: ZoneBand, per: 1000 | 100): string {
  // Une fraction de vitesse basse correspond à une allure lente : les bornes
  // s'inversent au passage de la vitesse à l'allure.
  const lent = per / (thresholdSpeedMs * band.from);
  const rapide = per / (thresholdSpeedMs * band.to);
  const unite = per === 1000 ? "/km" : "/100m";
  const fmt = (v: number) => (per === 1000 ? formatPacePerKm(v) : formatPacePer100m(v)).replace(unite, "");
  return `${fmt(rapide)}–${fmt(lent)}${unite}`;
}

/**
 * Une fraction de puissance ne se transpose pas telle quelle en fraction de
 * vitesse : sur le plat, la puissance croît à peu près comme le cube de la
 * vitesse. Rouler à 55 % de sa FTP, ce n'est pas rouler à 55 % de sa vitesse
 * au seuil, mais à 82 % — appliquer les pourcentages de Coggan directement à
 * des km/h donnerait des zones basses absurdement lentes.
 *
 * L'approximation vaut sur terrain plat et sans vent, ce que la note qui
 * accompagne ces zones rappelle à l'athlète.
 */
function formatSpeedBand(thresholdSpeedMs: number, band: ZoneBand): string {
  const kmh = (fraction: number) => Math.round(thresholdSpeedMs * Math.cbrt(fraction) * 3.6);
  return `${kmh(band.from)}–${kmh(band.to)} km/h`;
}

function formatWattBand(ftp: number, band: ZoneBand): string {
  return `${Math.round(ftp * band.from)}–${Math.round(ftp * band.to)} W`;
}

function formatHrBand(lthr: number, band: ZoneBand, fcMax?: number | null): string {
  const bas = Math.round(lthr * band.from);
  // La zone haute n'a pas de plafond chez Friel : quand la fréquence cardiaque
  // maximale est connue, c'est elle la vraie borne, et elle est plus parlante
  // qu'un pourcentage arbitraire.
  const haut = band.zone === "Z5" && fcMax && fcMax > bas ? fcMax : Math.round(lthr * band.to);
  return `${bas}–${haut} bpm`;
}

/* ------------------------------------------------------------------ */
/* Calcul des zones                                                    */
/* ------------------------------------------------------------------ */

export interface ZoneInputs {
  tempsCourse?: string | null;
  tempsNatation?: string | null;
  tempsVelo?: string | null;
  /** Puissance au seuil, si l'athlète la connaît. */
  ftpWatts?: number | null;
  /** Allure au seuil en course, en secondes par kilomètre, si elle est connue. */
  seuilCourseSecParKm?: number | null;
  /** Vitesse critique en natation, en secondes aux 100 m, si elle est connue. */
  cssSecPer100m?: number | null;
  /**
   * Où l'athlète nage : "25m", "50m" ou "eau_libre". À effort égal, le temps
   * aux 100 m dépend du bassin, et une allure cible calculée pour l'un est
   * inatteignable dans l'autre.
   */
  bassin?: string | null;
  /** Fréquence cardiaque au seuil. */
  fcSeuil?: number | null;
  /** Fréquence cardiaque maximale observée ou testée. */
  fcMax?: number | null;
  /** Corrections saisies par l'athlète, prioritaires sur le calcul. */
  overrides?: ZoneOverrides | null;
}

/**
 * Une correction manuelle remplace la valeur calculée, et peut aussi exister
 * pour un sport dont aucun temps de référence n'est exploitable : un athlète
 * qui connaît déjà ses allures doit pouvoir les saisir sans passer par une
 * course de référence.
 */
function applyOverrides(
  computed: ZoneRange[] | null,
  overrides: Record<string, string> | undefined,
  bands: ZoneBand[]
): ZoneRange[] | null {
  const manual = Object.entries(overrides ?? {}).filter(([, value]) => value.trim() !== "");
  if (manual.length === 0) return computed;

  const byZone = new Map(manual.map(([zone, value]) => [zone, value.trim()]));
  const base = computed ?? bands.map((b) => ({ zone: b.zone, label: b.label, value: "" }));

  const merged = base.map((range) =>
    byZone.has(range.zone) ? { ...range, value: byZone.get(range.zone)!, custom: true } : range
  );

  // Un sport sans aucune valeur reste absent plutôt qu'affiché vide.
  return merged.some((r) => r.value !== "") ? merged.filter((r) => r.value !== "") : null;
}

/**
 * Calcule les zones une bonne fois côté serveur, au lieu de demander au modèle
 * de refaire l'arithmétique à chaque génération (source d'incohérences d'une
 * semaine à l'autre).
 *
 * Priorité des sources : une valeur de seuil saisie par l'athlète l'emporte sur
 * une estimation tirée d'un temps de référence, qui l'emporte sur rien.
 */
/**
 * Écart de temps aux 100 m selon le milieu, à effort égal.
 *
 * Un virage tous les 25 m offre une poussée au mur et quelques mètres en
 * coulée : on y nage environ une seconde et demie plus vite aux 100 m qu'en
 * 50 m. En eau libre il n'y a ni mur ni ligne d'eau, il faut relever la tête
 * pour se diriger et la vague freine — l'écart atteint couramment 6 %.
 *
 * Ces coefficients ne corrigent PAS la valeur mesurée : une CSS chronométrée
 * dans un bassin de 50 m est déjà une valeur 50 m, la décaler une seconde fois
 * la fausserait. Ils servent à convertir d'un milieu vers un autre, ce dont un
 * triathlète a besoin — il s'entraîne en bassin et court en eau libre.
 *
 * Ordres de grandeur, pas constantes physiques : l'écart réel dépend de la
 * qualité des virages, de la combinaison et de l'état de l'eau.
 */
const VITESSE_RELATIVE: Record<string, number> = {
  "25m": 1,
  "50m": 0.985,
  eau_libre: 0.94,
};

const LIBELLES_MILIEU: Record<string, string> = {
  "25m": "bassin de 25 m",
  "50m": "bassin de 50 m",
  eau_libre: "eau libre",
};

/**
 * Équivalences du temps au seuil dans les autres milieux. C'est ce qu'un coach
 * annonce : « ta CSS est de 1:44 ; vise 1:46 en 50 m, 1:51 en eau libre ».
 */
export function equivalencesNatation(secPer100m: number, milieu: string): string | null {
  const base = VITESSE_RELATIVE[milieu];
  if (!base) return null;

  const autres = Object.keys(VITESSE_RELATIVE)
    .filter((m) => m !== milieu)
    .map((m) => {
      // Un milieu plus lent allonge le temps dans le rapport inverse des vitesses.
      const temps = secPer100m * (base / VITESSE_RELATIVE[m]);
      return `${formatPacePer100m(temps)} en ${LIBELLES_MILIEU[m]}`;
    });

  return `Équivalences à effort égal : ${autres.join(", ")}.`;
}

export function computeTrainingZones(inputs: ZoneInputs): TrainingZones {
  const notes: string[] = [];

  /* --- Course à pied ------------------------------------------------ */
  let course: ZoneRange[] | null = null;
  let vitesseSeuilCourse: number | null = null;

  if (inputs.seuilCourseSecParKm && inputs.seuilCourseSecParKm > 120) {
    vitesseSeuilCourse = 1000 / inputs.seuilCourseSecParKm;
    notes.push(`Course : allure au seuil renseignée (${formatPacePerKm(inputs.seuilCourseSecParKm)}).`);
  } else {
    const perf = parsePerformance(inputs.tempsCourse);
    if (perf) {
      // Exposant 1.06 : valeur classique de Riegel pour la course à pied.
      // Le seuil correspond à l'effort tenable une heure.
      const estimee = thresholdSpeed(perf, 3600, 1.06);
      const allure = 1000 / estimee;
      /*
       * Une estimation reste une déduction : elle peut sortir du domaine
       * humain si le temps saisi a été mal compris. Mieux vaut alors ne rien
       * afficher et le dire, plutôt que des zones à sept secondes au kilomètre
       * que l'athlète prendra pour une panne de l'application.
       */
      if (allure >= 120 && allure <= 900) {
        vitesseSeuilCourse = estimee;
        notes.push(`Course : seuil estimé à ${formatPacePerKm(allure)} à partir de votre temps de référence.`);
      } else {
        notes.push(
          "Course : votre temps de référence n'a pas pu être interprété. Réécrivez-le sous la forme « 10 km en 50:00 » ou « 21,1 km en 1h45 »."
        );
      }
    }
  }

  if (vitesseSeuilCourse) {
    course = RUN_BANDS.map((b) => ({
      zone: b.zone,
      label: b.label,
      value: formatPaceBand(vitesseSeuilCourse!, b, 1000),
    }));
  }

  /* --- Natation ----------------------------------------------------- */
  let natation: ZoneRange[] | null = null;
  let vitesseCss: number | null = null;

  if (inputs.cssSecPer100m && inputs.cssSecPer100m > 40) {
    vitesseCss = 100 / inputs.cssSecPer100m;
    notes.push(`Natation : CSS renseignée (${formatPacePer100m(inputs.cssSecPer100m)}).`);
  } else {
    const perf = parsePerformance(inputs.tempsNatation);
    if (perf) {
      // Exposant 1.03 : la fatigue progresse plus lentement en natation.
      // La CSS correspond à l'effort tenable environ trente minutes.
      const estimee = thresholdSpeed(perf, 1800, 1.03);
      const cent = 100 / estimee;
      // Même garde qu'en course : de 50 s à 5 min aux 100 m, au-delà la
      // lecture du temps de référence est en cause, pas le nageur.
      if (cent >= 50 && cent <= 300) {
        vitesseCss = estimee;
        notes.push(`Natation : CSS estimée à ${formatPacePer100m(cent)}.`);
      } else {
        notes.push(
          "Natation : votre temps de référence n'a pas pu être interprété. Réécrivez-le sous la forme « 400 m en 7:30 »."
        );
      }
    }
  }

  if (vitesseCss) {
    // Les zones valent pour le milieu où l'athlète nage, puisque c'est là qu'il
    // a mesuré son niveau. Les autres milieux sont donnés en équivalence, sans
    // quoi il croirait régresser le jour où il nage en eau libre.
    const milieu = inputs.bassin ?? "";
    if (LIBELLES_MILIEU[milieu]) {
      notes.push(`Natation : zones valables en ${LIBELLES_MILIEU[milieu]}, où vous vous entraînez.`);
      const equivalences = equivalencesNatation(100 / vitesseCss, milieu);
      if (equivalences) notes.push(`Natation. ${equivalences}`);
    }

    natation = SWIM_BANDS.map((b) => ({
      zone: b.zone,
      label: b.label,
      value: formatPaceBand(vitesseCss!, b, 100),
    }));
  }

  /* --- Vélo --------------------------------------------------------- */
  let velo: ZoneRange[] | null = null;
  let veloVitesse: ZoneRange[] | null = null;

  if (inputs.ftpWatts && inputs.ftpWatts > 50) {
    velo = BIKE_BANDS.map((b) => ({
      zone: b.zone,
      label: b.label,
      value: formatWattBand(inputs.ftpWatts!, b),
    }));
    notes.push(`Vélo : zones de puissance calculées sur une FTP de ${inputs.ftpWatts} W.`);
  } else {
    // Aucune zone de puissance n'est inventée : sans capteur, l'athlète ne
    // pourrait pas les lire. L'intensité passe par la fréquence cardiaque quand
    // elle est connue, sinon par la vitesse — utile, mais à relativiser, car à
    // effort égal elle varie du simple au double selon la pente et le vent.
    notes.push(
      inputs.fcSeuil || inputs.fcMax
        ? "Vélo : sans FTP, l'intensité est donnée par la fréquence cardiaque. Une vitesse en km/h peut servir de repère, mais seulement sur terrain plat et sans vent."
        : "Vélo : sans FTP ni fréquence cardiaque, l'intensité est donnée par la vitesse et la sensation. La vitesse ne vaut que sur terrain plat et sans vent — en côte ou face au vent, fiez-vous à votre respiration."
    );
    notes.push(
      "Renseignez votre FTP, ou faites un test de 20 minutes (FTP ≈ 95 % de la puissance moyenne), pour des zones vélo exactes."
    );

    /*
     * Des repères chiffrés, plutôt qu'une phrase qui promet des km/h sans en
     * donner aucun. L'athlète lisait « votre intensité se donne en km/h » et ne
     * voyait pas un seul chiffre : la consigne était inapplicable.
     */
    const perf = parsePerformance(inputs.tempsVelo);
    if (perf) {
      // Exposant 1.04 : la dérive est plus faible qu'en course, l'effort étant
      // porté par la machine. Le seuil reste l'effort tenable une heure.
      const estimee = thresholdSpeed(perf, 3600, 1.04);
      const kmh = estimee * 3.6;
      // De 15 à 55 km/h au seuil : au-delà, c'est le temps saisi qui est en
      // cause, pas le cycliste.
      if (kmh >= 15 && kmh <= 55) {
        veloVitesse = BIKE_BANDS.map((b) => ({
          zone: b.zone,
          label: b.label,
          value: formatSpeedBand(estimee, b),
        }));
        notes.push(
          `Vélo : vitesse au seuil estimée à ${Math.round(kmh)} km/h à partir de votre temps de référence. Ces repères ne valent que sur terrain plat et sans vent.`
        );
      }
    }
  }

  /* --- Fréquence cardiaque ------------------------------------------ */
  let frequenceCardiaque: ZoneRange[] | null = null;
  let seuilFc: number | null = null;

  if (inputs.fcSeuil && inputs.fcSeuil > 100) {
    seuilFc = inputs.fcSeuil;
    notes.push(
      `Fréquence cardiaque : zones du modèle Joe Friel, calculées sur une FC au seuil de ${seuilFc} bpm.`
    );
  } else if (inputs.fcMax && inputs.fcMax > 120) {
    // Approximation usuelle en l'absence de test de seuil. Signalée comme telle :
    // la FC au seuil varie sensiblement d'un athlète à l'autre.
    seuilFc = Math.round(inputs.fcMax * 0.92);
    notes.push(
      `Fréquence cardiaque : FC au seuil estimée à ${seuilFc} bpm (92 % de votre FC max de ${inputs.fcMax}). Un test de 30 minutes donnerait une valeur plus juste.`
    );
  }

  if (seuilFc) {
    frequenceCardiaque = HR_BANDS.map((b) => ({
      zone: b.zone,
      label: b.label,
      value: formatHrBand(seuilFc!, b, inputs.fcMax),
    }));
    // Dit quel que soit le chemin suivi : le malentendu est de lire ce tableau
    // comme un second jeu de zones qui devrait coïncider avec les allures.
    notes.push(
      "La fréquence cardiaque retarde sur l'allure : au départ d'un bloc au seuil, elle met une à deux minutes à monter, et elle dérive à la chaleur ou en fin de séance. C'est un repère de contrôle, pas une seconde vérité — sur un effort court, fiez-vous à l'allure."
    );
  }

  /* --- Corrections manuelles ---------------------------------------- */
  const overrides = inputs.overrides ?? {};
  course = applyOverrides(course, overrides.course, RUN_BANDS);
  natation = applyOverrides(natation, overrides.natation, SWIM_BANDS);
  velo = applyOverrides(velo, overrides.velo, BIKE_BANDS);

  /*
   * La fréquence cardiaque en regard de chaque zone d'allure.
   *
   * Les deux repères se complètent : l'allure est ce que l'athlète vise, la
   * fréquence ce qu'il vérifie. Les afficher côte à côte dans le tableau des
   * zones est utile ; les mélanger dans une cible de séance ne l'est pas, et
   * les cibles continuent de ne porter qu'une seule valeur.
   */
  const fcParZone = new Map((frequenceCardiaque ?? []).map((z) => [z.zone, z.value]));
  const avecFc = (ranges: ZoneRange[] | null): ZoneRange[] | null =>
    ranges?.map((z) => (fcParZone.has(z.zone) ? { ...z, fc: fcParZone.get(z.zone) } : z)) ?? null;

  course = avecFc(course);
  natation = avecFc(natation);
  velo = avecFc(velo);
  veloVitesse = avecFc(veloVitesse);

  const corriges = ZONE_SPORTS.filter((sport) => ({ course, natation, velo })[sport]?.some((z) => z.custom));
  if (corriges.length > 0) {
    notes.push(
      `Zones corrigées à la main pour : ${corriges.join(", ")}. Ces valeurs remplacent le calcul automatique.`
    );
  }

  if (!course && !natation && !velo && !veloVitesse && !frequenceCardiaque) {
    notes.push(
      "Aucune donnée exploitable : renseignez un temps de référence, votre FTP ou votre FC au seuil pour obtenir des zones chiffrées."
    );
  }

  return { course, natation, velo, veloVitesse, frequenceCardiaque, notes };
}

export function formatZonesForPrompt(zones: TrainingZones): string {
  const lines: string[] = [];
  const push = (sport: string, ranges: ZoneRange[] | null) => {
    if (!ranges) return;
    lines.push(
      `${sport} : ${ranges
        // Une zone corrigée par l'athlète est signalée : c'est sa connaissance de
        // lui-même, elle prime sur toute estimation que le modèle referait.
        .map((z) => `${z.zone} ${z.label} ${z.value}${z.custom ? " (valeur fixée par l'athlète)" : ""}`)
        .join(" | ")}`
    );
  };
  push("Course à pied", zones.course);
  push("Natation", zones.natation);
  push("Vélo", zones.velo);
  // Le coach recevait la consigne d'écrire des km/h sans qu'aucune vitesse ne
  // lui soit donnée : il les inventait, et elles ne correspondaient à rien.
  if (!zones.velo) push("Vélo (vitesse estimée, terrain plat)", zones.veloVitesse);
  push("Fréquence cardiaque", zones.frequenceCardiaque);

  if (!zones.velo) {
    lines.push(
      zones.frequenceCardiaque
        ? "Vélo : aucune zone de puissance (FTP non renseignée). Prescris l'intensité vélo par la FRÉQUENCE CARDIAQUE, en reprenant les zones ci-dessus. Tu peux ajouter une vitesse indicative en km/h, mais préviens alors que ce repère ne vaut que sur terrain plat et sans vent : à même vitesse, une côte ou un vent de face changent complètement l'effort."
        : "Vélo : ni puissance ni fréquence cardiaque disponibles. Prescris l'intensité vélo par une VITESSE en km/h accompagnée de la sensation (capacité à parler), en précisant que la vitesse ne vaut que sur terrain plat et sans vent, ou sur home-trainer. N'invente jamais de watts : l'athlète n'a pas de capteur pour les lire."
    );
  }

  return lines.length
    ? lines.join("\n")
    : "Zones non calculables (temps de référence manquants ou non exploitables).";
}

export type TrainingPhase = "base" | "developpement" | "specifique" | "affutage" | "course" | "transition";

export interface Periodization {
  phase: TrainingPhase;
  label: string;
  weeksToGoal: number;
  /** Coefficient à appliquer au volume de référence pour cette phase. */
  volumeFactor: number;
  /** Consigne injectée dans le prompt système. */
  guidance: string;
}

const PHASE_LABELS: Record<TrainingPhase, string> = {
  base: "Fondation aérobie",
  developpement: "Développement",
  specifique: "Spécifique course",
  affutage: "Affûtage",
  course: "Semaine de course",
  transition: "Transition",
};

/**
 * Nombre de semaines pleines entre le lundi de la semaine générée et l'objectif.
 * 0 = l'objectif tombe dans la semaine générée.
 */
export function weeksToGoal(weekStart: Date, goalDate: Date): number {
  const msPerWeek = 7 * 24 * 3600 * 1000;
  const goalWeekStart = new Date(goalDate);
  goalWeekStart.setUTCHours(0, 0, 0, 0);
  const day = goalWeekStart.getUTCDay();
  goalWeekStart.setUTCDate(goalWeekStart.getUTCDate() + ((day === 0 ? -6 : 1) - day));
  return Math.round((goalWeekStart.getTime() - weekStart.getTime()) / msPerWeek);
}

/**
 * Sans plan macro, le modèle produit une suite de semaines interchangeables :
 * ni bloc de construction, ni affûtage avant la course. On lui impose donc la
 * phase et le facteur de volume correspondant.
 */
export function periodization(weekStart: Date, goalDate: Date): Periodization {
  const weeks = weeksToGoal(weekStart, goalDate);

  if (weeks < 0) {
    return {
      phase: "transition",
      label: PHASE_LABELS.transition,
      weeksToGoal: weeks,
      volumeFactor: 0.7,
      guidance:
        "L'objectif est passé : semaine de transition. Volume réduit, intensité basse, récupération active et retour progressif. Invite l'athlète à définir un nouvel objectif.",
    };
  }
  if (weeks === 0) {
    return {
      phase: "course",
      label: PHASE_LABELS.course,
      weeksToGoal: weeks,
      volumeFactor: 0.4,
      guidance:
        "L'objectif a lieu cette semaine : volume très réduit, quelques rappels d'intensité courts (30s à 2min), repos complet la veille, et la séance du jour J correspond à la course elle-même.",
    };
  }
  if (weeks <= 2) {
    return {
      phase: "affutage",
      label: PHASE_LABELS.affutage,
      weeksToGoal: weeks,
      volumeFactor: 0.65,
      guidance:
        "Phase d'affûtage : réduis nettement le volume (environ -35%) en conservant l'intensité spécifique sur des séries courtes. Objectif : arriver frais, surtout pas construire de la forme.",
    };
  }
  if (weeks <= 6) {
    return {
      phase: "specifique",
      label: PHASE_LABELS.specifique,
      weeksToGoal: weeks,
      volumeFactor: 1,
      guidance:
        "Phase spécifique : les séances clés reproduisent les conditions de course (allure cible, enchaînement vélo-course, nutrition). Volume stable, intensité au seuil et à l'allure de course.",
    };
  }
  if (weeks <= 12) {
    return {
      phase: "developpement",
      label: PHASE_LABELS.developpement,
      weeksToGoal: weeks,
      volumeFactor: 1,
      guidance:
        "Phase de développement : introduis du travail au seuil et à VMA/PMA, augmente progressivement la charge. Prévois une semaine allégée toutes les 4 semaines environ.",
    };
  }
  return {
    phase: "base",
    label: PHASE_LABELS.base,
    weeksToGoal: weeks,
    volumeFactor: 1,
    guidance:
      "Phase de fondation aérobie : priorité au volume en endurance fondamentale (Z2), à la technique (natation surtout) et au renforcement. Intensité élevée limitée à une séance par semaine.",
  };
}
