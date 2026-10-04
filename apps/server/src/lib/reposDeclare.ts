import { Prisma } from "@prisma/client";
import { prisma } from "./prisma.js";
import { JOURS, type Disponibilites, type Jour } from "./disponibilites.js";
import { localCalendarDate } from "./week.js";

/**
 * Faire respecter un jour de repos déclaré APRÈS la génération.
 *
 * Des athlètes ont signalé une séance le dimanche alors qu'ils venaient de le
 * déclarer indisponible. La génération, elle, respecte bien la contrainte : le
 * trou était ailleurs — enregistrer ses créneaux ne touchait à aucune séance
 * déjà planifiée. Corriger ses créneaux ne sert à rien si la semaine en cours
 * garde la séance qu'on vient d'interdire.
 */

export const DESCRIPTION_REPOS_DECLARE = "Jour indisponible déclaré dans vos créneaux.";

/** Le jour de la semaine d'une date de séance, stockée à minuit UTC. */
export function jourDeLaDate(date: Date): Jour {
  return JOURS[(date.getUTCDay() + 6) % 7];
}

/** Les jours de la semaine déclarés indisponibles, indépendamment d'une date. */
export function joursDeRepos(disponibilites: Disponibilites | null): Set<Jour> {
  const repos = new Set<Jour>();
  for (const jour of JOURS) {
    if (disponibilites?.[jour]?.disponible === false) repos.add(jour);
  }
  return repos;
}

/**
 * Convertit en repos les séances encore à venir qui tombent un jour devenu
 * indisponible. Renvoie le nombre de séances libérées.
 *
 * Seules les séances à partir d'aujourd'hui et encore `planifiee` sont
 * touchées : l'historique raconte ce qui a eu lieu, il ne se réécrit pas.
 */
export async function libererJoursIndisponibles(
  userId: string,
  disponibilites: Disponibilites | null,
  timezone: string
): Promise<number> {
  const repos = joursDeRepos(disponibilites);
  if (repos.size === 0) return 0;

  const aujourdhui = new Date(`${localCalendarDate(new Date(), timezone)}T00:00:00.000Z`);
  const aVenir = await prisma.session.findMany({
    where: { userId, status: "planifiee", date: { gte: aujourdhui }, sport: { not: "repos" } },
    select: { id: true, date: true },
  });

  const aLiberer = aVenir.filter((s) => repos.has(jourDeLaDate(s.date))).map((s) => s.id);
  if (aLiberer.length === 0) return 0;

  await prisma.session.updateMany({
    where: { id: { in: aLiberer } },
    data: {
      sport: "repos",
      titre: "Repos",
      dureeMin: 0,
      distanceKm: null,
      description: DESCRIPTION_REPOS_DECLARE,
      objectif: null,
      // Prisma distingue « absent » de « null » sur une colonne JSON.
      structure: Prisma.DbNull,
    },
  });

  return aLiberer.length;
}
