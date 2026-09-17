import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { AuthedRequest } from "../middleware/auth.js";
import { prisma } from "./prisma.js";

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
  /**
   * Compte en base plutôt qu'en mémoire, pour que le quota reste le même quel
   * que soit le nombre d'instances. Réservé aux routes sensibles : c'est une
   * écriture supplémentaire par requête.
   */
  shared?: boolean;
  /** Nom du limiteur, préfixe de la clé partagée. Obligatoire si `shared`. */
  name?: string;
}

export type RateLimiter = RequestHandler & { reset: () => void };

/** Tous les limiteurs créés, pour pouvoir les remettre à zéro dans les tests. */
const registry = new Set<RateLimiter>();

/**
 * Remet à zéro les compteurs (usage : tests).
 *
 * Asynchrone parce que les limiteurs partagés comptent en base : sans attendre
 * cette purge, un test hériterait des tentatives du précédent.
 */
export async function resetAllRateLimits(): Promise<void> {
  for (const limiter of registry) limiter.reset();
  await prisma.rateLimitCounter.deleteMany().catch(() => undefined);
}

/**
 * Compte une requête dans le compteur partagé et dit si elle dépasse le quota.
 *
 * La fenêtre est fixe et non glissante : la clé porte le numéro de fenêtre, si
 * bien que l'incrément est un simple upsert atomique. Une fenêtre glissante
 * exigerait de conserver chaque horodatage, pour une précision dont la
 * protection anti-bourrage n'a pas besoin.
 */
async function compterPartage(
  name: string,
  key: string,
  windowMs: number,
  now: number
): Promise<{ count: number; resetAt: number }> {
  const debutFenetre = Math.floor(now / windowMs) * windowMs;
  const resetAt = debutFenetre + windowMs;
  const id = `${name}:${key}:${debutFenetre}`;

  const compteur = await prisma.rateLimitCounter.upsert({
    where: { id },
    create: { id, count: 1, expiresAt: new Date(resetAt) },
    update: { count: { increment: 1 } },
    select: { count: true },
  });

  return { count: compteur.count, resetAt };
}

/**
 * Efface les compteurs expirés. Sans cela, la table grossit indéfiniment : une
 * ligne par appelant et par fenêtre, jamais relue après son expiration.
 */
export async function purgerCompteursExpires(): Promise<number> {
  const { count } = await prisma.rateLimitCounter.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  return count;
}

export function rateLimit(options: RateLimitOptions): RateLimiter {
  if (options.shared && !options.name) {
    throw new Error("Un limiteur partagé doit porter un nom : il sert de préfixe à sa clé en base.");
  }

  const buckets = new Map<string, Bucket>();

  function sweep(now: number) {
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(key);
    }
  }

  function refuser(res: Response, resetAt: number, now: number) {
    const retryAfter = Math.max(1, Math.ceil((resetAt - now) / 1000));
    res.setHeader("Retry-After", String(retryAfter));
    res.status(429).json({ error: options.message, retryAfterSeconds: retryAfter });
  }

  const middleware = (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    const key = options.keyFor ? options.keyFor(req) : (req.ip ?? "inconnu");

    if (options.shared && options.name) {
      compterPartage(options.name, key, options.windowMs, now)
        .then(({ count, resetAt }) => {
          if (count > options.max) refuser(res, resetAt, now);
          else next();
        })
        .catch((erreur) => {
          // Base indisponible : on laisse passer plutôt que de bloquer toutes
          // les connexions. Le verrouillage de compte, lui, reste en place.
          console.error(`[limite] compteur partagé indisponible (${options.name})`, erreur);
          next();
        });
      return;
    }

    if (buckets.size > 5000) sweep(now);
    const bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + options.windowMs });
      next();
      return;
    }

    bucket.count += 1;
    if (bucket.count > options.max) {
      refuser(res, bucket.resetAt, now);
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
  name: "login",
  shared: true,
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: "Trop de tentatives de connexion. Réessayez dans quelques minutes.",
});

export const registerRateLimit = rateLimit({
  name: "register",
  shared: true,
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
  name: "password-reset",
  shared: true,
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
