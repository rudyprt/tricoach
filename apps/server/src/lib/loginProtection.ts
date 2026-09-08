import { prisma } from "./prisma.js";

/** Tentatives infructueuses tolérées avant verrouillage temporaire. */
export const MAX_FAILED_LOGINS = 8;

/** Durée du verrouillage. Assez long pour décourager, assez court pour ne pas
 *  transformer une attaque en déni de service contre le titulaire du compte. */
export const LOCK_DURATION_MS = 15 * 60 * 1000;

export interface LockState {
  failedLogins: number;
  lockedUntil: Date | null;
}

export function isLocked(user: LockState): boolean {
  return Boolean(user.lockedUntil && user.lockedUntil > new Date());
}

export function minutesUntilUnlock(user: LockState): number {
  if (!user.lockedUntil) return 0;
  return Math.max(1, Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60_000));
}

/**
 * La limitation par adresse IP ne protège pas d'une attaque distribuée, et un
 * déploiement multi-instances la fragmente. Ce compteur, porté par le compte
 * lui-même, ferme les deux failles.
 */
export async function recordFailedLogin(userId: string, current: number): Promise<void> {
  const failedLogins = current + 1;
  await prisma.user.update({
    where: { id: userId },
    data: {
      failedLogins,
      lockedUntil: failedLogins >= MAX_FAILED_LOGINS ? new Date(Date.now() + LOCK_DURATION_MS) : null,
    },
  });
}

export async function clearFailedLogins(userId: string, current: LockState): Promise<void> {
  // Écriture évitée dans le cas courant : une connexion réussie sur un compte
  // sain ne doit pas coûter une mise à jour.
  if (current.failedLogins === 0 && !current.lockedUntil) return;
  await prisma.user.update({ where: { id: userId }, data: { failedLogins: 0, lockedUntil: null } });
}
