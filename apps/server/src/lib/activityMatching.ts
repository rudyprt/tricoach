import type { NormalizedActivity } from "./strava.js";

export interface PlannedSession {
  id: string;
  date: Date;
  sport: string;
  dureeMin: number;
  status: string;
}

/**
 * Rapproche une activité réellement effectuée d'une séance planifiée.
 *
 * Le critère est volontairement strict : même jour et même discipline. Un
 * rapprochement erroné marquerait une séance comme faite alors qu'elle ne l'est
 * pas, ce qui fausserait la progression de charge de la semaine suivante. Mieux
 * vaut laisser une activité non rattachée que la rattacher au mauvais endroit.
 */
export function findMatchingSession(
  activity: NormalizedActivity,
  sessions: PlannedSession[]
): PlannedSession | null {
  const jour = activity.startedAt.toISOString().slice(0, 10);

  const candidates = sessions.filter(
    (s) =>
      s.sport === activity.sport &&
      s.sport !== "repos" &&
      s.date.toISOString().slice(0, 10) === jour
  );
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];

  // Plusieurs séances du même sport le même jour : on retient celle dont la
  // durée prévue est la plus proche de la durée réalisée.
  return candidates.reduce((meilleure, s) =>
    Math.abs(s.dureeMin - activity.dureeMin) < Math.abs(meilleure.dureeMin - activity.dureeMin) ? s : meilleure
  );
}

export function formatAllure(secParKm: number): string {
  const minutes = Math.floor(secParKm / 60);
  const secondes = secParKm % 60;
  return `${minutes}:${String(secondes).padStart(2, "0")}/km`;
}

/**
 * Résumé d'une activité réalisée, destiné aux prompts. C'est la donnée qui
 * distingue un coach informé d'un coach qui ne connaît que le déclaratif.
 */
export function describeActivity(activity: {
  sport: string;
  startedAt: Date;
  dureeMin: number;
  distanceKm: number | null;
  allureSecParKm: number | null;
  fcMoyenne: number | null;
  puissanceMoy: number | null;
  denivelePosM: number | null;
}): string {
  const morceaux = [
    activity.startedAt.toISOString().slice(0, 10),
    activity.sport,
    `${activity.dureeMin}min`,
  ];
  if (activity.distanceKm) morceaux.push(`${activity.distanceKm}km`);
  if (activity.allureSecParKm) morceaux.push(formatAllure(activity.allureSecParKm));
  if (activity.puissanceMoy) morceaux.push(`${activity.puissanceMoy}W`);
  if (activity.fcMoyenne) morceaux.push(`FC moy ${activity.fcMoyenne}`);
  if (activity.denivelePosM && activity.denivelePosM > 50) morceaux.push(`D+ ${activity.denivelePosM}m`);
  return morceaux.join(" ");
}
