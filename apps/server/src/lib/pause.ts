import { prisma } from "./prisma.js";
import { addDays } from "./week.js";

export const RAISONS_PAUSE = ["blessure", "maladie", "indisponibilite"] as const;
export type RaisonPause = (typeof RAISONS_PAUSE)[number];

export const LIBELLES_PAUSE: Record<RaisonPause, string> = {
  blessure: "blessure",
  maladie: "maladie",
  indisponibilite: "indisponibilité",
};

export interface PauseEnregistree {
  id: string;
  raison: string;
  detail: string;
  debut: Date;
  finPrevue: Date | null;
  finReelle: Date | null;
}

/** La pause en cours, s'il y en a une. */
export async function pauseEnCours(userId: string): Promise<PauseEnregistree | null> {
  return prisma.trainingPause.findFirst({
    where: { userId, finReelle: null },
    orderBy: { debut: "desc" },
    select: { id: true, raison: true, detail: true, debut: true, finPrevue: true, finReelle: true },
  });
}

/**
 * Durée d'une interruption, en jours pleins. Une interruption d'un jour ne
 * change rien à la condition physique : ce sont les semaines qui comptent.
 */
export function joursInterrompus(pause: { debut: Date; finReelle: Date | null }, maintenant: Date): number {
  const fin = pause.finReelle ?? maintenant;
  return Math.max(0, Math.floor((fin.getTime() - pause.debut.getTime()) / 86400000));
}

/**
 * Nombre de semaines de reprise progressive après une interruption.
 *
 * Règle de terrain : à peu près une semaine de remise en route par semaine
 * d'arrêt, plafonnée à quatre. Au-delà d'un mois d'arrêt, ce n'est plus une
 * reprise, c'est une nouvelle période de base — que la périodisation gère déjà.
 */
export function semainesDeReprise(joursArret: number): number {
  if (joursArret < 7) return 0;
  return Math.min(4, Math.ceil(joursArret / 7));
}

export interface Reprise {
  /** Rang de la semaine de reprise, 1 = première semaine après l'arrêt. */
  semaine: number;
  total: number;
  /** Facteur appliqué au volume maximal autorisé. */
  facteurVolume: number;
  joursArret: number;
  raison: string;
}

/**
 * Où en est l'athlète dans sa reprise, au début de la semaine donnée.
 *
 * Le volume repart à la moitié de ce qu'il était et remonte par paliers. C'est
 * volontairement prudent : reprendre trop vite après un arrêt est la première
 * cause de re-blessure, et une semaine trop facile ne coûte rien.
 */
export function etatDeReprise(
  pause: { debut: Date; finReelle: Date | null; raison: string },
  weekStart: Date
): Reprise | null {
  if (!pause.finReelle) return null;

  const joursArret = joursInterrompus(pause, weekStart);
  const total = semainesDeReprise(joursArret);
  if (total === 0) return null;

  const semainesEcoulees = Math.floor((weekStart.getTime() - debutDeSemaineUtc(pause.finReelle).getTime()) / (7 * 86400000));
  if (semainesEcoulees < 0 || semainesEcoulees >= total) return null;

  const semaine = semainesEcoulees + 1;
  // 50 %, puis on comble la moitié manquante par paliers égaux jusqu'à 100 %.
  const facteurVolume = total === 1 ? 0.6 : 0.5 + (0.5 * semainesEcoulees) / (total - 1);

  return { semaine, total, facteurVolume: Math.min(1, facteurVolume), joursArret, raison: pause.raison };
}

function debutDeSemaineUtc(d: Date): Date {
  const copie = new Date(d);
  copie.setUTCHours(0, 0, 0, 0);
  const jour = copie.getUTCDay();
  copie.setUTCDate(copie.getUTCDate() + ((jour === 0 ? -6 : 1) - jour));
  return copie;
}

/**
 * Dernière pause terminée, celle dont la reprise peut encore être en cours.
 * Bornée à deux mois : au-delà, l'interruption n'influence plus la semaine.
 */
export async function dernierePauseTerminee(userId: string, weekStart: Date): Promise<PauseEnregistree | null> {
  return prisma.trainingPause.findFirst({
    where: { userId, finReelle: { not: null, gte: addDays(weekStart, -60) } },
    orderBy: { finReelle: "desc" },
    select: { id: true, raison: true, detail: true, debut: true, finPrevue: true, finReelle: true },
  });
}

/**
 * Consignes ajoutées au prompt pendant la reprise. Sans elles, le modèle
 * reconstruirait la semaine sur les seules heures déclarées par l'athlète et
 * ignorerait l'arrêt.
 */
export function reprisePromptLines(reprise: Reprise, detail: string): string[] {
  const lignes = [
    "",
    `REPRISE APRÈS INTERRUPTION — semaine ${reprise.semaine} sur ${reprise.total}.`,
    `L'athlète a interrompu son entraînement pendant ${reprise.joursArret} jour(s) (${reprise.raison}). Le volume maximum donné plus haut tient déjà compte de cette reprise : ne le dépasse sous aucun prétexte.`,
    "Privilégie la fréquence à la durée : des séances courtes et régulières, en endurance fondamentale (Z1-Z2), plutôt qu'une longue sortie.",
    "Pas de séance à haute intensité (Z4-Z5) cette semaine si la reprise en est à sa première ou deuxième semaine.",
    "Dis à l'athlète, dans les objectifs de séance, que cette semaine est volontairement légère et pourquoi : il doit comprendre que c'est la reprise qui est prudente, pas son niveau qui a chuté.",
  ];

  if (reprise.raison === "blessure") {
    lignes.push(
      "L'interruption fait suite à une BLESSURE : évite toute séance qui sollicite fortement la zone concernée, propose des alternatives (natation ou vélo plutôt que course en cas de blessure aux membres inférieurs), et rappelle-lui d'arrêter à la moindre douleur."
    );
  }
  if (detail.trim()) {
    lignes.push(`Précision donnée par l'athlète sur cette interruption : « ${detail.trim()} »`);
  }

  return lignes;
}
