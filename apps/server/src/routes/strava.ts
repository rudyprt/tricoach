import crypto from "node:crypto";
import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth, type AuthedRequest } from "../middleware/auth.js";
import { ah, HttpError } from "../lib/http.js";
import { env, isProduction } from "../lib/env.js";
import {
  authorizationUrl,
  exchangeCode,
  fetchActivities,
  isStravaConfigured,
  normalize,
} from "../lib/strava.js";
import { findMatchingSession } from "../lib/activityMatching.js";
import { rateLimit, byUser } from "../lib/rateLimit.js";

export const stravaRouter = Router();
stravaRouter.use(requireAuth);

const STATE_COOKIE = "strava_state";
const STATE_TTL_MS = 10 * 60 * 1000;

/** L'API Strava est limitée en volume : on espace les imports manuels. */
const syncRateLimit = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 5,
  message: "Import déjà effectué récemment. Patientez quelques minutes.",
  keyFor: byUser,
});

stravaRouter.get(
  "/status",
  ah(async (req: AuthedRequest, res) => {
    const account = await prisma.stravaAccount.findUnique({
      where: { userId: req.userId! },
      select: { athleteName: true, lastSyncAt: true, createdAt: true },
    });
    const activites = account
      ? await prisma.activity.count({ where: { userId: req.userId! } })
      : 0;

    res.json({
      disponible: isStravaConfigured(),
      relie: Boolean(account),
      athleteName: account?.athleteName ?? null,
      lastSyncAt: account?.lastSyncAt ?? null,
      activitesImportees: activites,
    });
  })
);

/**
 * Démarre l'autorisation. Le jeton `state` est posé en cookie et revérifié au
 * retour : sans lui, un tiers pourrait faire relier son compte Strava à la
 * session d'un athlète.
 */
stravaRouter.post(
  "/connect",
  ah(async (_req: AuthedRequest, res) => {
    if (!isStravaConfigured()) {
      throw new HttpError(503, "La connexion Strava n'est pas encore disponible.");
    }
    const state = crypto.randomBytes(24).toString("hex");
    res.cookie(STATE_COOKIE, state, {
      httpOnly: true,
      sameSite: "lax",
      secure: isProduction(),
      maxAge: STATE_TTL_MS,
    });
    res.json({ url: authorizationUrl(state) });
  })
);

stravaRouter.post(
  "/callback",
  ah(async (req: AuthedRequest, res) => {
    const { code, state } = req.body ?? {};
    if (typeof code !== "string" || typeof state !== "string") {
      throw new HttpError(400, "Autorisation Strava incomplète.");
    }

    const attendu = req.cookies?.[STATE_COOKIE];
    if (!attendu || attendu !== state) {
      throw new HttpError(400, "Autorisation Strava expirée ou invalide. Recommencez la connexion.");
    }
    res.clearCookie(STATE_COOKIE);

    const tokens = await exchangeCode(code);
    if (!tokens.athlete) {
      throw new HttpError(502, "Strava n'a pas renvoyé l'identité du compte.");
    }

    const athleteId = String(tokens.athlete.id);
    const athleteName = [tokens.athlete.firstname, tokens.athlete.lastname].filter(Boolean).join(" ") || null;

    // Un même compte Strava ne peut alimenter qu'un seul compte TriCoach :
    // sinon les activités d'une personne nourriraient le programme d'une autre.
    const dejaRelie = await prisma.stravaAccount.findUnique({ where: { athleteId } });
    if (dejaRelie && dejaRelie.userId !== req.userId) {
      throw new HttpError(409, "Ce compte Strava est déjà relié à un autre compte TriCoach.");
    }

    await prisma.stravaAccount.upsert({
      where: { userId: req.userId! },
      create: {
        userId: req.userId!,
        athleteId,
        athleteName,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt: new Date(tokens.expires_at * 1000),
      },
      update: {
        athleteId,
        athleteName,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt: new Date(tokens.expires_at * 1000),
      },
    });

    res.json({ ok: true, athleteName });
  })
);

stravaRouter.delete(
  "/",
  ah(async (req: AuthedRequest, res) => {
    // Les activités déjà importées sont conservées : elles font partie de
    // l'historique d'entraînement de l'athlète, pas de la connexion.
    await prisma.stravaAccount.deleteMany({ where: { userId: req.userId! } });
    res.json({ ok: true });
  })
);

/**
 * Importe les activités récentes et les rapproche des séances planifiées. Une
 * séance rapprochée est marquée réalisée avec les données mesurées, ce qui
 * évite à l'athlète de saisir à la main ce que sa montre sait déjà.
 */
stravaRouter.post(
  "/sync",
  syncRateLimit,
  ah(async (req: AuthedRequest, res) => {
    const account = await prisma.stravaAccount.findUnique({ where: { userId: req.userId! } });
    if (!account) {
      throw new HttpError(400, "Reliez d'abord votre compte Strava.");
    }

    // Au premier import, on remonte 30 jours ; ensuite, depuis la dernière
    // synchronisation avec un léger recouvrement (une activité peut être
    // enregistrée en retard).
    const since = account.lastSyncAt
      ? new Date(account.lastSyncAt.getTime() - 24 * 60 * 60 * 1000)
      : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const activities = (await fetchActivities(req.userId!, since)).map(normalize);

    const sessions = await prisma.session.findMany({
      where: { userId: req.userId!, date: { gte: new Date(since.getTime() - 24 * 60 * 60 * 1000) } },
      select: { id: true, date: true, sport: true, dureeMin: true, status: true },
    });

    let importees = 0;
    let rapprochees = 0;

    for (const activity of activities) {
      const session = findMatchingSession(activity, sessions);

      const existante = await prisma.activity.findUnique({
        where: { source_externalId: { source: "strava", externalId: activity.externalId } },
      });
      if (existante) continue;

      await prisma.activity.create({
        data: { ...activity, userId: req.userId!, source: "strava", sessionId: session?.id ?? null },
      });
      importees += 1;

      // Une séance déjà renseignée par l'athlète n'est pas écrasée : sa
      // saisie manuelle prime sur une déduction automatique.
      if (session && session.status === "planifiee") {
        await prisma.session.update({
          where: { id: session.id },
          data: { status: "faite", completedAt: activity.startedAt },
        });
        rapprochees += 1;
      }
    }

    await prisma.stravaAccount.update({
      where: { userId: req.userId! },
      data: { lastSyncAt: new Date() },
    });

    res.json({ importees, rapprochees, total: activities.length });
  })
);

stravaRouter.get(
  "/activities",
  ah(async (req: AuthedRequest, res) => {
    const activities = await prisma.activity.findMany({
      where: { userId: req.userId! },
      orderBy: { startedAt: "desc" },
      take: 50,
    });
    res.json({ activities });
  })
);
