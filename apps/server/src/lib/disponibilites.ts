import { z } from "zod";
import { formatDate, weekDays } from "./week.js";

/**
 * Créneaux d'entraînement et matériel.
 *
 * C'était l'entrée qui manquait le plus : le profil ne disait qu'un nombre
 * d'heures par semaine. Le coach pouvait donc placer une sortie longue un mardi
 * soir de travail, ou de la natation alors que l'athlète n'a accès à aucun
 * bassin. Un programme irréalisable n'est pas suivi, et un programme non suivi
 * ne vaut rien.
 */

export const JOURS = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"] as const;
export type Jour = (typeof JOURS)[number];

export const MOMENTS = ["matin", "midi", "soir", "libre"] as const;
export type Moment = (typeof MOMENTS)[number];

export const LIBELLES_MOMENT: Record<Moment, string> = {
  matin: "le matin",
  midi: "le midi",
  soir: "le soir",
  libre: "à n'importe quelle heure",
};

export const jourSchema = z.object({
  disponible: z.boolean(),
  /** Durée maximale réaliste ce jour-là, en minutes. */
  dureeMaxMin: z.number().int().min(15).max(600).nullable().optional(),
  moment: z.enum(MOMENTS).optional().default("libre"),
});

export const disponibilitesSchema = z.record(z.enum(JOURS), jourSchema).nullable().optional();

/**
 * Type d'ENTRÉE et non de sortie : `moment` a une valeur par défaut, donc zod
 * le rend obligatoire en sortie. Ceux qui construisent des créneaux — le
 * client, les tests — doivent pouvoir l'omettre, et le code qui les lit écrit
 * déjà `moment ?? "libre"`.
 */
export type JourDisponible = z.input<typeof jourSchema>;
export type Disponibilites = Partial<Record<Jour, JourDisponible>>;

export const PISCINES = ["aucune", "25m", "50m", "eau_libre"] as const;
export const VELOS = ["route", "contre_la_montre", "vtt", "aucun"] as const;

export const materielSchema = z
  .object({
    homeTrainer: z.boolean().optional().default(false),
    capteurPuissance: z.boolean().optional().default(false),
    montreGps: z.boolean().optional().default(false),
    cardiofrequencemetre: z.boolean().optional().default(false),
    tapisCourse: z.boolean().optional().default(false),
    piscine: z.enum(PISCINES).optional().default("25m"),
    velo: z.enum(VELOS).optional().default("route"),
  })
  .nullable()
  .optional();

export type Materiel = NonNullable<NonNullable<z.infer<typeof materielSchema>>>;

/** Relit une valeur stockée en JSON, en écartant tout ce qui ne colle plus au schéma. */
export function parseDisponibilites(valeur: unknown): Disponibilites | null {
  const parsed = disponibilitesSchema.safeParse(valeur ?? null);
  return parsed.success && parsed.data ? (parsed.data as Disponibilites) : null;
}

export function parseMateriel(valeur: unknown): Materiel | null {
  const parsed = materielSchema.safeParse(valeur ?? null);
  return parsed.success && parsed.data ? (parsed.data as Materiel) : null;
}

/**
 * Les dates de la semaine où l'athlète a déclaré ne pas pouvoir s'entraîner.
 * Elles sont imposées comme jours de repos, sans quoi le modèle les remplirait.
 */
export function joursIndisponibles(disponibilites: Disponibilites | null, weekStart: Date): string[] {
  if (!disponibilites) return [];
  return weekDays(weekStart).filter((date, index) => disponibilites[JOURS[index]]?.disponible === false);
}

/**
 * Volume réellement atteignable dans la semaine, d'après les créneaux déclarés.
 * Il plafonne le volume autorisé : un athlète qui annonce dix heures mais n'a
 * que trois créneaux d'une heure n'en fera pas dix.
 */
export function volumeAtteignableMin(disponibilites: Disponibilites | null): number | null {
  if (!disponibilites) return null;

  let total = 0;
  let renseignes = 0;
  for (const jour of JOURS) {
    const creneau = disponibilites[jour];
    if (!creneau) continue;
    renseignes += 1;
    if (creneau.disponible && creneau.dureeMaxMin) total += creneau.dureeMaxMin;
  }

  // Sans durées saisies, on ne plafonne rien : mieux vaut pas de limite qu'une
  // limite fausse.
  return renseignes > 0 && total > 0 ? total : null;
}

export function disponibilitesPromptLines(
  disponibilites: Disponibilites | null,
  weekStart: Date
): string[] {
  if (!disponibilites) return [];

  const dates = weekDays(weekStart);
  const lignes: string[] = ["", "CRÉNEAUX D'ENTRAÎNEMENT DÉCLARÉS PAR L'ATHLÈTE (contrainte stricte) :"];

  for (const [index, jour] of JOURS.entries()) {
    const creneau = disponibilites[jour];
    if (!creneau) continue;

    if (!creneau.disponible) {
      lignes.push(`- ${dates[index]} (${jour}) : INDISPONIBLE. Cette date doit être une journée de repos (sport: repos, dureeMin: 0).`);
      continue;
    }

    const duree = creneau.dureeMaxMin ? `${creneau.dureeMaxMin} min maximum` : "durée libre";
    lignes.push(`- ${dates[index]} (${jour}) : disponible ${LIBELLES_MOMENT[creneau.moment ?? "libre"]}, ${duree}.`);
  }

  lignes.push(
    "Ne dépasse JAMAIS la durée indiquée pour un jour donné, et ne programme aucune séance un jour marqué indisponible. Une séance qu'il ne peut pas faire vaut moins que pas de séance du tout.",
    "Place la sortie longue sur le créneau le plus large de la semaine."
  );

  return lignes;
}

export function materielPromptLines(materiel: Materiel | null): string[] {
  if (!materiel) return [];

  const lignes: string[] = ["", "MATÉRIEL ET ACCÈS DE L'ATHLÈTE :"];

  if (materiel.piscine === "aucune") {
    lignes.push(
      "- Aucun accès à un bassin : NE PROGRAMME AUCUNE SÉANCE DE NATATION. Remplace-les par du renforcement du haut du corps (élastiques, gainage) et reporte le volume sur le vélo et la course."
    );
  } else if (materiel.piscine === "eau_libre") {
    lignes.push(
      "- Nage en eau libre : privilégie les efforts continus, les repères de nage en ligne droite et la respiration bilatérale plutôt que les séries chronométrées au mur. Les allures des zones valent déjà pour l'eau libre — ne les rends pas plus lentes une seconde fois."
    );
  } else {
    lignes.push(
      `- Bassin de ${materiel.piscine} : exprime les séries en longueurs de ce bassin (${materiel.piscine === "50m" ? "100 m = 2 longueurs" : "100 m = 4 longueurs"}), et les allures des zones valent pour ce bassin.`,
      "Si la course de l'athlète se nage en eau libre, rappelle-lui dans l'objectif d'une séance spécifique que son allure y sera plus lente d'environ 6 % : sans mur ni ligne d'eau, et avec les relevés de tête pour se diriger."
    );
  }

  if (materiel.velo === "aucun") {
    lignes.push("- Pas de vélo : ne programme aucune séance de vélo en extérieur. S'il n'a pas non plus de home-trainer, reporte ce volume sur la course et la natation.");
  } else if (materiel.velo === "vtt") {
    lignes.push("- VTT uniquement : les séances de vélo se font en tout-terrain, où l'allure moyenne ne veut rien dire. Prescris en durée et en sensation, pas en vitesse.");
  } else if (materiel.velo === "contre_la_montre") {
    lignes.push("- Vélo de contre-la-montre : prévois régulièrement du travail en position aérodynamique, qui se travaille spécifiquement.");
  }

  if (materiel.homeTrainer) {
    lignes.push("- Home-trainer disponible : les séances de vélo structurées (intervalles précis) peuvent s'y faire, quelle que soit la météo.");
  } else {
    lignes.push("- Pas de home-trainer : les séances de vélo se font dehors. Évite les intervalles très courts et très précis, difficiles à tenir dans la circulation.");
  }

  if (materiel.tapisCourse) lignes.push("- Tapis de course disponible.");
  if (!materiel.capteurPuissance) {
    lignes.push("- Pas de capteur de puissance : ne prescris jamais une séance de vélo en watts. Utilise la sensation, la fréquence cardiaque ou la cadence.");
  }
  if (!materiel.cardiofrequencemetre && !materiel.montreGps) {
    lignes.push("- Ni cardiofréquencemètre ni montre GPS : exprime l'intensité en sensation et en capacité à parler, pas en chiffres que l'athlète ne peut pas lire pendant l'effort.");
  }

  return lignes;
}

/** Dates de la semaine à forcer en repos, transmises au moment de la validation. */
export function datesDeReposImposees(disponibilites: Disponibilites | null, weekStart: Date): Set<string> {
  return new Set(joursIndisponibles(disponibilites, weekStart).map((d) => formatDate(new Date(`${d}T00:00:00.000Z`))));
}
