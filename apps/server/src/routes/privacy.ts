import crypto from "node:crypto";
import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth, type AuthedRequest } from "../middleware/auth.js";
import { ah, HttpError } from "../lib/http.js";
import { serializeSession } from "../lib/session.js";
import { computeTrainingZones } from "../lib/training.js";
import { parseZoneOverrides } from "../lib/zoneOverrides.js";
import { CONSENT_VERSION } from "../lib/consent.js";
import { passwordResetRateLimit } from "../lib/rateLimit.js";
import { emailVerificationMail, sendMail } from "../lib/mailer.js";
import { isProduction } from "../lib/env.js";

export const privacyRouter = Router();

const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/* ------------------------------------------------------------------ */
/* Vérification de l'adresse e-mail                                    */
/* ------------------------------------------------------------------ */

/**
 * Crée un jeton de vérification et envoie le message. Appelé à l'inscription
 * et sur demande de renvoi.
 */
export async function sendEmailVerification(user: { id: string; email: string; name: string }): Promise<void> {
  const token = crypto.randomBytes(32).toString("hex");
  await prisma.$transaction([
    prisma.emailVerificationToken.deleteMany({ where: { userId: user.id, usedAt: null } }),
    prisma.emailVerificationToken.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + VERIFICATION_TTL_MS),
      },
    }),
  ]);
  await sendMail(emailVerificationMail(user.email, user.name, token));
}

privacyRouter.post(
  "/verify-email/resend",
  requireAuth,
  passwordResetRateLimit,
  ah(async (req: AuthedRequest, res) => {
    const user = await prisma.user.findUnique({
      where: { id: req.userId! },
      select: { id: true, email: true, name: true, emailVerifiedAt: true },
    });
    if (!user) throw new HttpError(404, "Utilisateur introuvable.");
    if (user.emailVerifiedAt) {
      res.json({ ok: true, alreadyVerified: true });
      return;
    }

    await sendEmailVerification(user);
    res.json({ ok: true, alreadyVerified: false });
  })
);

const verifySchema = z.object({ token: z.string().min(32) });

privacyRouter.post(
  "/verify-email",
  passwordResetRateLimit,
  ah(async (req, res) => {
    const parsed = verifySchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, "Lien de vérification invalide.");
    }

    const record = await prisma.emailVerificationToken.findUnique({
      where: { tokenHash: hashToken(parsed.data.token) },
    });
    if (!record || record.usedAt || record.expiresAt < new Date()) {
      throw new HttpError(400, "Lien de vérification invalide ou expiré.");
    }

    await prisma.$transaction([
      prisma.user.update({ where: { id: record.userId }, data: { emailVerifiedAt: new Date() } }),
      prisma.emailVerificationToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
    ]);

    res.json({ ok: true });
  })
);

/* ------------------------------------------------------------------ */
/* Consentement                                                        */
/* ------------------------------------------------------------------ */

privacyRouter.post(
  "/consent",
  requireAuth,
  ah(async (req: AuthedRequest, res) => {
    const user = await prisma.user.update({
      where: { id: req.userId! },
      data: { consentAcceptedAt: new Date(), consentVersion: CONSENT_VERSION },
      select: { consentAcceptedAt: true, consentVersion: true },
    });
    res.json(user);
  })
);

/* ------------------------------------------------------------------ */
/* Droit à la portabilité                                              */
/* ------------------------------------------------------------------ */

/**
 * Export complet des données de l'athlète, dans un format lisible et
 * réutilisable (article 20 du RGPD). Tout ce qui le concerne y figure, à
 * l'exception du hash de son mot de passe, qui n'est pas une donnée qu'on lui
 * restitue.
 */
privacyRouter.get(
  "/export",
  requireAuth,
  ah(async (req: AuthedRequest, res) => {
    const user = await prisma.user.findUnique({
      where: { id: req.userId! },
      select: {
        id: true,
        email: true,
        name: true,
        avatarUrl: true,
        plan: true,
        role: true,
        timezone: true,
        emailVerifiedAt: true,
        consentAcceptedAt: true,
        consentVersion: true,
        lastSeenAt: true,
        createdAt: true,
        profile: true,
      },
    });
    if (!user) throw new HttpError(404, "Utilisateur introuvable.");

    const [plans, sessions, messages, aiCalls] = await Promise.all([
      prisma.trainingPlan.findMany({
        where: { userId: user.id },
        orderBy: { weekStart: "asc" },
        select: { id: true, weekStart: true, generatedAt: true, phase: true, debrief: true },
      }),
      prisma.session.findMany({ where: { userId: user.id }, orderBy: { date: "asc" } }),
      prisma.chatMessage.findMany({ where: { userId: user.id }, orderBy: { createdAt: "asc" } }),
      prisma.aiCall.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: "asc" },
        select: { kind: true, model: true, inputTokens: true, outputTokens: true, createdAt: true },
      }),
    ]);

    const zones = user.profile
      ? computeTrainingZones({
          tempsCourse: user.profile.tempsCourse,
          tempsNatation: user.profile.tempsNatation,
          tempsVelo: user.profile.tempsVelo,
          ftpWatts: user.profile.ftpWatts,
          overrides: parseZoneOverrides(user.profile.customZones),
        })
      : null;

    const filename = `tricoach-mes-donnees-${new Date().toISOString().slice(0, 10)}.json`;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(
      JSON.stringify(
        {
          exporteLe: new Date().toISOString(),
          compte: user,
          zonesDEntrainement: zones,
          programmes: plans,
          seances: sessions.map(serializeSession),
          conversationsCoach: messages,
          appelsAuCoachIa: aiCalls,
        },
        null,
        2
      )
    );
  })
);

/* ------------------------------------------------------------------ */
/* Droit à l'effacement                                                */
/* ------------------------------------------------------------------ */

const deleteSchema = z.object({
  password: z.string().min(1, "Mot de passe requis."),
  confirmation: z.literal("SUPPRIMER", {
    errorMap: () => ({ message: 'Saisissez "SUPPRIMER" pour confirmer.' }),
  }),
});

/**
 * Suppression définitive du compte et de toutes les données rattachées
 * (article 17 du RGPD). Les cascades du schéma effacent profil, programmes,
 * séances, conversations, jetons et journal de consommation.
 *
 * Le mot de passe est redemandé : une session volée ou un appareil laissé
 * ouvert ne doit pas suffire à détruire l'historique d'un athlète.
 */
privacyRouter.delete(
  "/account",
  requireAuth,
  ah(async (req: AuthedRequest, res) => {
    const parsed = deleteSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, parsed.error.issues[0]?.message ?? "Confirmation invalide.");
    }

    const user = await prisma.user.findUnique({ where: { id: req.userId! } });
    if (!user || !(await bcrypt.compare(parsed.data.password, user.passwordHash))) {
      throw new HttpError(401, "Mot de passe incorrect.");
    }

    // Un administrateur qui se supprime peut laisser l'application sans
    // personne pour la gérer : on l'en empêche tant qu'il est le dernier.
    if (user.role === "admin") {
      const autres = await prisma.user.count({ where: { role: "admin", id: { not: user.id } } });
      if (autres === 0) {
        throw new HttpError(
          400,
          "Vous êtes le dernier administrateur. Nommez quelqu'un d'autre avant de supprimer votre compte."
        );
      }
    }

    await prisma.user.delete({ where: { id: user.id } });
    res.clearCookie("token", { httpOnly: true, sameSite: "lax", secure: isProduction() });
    res.json({ ok: true });
  })
);
