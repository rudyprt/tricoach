import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth, type AuthedRequest } from "../middleware/auth.js";
import { hasStandardAccess, isPremium, isTrialActive, trialEndsAt } from "../lib/subscription.js";

export const authRouter = Router();

const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax" as const,
  maxAge: 30 * 24 * 60 * 60 * 1000,
};

const USER_SELECT = {
  id: true,
  email: true,
  name: true,
  avatarUrl: true,
  plan: true,
  createdAt: true,
} as const;

function withSubscriptionInfo<T extends { plan: string; createdAt: Date }>(user: T) {
  return {
    ...user,
    trialEndsAt: trialEndsAt(user.createdAt),
    isTrialActive: isTrialActive(user.createdAt),
    hasStandardAccess: hasStandardAccess(user),
    isPremium: isPremium(user),
  };
}

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, "8 caractères minimum"),
  name: z.string().min(1),
});

authRouter.post("/register", async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Données invalides." });
    return;
  }
  const { email, password, name } = parsed.data;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    res.status(409).json({ error: "Un compte existe déjà avec cet email." });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({ data: { email, passwordHash, name }, select: USER_SELECT });

  const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET as string, { expiresIn: "30d" });
  res.cookie("token", token, COOKIE_OPTIONS);
  res.status(201).json(withSubscriptionInfo(user));
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

authRouter.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Email ou mot de passe invalide." });
    return;
  }
  const { email, password } = parsed.data;

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    res.status(401).json({ error: "Email ou mot de passe incorrect." });
    return;
  }

  const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET as string, { expiresIn: "30d" });
  res.cookie("token", token, COOKIE_OPTIONS);
  res.json(
    withSubscriptionInfo({
      id: user.id,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatarUrl,
      plan: user.plan,
      createdAt: user.createdAt,
    })
  );
});

authRouter.post("/logout", (_req, res) => {
  res.clearCookie("token");
  res.json({ ok: true });
});

authRouter.get("/me", requireAuth, async (req: AuthedRequest, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.userId },
    select: { ...USER_SELECT, profile: true },
  });
  if (!user) {
    res.status(404).json({ error: "Utilisateur introuvable." });
    return;
  }
  res.json(withSubscriptionInfo(user));
});

const avatarSchema = z.object({
  avatarUrl: z
    .string()
    .startsWith("data:image/", "Format d'image invalide.")
    .max(1_500_000, "Image trop volumineuse."),
});

authRouter.patch("/avatar", requireAuth, async (req: AuthedRequest, res) => {
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
});

const usernameSchema = z.object({
  name: z.string().trim().min(1, "Le nom d'utilisateur ne peut pas être vide.").max(40, "40 caractères maximum."),
});

authRouter.patch("/username", requireAuth, async (req: AuthedRequest, res) => {
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
});

const planSchema = z.object({
  plan: z.enum(["free", "standard", "premium"]),
});

authRouter.patch("/plan", requireAuth, async (req: AuthedRequest, res) => {
  const parsed = planSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Offre invalide." });
    return;
  }
  const user = await prisma.user.update({
    where: { id: req.userId! },
    data: { plan: parsed.data.plan },
    select: USER_SELECT,
  });
  res.json(withSubscriptionInfo(user));
});
