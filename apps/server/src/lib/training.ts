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

/** "1h15", "1h15min", "45min", "48:30", "28 min", "1:05:30" */
function parseDuration(text: string): number | null {
  const hms = text.match(/(\d{1,2}):(\d{2}):(\d{2})/);
  if (hms) return Number(hms[1]) * 3600 + Number(hms[2]) * 60 + Number(hms[3]);

  const hoursMin = text.match(/(\d{1,2})\s*h\s*(\d{1,2})?/i);
  if (hoursMin) {
    const minutes = hoursMin[2] ? Number(hoursMin[2]) : 0;
    return Number(hoursMin[1]) * 3600 + minutes * 60;
  }

  const ms = text.match(/(\d{1,3}):(\d{2})(?!\d)/);
  if (ms) return Number(ms[1]) * 60 + Number(ms[2]);

  const minutes = text.match(/(\d{1,3})\s*(?:min|mn|')/i);
  if (minutes) return Number(minutes[1]) * 60;

  return null;
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
  const durationS = parseDuration(text);
  if (!distanceM || !durationS) return null;
  if (durationS < 30 || durationS > 24 * 3600) return null;
  return { distanceM, durationS };
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
}

export const ZONE_SPORTS = ["course", "natation", "velo"] as const;
export type ZoneSport = (typeof ZONE_SPORTS)[number];

/** Corrections manuelles : { course: { Z2: "5:30/km" }, ... }. */
export type ZoneOverrides = Partial<Record<ZoneSport, Record<string, string>>>;

export interface TrainingZones {
  course: ZoneRange[] | null;
  natation: ZoneRange[] | null;
  velo: ZoneRange[] | null;
  /** Explique d'où viennent les valeurs, pour l'affichage et pour le prompt. */
  notes: string[];
}

const RUN_ZONE_OFFSETS_S_PER_KM: { zone: string; label: string; offset: number }[] = [
  { zone: "Z1", label: "récupération", offset: 105 },
  { zone: "Z2", label: "endurance fondamentale", offset: 75 },
  { zone: "Z3", label: "tempo", offset: 35 },
  { zone: "Z4", label: "seuil", offset: 15 },
  { zone: "Z5", label: "VMA", offset: -15 },
];

const SWIM_ZONE_OFFSETS_S_PER_100M: { zone: string; label: string; offset: number }[] = [
  { zone: "Z1", label: "récupération", offset: 15 },
  { zone: "Z2", label: "endurance fondamentale", offset: 10 },
  { zone: "Z3", label: "tempo", offset: 5 },
  { zone: "Z4", label: "seuil (CSS)", offset: 0 },
  { zone: "Z5", label: "vitesse", offset: -5 },
];

const BIKE_ZONE_FTP_PCT: { zone: string; label: string; from: number; to: number }[] = [
  { zone: "Z1", label: "récupération", from: 0.4, to: 0.55 },
  { zone: "Z2", label: "endurance fondamentale", from: 0.56, to: 0.75 },
  { zone: "Z3", label: "tempo", from: 0.76, to: 0.9 },
  { zone: "Z4", label: "seuil", from: 0.91, to: 1.05 },
  { zone: "Z5", label: "PMA", from: 1.06, to: 1.2 },
];

export interface ZoneInputs {
  tempsCourse?: string | null;
  tempsNatation?: string | null;
  tempsVelo?: string | null;
  ftpWatts?: number | null;
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
  defs: { zone: string; label: string }[]
): ZoneRange[] | null {
  const manual = Object.entries(overrides ?? {}).filter(([, value]) => value.trim() !== "");
  if (manual.length === 0) return computed;

  const byZone = new Map(manual.map(([zone, value]) => [zone, value.trim()]));
  const base = computed ?? defs.map((d) => ({ zone: d.zone, label: d.label, value: "" }));

  const merged = base.map((range) =>
    byZone.has(range.zone)
      ? { ...range, value: byZone.get(range.zone)!, custom: true }
      : range
  );

  // Un sport sans aucune valeur reste absent plutôt qu'affiché vide.
  return merged.some((r) => r.value !== "") ? merged.filter((r) => r.value !== "") : null;
}

/**
 * Calcule les zones une bonne fois côté serveur, au lieu de demander au modèle
 * de refaire l'arithmétique à chaque génération (source d'incohérences d'une
 * semaine à l'autre).
 */
export function computeTrainingZones(inputs: ZoneInputs): TrainingZones {
  const notes: string[] = [];

  let course: ZoneRange[] | null = null;
  const runPerf = parsePerformance(inputs.tempsCourse);
  if (runPerf) {
    // Exposant 1.06 : valeur classique de Riegel pour la course à pied.
    const equivalent10k = riegelEquivalent(runPerf, 10_000, 1.06);
    const pace10k = equivalent10k / 10;
    course = RUN_ZONE_OFFSETS_S_PER_KM.map((z) => ({
      zone: z.zone,
      label: z.label,
      value: formatPacePerKm(pace10k + z.offset),
    }));
    notes.push(`Course : allures dérivées d'un 10 km équivalent en ${formatPacePerKm(pace10k)}.`);
  }

  let natation: ZoneRange[] | null = null;
  const swimPerf = parsePerformance(inputs.tempsNatation);
  if (swimPerf) {
    // Exposant 1.02 : la fatigue progresse plus lentement en natation.
    const equivalent1500 = riegelEquivalent(swimPerf, 1500, 1.02);
    const css = equivalent1500 / 15; // secondes par 100 m
    natation = SWIM_ZONE_OFFSETS_S_PER_100M.map((z) => ({
      zone: z.zone,
      label: z.label,
      value: formatPacePer100m(css + z.offset),
    }));
    notes.push(`Natation : CSS estimée à ${formatPacePer100m(css)}.`);
  }

  let velo: ZoneRange[] | null = null;
  if (inputs.ftpWatts && inputs.ftpWatts > 50) {
    const ftp = inputs.ftpWatts;
    velo = BIKE_ZONE_FTP_PCT.map((z) => ({
      zone: z.zone,
      label: z.label,
      value: `${Math.round(ftp * z.from)}-${Math.round(ftp * z.to)} W`,
    }));
    notes.push(`Vélo : zones de puissance calculées sur une FTP de ${ftp} W.`);
  } else {
    const bikePerf = parsePerformance(inputs.tempsVelo);
    if (bikePerf) {
      const speedKmh = (bikePerf.distanceM / 1000) / (bikePerf.durationS / 3600);
      velo = [
        { zone: "Z1", label: "récupération", value: `~${(speedKmh * 0.7).toFixed(1)} km/h` },
        { zone: "Z2", label: "endurance fondamentale", value: `~${(speedKmh * 0.82).toFixed(1)} km/h` },
        { zone: "Z3", label: "tempo", value: `~${(speedKmh * 0.92).toFixed(1)} km/h` },
        { zone: "Z4", label: "seuil", value: `~${speedKmh.toFixed(1)} km/h` },
        { zone: "Z5", label: "PMA", value: `> ${(speedKmh * 1.08).toFixed(1)} km/h` },
      ];
      notes.push(
        `Vélo : zones estimées à partir d'une vitesse de référence de ${speedKmh.toFixed(1)} km/h (renseignez votre FTP pour des zones de puissance).`
      );
    }
  }

  const overrides = inputs.overrides ?? {};
  course = applyOverrides(course, overrides.course, RUN_ZONE_OFFSETS_S_PER_KM);
  natation = applyOverrides(natation, overrides.natation, SWIM_ZONE_OFFSETS_S_PER_100M);
  velo = applyOverrides(velo, overrides.velo, BIKE_ZONE_FTP_PCT);

  const correctedSports = ZONE_SPORTS.filter((sport) =>
    ({ course, natation, velo })[sport]?.some((z) => z.custom)
  );
  if (correctedSports.length > 0) {
    notes.push(
      `Zones corrigées à la main pour : ${correctedSports.join(", ")}. Ces valeurs remplacent le calcul automatique.`
    );
  }

  if (!course && !natation && !velo) {
    notes.push("Aucun temps de référence exploitable : renseignez vos temps récents pour obtenir des zones chiffrées.");
  }

  return { course, natation, velo, notes };
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
  return lines.length ? lines.join("\n") : "Zones non calculables (temps de référence manquants ou non exploitables).";
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
