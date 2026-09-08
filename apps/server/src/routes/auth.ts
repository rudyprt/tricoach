import crypto from "node:crypto";
import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth, type AuthedRequest } from "../middleware/auth.js";
import { hasStandardAccess, isPremium, isTrialActive, trialEndsAt } from "../lib/subscription.js";
import { billingUnavailableMessage, canSelfActivatePaidPlan, isPaidPlan } from "../lib/billing.js";
import { env, isProduction } from "../lib/env.js";
import { ah, HttpError } from "../lib/http.js";
import { loginRateLimit, passwordResetRateLimit, registerRateLimit } from "../lib/rateLimit.js";
import { isValidTimeZone, safeTimeZone } from "../lib/week.js";
import { passwordResetMail, sendMail } from "../lib/mailer.js";
import { syncBootstrapAdmin } from "../lib/adminBootstrap.js";
import { CONSENT_VERSION, hasCurrentConsent } from "../lib/consent.js";
import { sendEmailVerification } from "./privacy.js";

export const authRouter = Router();

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;
const BCRYPT_ROUNDS = 12;

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    // Sans ce drapeau, le cookie de session part en clair dès qu'une requête
    // bascule sur http:// — en production l'application est servie en HTTPS.
    secure: isProduction(),
    maxAge: THIRTY_DAYS_MS,
  };
}

const USER_SELECT = {
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
  createdAt: true,
} as const;

function withSubscriptionInfo<
  T extends { plan: string; createdAt: Date; emailVerifiedAt?: Date | null; consentAcceptedAt?: Date | null; consentVersion?: string | null },
>(user: T) {
  return {
    ...user,
    emailVerified: Boolean(user.emailVerifiedAt),
    // Une évolution des conditions doit être re-consentie : le client affiche
    // alors une demande d'acceptation.
    needsConsent: !hasCurrentConsent({
      consentAcceptedAt: user.consentAcceptedAt ?? null,
      consentVersion: user.consentVersion ?? null,
    }),
    consentVersionRequise: CONSENT_VERSION,
    trialEndsAt: trialEndsAt(user.createdAt),
    isTrialActive: isTrialActive(user.createdAt),
    hasStandardAccess: hasStandardAccess(user),
    isPremium: isPremium(user),
    selfServeBilling: canSelfActivatePaidPlan(),
  };
}

function issueSession(res: import("express").Response, userId: string) {
  const token = jwt.sign({ userId }, env().JWT_SECRET, { expiresIn: "30d" });
  res.cookie("token", token, cookieOptions());
}

const timezoneField = z
  .string()
  .max(64)
  .optional()
  .transform((tz) => safeTimeZone(tz));

const registerSchema = z.object({
  email: z.string().email().transform((v) => v.trim().toLowerCase()),
  password: z.string().min(8, "8 caractères minimum").max(200, "Mot de passe trop long"),
  name: z.string().trim().min(1).max(40),
  timezone: timezoneField,
  // Le consentement est une case à cocher obligatoire : sans lui, pas de
  // création de compte, et sa date est conservée comme preuve.
  acceptConditions: z.literal(true, {
    errorMap: () => ({ message: "Vous devez accepter les conditions et la politique de confidentialité." }),
  }),
});

authRouter.post(
  "/register",
  registerRateLimit,
  ah(async (req, res) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Données invalides." });
      return;
    }
    const { email, password, name, timezone } = parsed.data;

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      res.status(409).json({ error: "Un compte existe déjà avec cet email." });
      return;
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash,
        name,
        timezone,
        consentAcceptedAt: new Date(),
        consentVersion: CONSENT_VERSION,
      },
      select: USER_SELECT,
    });

    // L'envoi ne doit pas faire échouer l'inscription : l'athlète peut demander
    // un nouvel envoi depuis son compte.
    await sendEmailVerification({ id: user.id, email: user.email, name: user.name }).catch((err) =>
      console.error("Envoi de la vérification d'e-mail impossible :", err)
    );

    issueSession(res, user.id);
    res.status(201).json(withSubscriptionInfo(user));
  })
);

const loginSchema = z.object({
  email: z.string().email().transform((v) => v.trim().toLowerCase()),
  password: z.string().min(1),
  timezone: timezoneField,
});

authRouter.post(
  "/login",
  loginRateLimit,
  ah(async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Email ou mot de passe invalide." });
      return;
    }
    const { email, password, timezone } = parsed.data;

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      res.status(401).json({ error: "Email ou mot de passe incorrect." });
      return;
    }

    // Le fuseau peut changer (voyage, déménagement) : on le rafraîchit à chaque
    // connexion pour que la semaine d'entraînement reste alignée sur l'athlète.
    const updated =
      timezone && timezone !== user.timezone
        ? await prisma.user.update({ where: { id: user.id }, data: { timezone }, select: USER_SELECT })
        : {
            id: user.id,
            email: user.email,
            name: user.name,
            avatarUrl: user.avatarUrl,
            plan: user.plan,
            role: user.role,
            timezone: user.timezone,
            emailVerifiedAt: user.emailVerifiedAt,
            consentAcceptedAt: user.consentAcceptedAt,
            consentVersion: user.consentVersion,
            createdAt: user.createdAt,
          };

    const role = await syncBootstrapAdmin(updated);

    issueSession(res, user.id);
    res.json(withSubscriptionInfo({ ...updated, role }));
  })
);

authRouter.post("/logout", (_req, res) => {
  res.clearCookie("token", { ...cookieOptions(), maxAge: undefined });
  res.json({ ok: true });
});

authRouter.get(
  "/me",
  requireAuth,
  ah(async (req: AuthedRequest, res) => {
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { ...USER_SELECT, profile: true },
    });
    if (!user) {
      res.status(404).json({ error: "Utilisateur introuvable." });
      return;
    }
    const role = await syncBootstrapAdmin(user);
    res.json(withSubscriptionInfo({ ...user, role }));
  })
);

const avatarSchema = z.object({
  avatarUrl: z
    .string()
    .regex(/^data:image\/(png|jpeg|webp);base64,/, "Format d'image invalide.")
    // Le client redimensionne déjà en 256px : au-delà de 400 Ko, c'est une image
    // brute qu'on refuse pour ne pas alourdir chaque réponse /auth/me.
    .max(400_000, "Image trop volumineuse (400 Ko maximum)."),
});

authRouter.patch(
  "/avatar",
  requireAuth,
  ah(async (req: AuthedRequest, res) => {
    const parsed = avatarSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Image invalide." });
      return;
    }
    const user = await prisma.user.update({
      where: { id: req.userId! },
      data: { avatarUrl: parsed.data.avatarUrl },
      select: USER_SELECT,
    });
    res.json(withSubscriptionInfo(user));
  })
);

const usernameSchema = z.object({
  name: z.string().trim().min(1, "Le nom d'utilisateur ne peut pas être vide.").max(40, "40 caractères maximum."),
});

authRouter.patch(
  "/username",
  requireAuth,
  ah(async (req: AuthedRequest, res) => {
    const parsed = usernameSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Nom invalide." });
      return;
    }
    const user = await prisma.user.update({
      where: { id: req.userId! },
      data: { name: parsed.data.name },
      select: USER_SELECT,
    });
    res.json(withSubscriptionInfo(user));
  })
);

const timezoneSchema = z.object({
  timezone: z.string().max(64).refine(isValidTimeZone, "Fuseau horaire inconnu."),
});

authRouter.patch(
  "/timezone",
  requireAuth,
  ah(async (req: AuthedRequest, res) => {
    const parsed = timezoneSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Fuseau invalide." });
      return;
    }
    const user = await prisma.user.update({
      where: { id: req.userId! },
      data: { timezone: parsed.data.timezone },
      select: USER_SELECT,
    });
    res.json(withSubscriptionInfo(user));
  })
);

const planSchema = z.object({
  plan: z.enum(["free", "standard", "premium"]),
});

authRouter.patch(
  "/plan",
  requireAuth,
  ah(async (req: AuthedRequest, res) => {
    const parsed = planSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Offre invalide." });
      return;
    }

    // Passer à une offre payante doit être la conséquence d'un paiement, jamais
    // d'un simple appel authentifié. La résiliation, elle, reste libre.
    if (isPaidPlan(parsed.data.plan) && !canSelfActivatePaidPlan()) {
      throw new HttpError(402, billingUnavailableMessage(), "BILLING_UNAVAILABLE");
    }

    const user = await prisma.user.update({
      where: { id: req.userId! },
      data: { plan: parsed.data.plan },
      select: USER_SELECT,
    });
    res.json(withSubscriptionInfo(user));
  })
);

const passwordSchema = z
  .string()
  .min(8, "8 caractères minimum")
  .max(200, "Mot de passe trop long");

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Mot de passe actuel requis."),
  newPassword: passwordSchema,
});

authRouter.patch(
  "/password",
  requireAuth,
  ah(async (req: AuthedRequest, res) => {
    const parsed = changePasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Données invalides." });
      return;
    }
    const user = await prisma.user.findUnique({ where: { id: req.userId! } });
    if (!user || !(await bcrypt.compare(parsed.data.currentPassword, user.passwordHash))) {
      res.status(401).json({ error: "Mot de passe actuel incorrect." });
      return;
    }
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await bcrypt.hash(parsed.data.newPassword, BCRYPT_ROUNDS) },
    });
    res.json({ ok: true });
  })
);

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

const forgotSchema = z.object({
  email: z.string().email().transform((v) => v.trim().toLowerCase()),
});

authRouter.post(
  "/forgot-password",
  passwordResetRateLimit,
  ah(async (req, res) => {
    const parsed = forgotSchema.safeParse(req.body);
    // Réponse volontairement identique dans tous les cas : l'endpoint ne doit
    // pas permettre de découvrir quels e-mails ont un compte.
    const genericResponse = {
      ok: true,
      message: "Si un compte existe pour cette adresse, un e-mail de réinitialisation vient d'être envoyé.",
    };
    if (!parsed.success) {
      res.json(genericResponse);
      return;
    }

    const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });
    if (!user) {
      res.json(genericResponse);
      return;
    }

    const token = crypto.randomBytes(32).toString("hex");
    await prisma.$transaction([
      prisma.passwordResetToken.deleteMany({ where: { userId: user.id, usedAt: null } }),
      prisma.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash: hashToken(token),
          expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
        },
      }),
    ]);

    await sendMail(passwordResetMail(user.email, token));
    res.json(genericResponse);
  })
);

const resetSchema = z.object({
  token: z.string().min(32),
  password: passwordSchema,
});

authRouter.post(
  "/reset-password",
  passwordResetRateLimit,
  ah(async (req, res) => {
    const parsed = resetSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Données invalides." });
      return;
    }

    const record = await prisma.passwordResetToken.findUnique({
      where: { tokenHash: hashToken(parsed.data.token) },
    });
    if (!record || record.usedAt || record.expiresAt < new Date()) {
      res.status(400).json({ error: "Lien de réinitialisation invalide ou expiré." });
      return;
    }

    const passwordHash = await bcrypt.hash(parsed.data.password, BCRYPT_ROUNDS);
    await prisma.$transaction([
      prisma.user.update({ where: { id: record.userId }, data: { passwordHash } }),
      prisma.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
      // Les autres liens en attente pour ce compte deviennent inutilisables.
      prisma.passwordResetToken.deleteMany({ where: { userId: record.userId, usedAt: null } }),
    ]);

    res.json({ ok: true });
  })
);
