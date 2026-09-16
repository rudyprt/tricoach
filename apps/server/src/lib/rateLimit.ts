import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { AuthedRequest } from "../middleware/auth.js";

interface Bucket {
  count: number;
  resetAt: number;
}

export interface RateLimitOptions {
  /** Fenêtre glissante, en millisecondes. */
  windowMs: number;
  /** Nombre de requêtes autorisées par clé sur la fenêtre. */
  max: number;
  message: string;
  /** Par défaut : l'IP. Les routes authentifiées limitent par utilisateur. */
  keyFor?: (req: Request) => string;
}

export type RateLimiter = RequestHandler & { reset: () => void };

/** Tous les limiteurs créés, pour pouvoir les remettre à zéro dans les tests. */
const registry = new Set<RateLimiter>();

/** Remet à zéro les compteurs de tous les limiteurs (usage : tests). */
export function resetAllRateLimits(): void {
  for (const limiter of registry) limiter.reset();
}

/**
 * Limiteur en mémoire, sans dépendance. Suffisant pour une instance unique
 * (le déploiement Render actuel) ; à remplacer par un store Redis le jour où
 * l'application tourne sur plusieurs instances.
 */
export function rateLimit(options: RateLimitOptions): RateLimiter {
  const buckets = new Map<string, Bucket>();

  function sweep(now: number) {
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(key);
    }
  }

  const middleware = (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    if (buckets.size > 5000) sweep(now);

    const key = options.keyFor ? options.keyFor(req) : (req.ip ?? "inconnu");
    const bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + options.windowMs });
      next();
      return;
    }

    bucket.count += 1;
    if (bucket.count > options.max) {
      const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
      res.setHeader("Retry-After", String(retryAfter));
      res.status(429).json({ error: options.message, retryAfterSeconds: retryAfter });
      return;
    }
    next();
  };

  const limiter = Object.assign(middleware, { reset: () => buckets.clear() }) as RateLimiter;
  registry.add(limiter);
  return limiter;
}

export function byUser(req: Request): string {
  return (req as AuthedRequest).userId ?? req.ip ?? "inconnu";
}

/** Tentatives de connexion : protège contre le bourrage de mots de passe. */
export const loginRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: "Trop de tentatives de connexion. Réessayez dans quelques minutes.",
});

export const registerRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: "Trop de créations de compte depuis cette adresse. Réessayez plus tard.",
});

/** Génération de programme : chaque appel coûte un appel Claude à 8k tokens. */
export const generationRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: "Trop de générations de programme en une heure. Réessayez plus tard.",
  keyFor: byUser,
});

export const chatRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: "Vous envoyez des messages trop vite. Patientez quelques secondes.",
  keyFor: byUser,
});

export const passwordResetRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: "Trop de demandes de réinitialisation. Réessayez plus tard.",
});

/**
 * Écritures courantes d'un athlète : résultats de test, interruptions,
 * calendrier de courses. Généreux — ce sont des gestes normaux — mais borné :
 * sans limite, une boucle côté client pourrait saturer la base.
 */
export const athleteWriteRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: "Trop de modifications en une minute. Patientez quelques secondes.",
  keyFor: byUser,
});
