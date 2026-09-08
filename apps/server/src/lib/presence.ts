import { prisma } from "./prisma.js";

/**
 * Fenêtre de regroupement : un athlète qui enchaîne vingt requêtes ne provoque
 * qu'une seule écriture. La granularité reste largement suffisante pour des
 * statistiques d'actifs par jour, semaine et mois.
 */
const TOUCH_INTERVAL_MS = 15 * 60 * 1000;

const lastWritten = new Map<string, number>();

/** Vide le cache mémoire (usage : tests). */
export function resetPresenceCache(): void {
  lastWritten.clear();
}

/**
 * Met à jour la dernière activité de l'athlète. L'écriture est délibérément
 * détachée de la requête : la fréquentation est une donnée d'observation, elle
 * ne doit ni ralentir ni faire échouer une réponse.
 */
export function touchLastSeen(userId: string): void {
  const now = Date.now();
  const previous = lastWritten.get(userId);
  if (previous && now - previous < TOUCH_INTERVAL_MS) return;

  lastWritten.set(userId, now);
  if (lastWritten.size > 10_000) {
    for (const [id, at] of lastWritten) {
      if (now - at > TOUCH_INTERVAL_MS) lastWritten.delete(id);
    }
  }

  prisma.user
    .update({ where: { id: userId }, data: { lastSeenAt: new Date(now) } })
    .catch(() => {
      // Compte supprimé entre-temps, ou base indisponible : sans conséquence
      // sur la requête en cours. On réessaiera au prochain passage.
      lastWritten.delete(userId);
    });
}
