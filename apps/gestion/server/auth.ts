import type { NextFunction, Request, Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { env, isProduction } from "./env.js";
import { prisma } from "./prisma.js";

/**
 * Connexion à l'outil de gestion : un compte TriCoach existant, avec le rôle
 * administrateur. Le rôle est relu à chaque requête, comme dans l'application :
 * le retirer coupe l'accès immédiatement.
 */
export const COOKIE = "gestion";
const DUREE_SESSION_MS = 12 * 60 * 60 * 1000;

export interface GestionRequest extends Request {
  adminId?: string;
}

function options() {
  return {
    httpOnly: true,
    secure: isProduction(),
    sameSite: "strict" as const,
    maxAge: DUREE_SESSION_MS,
    path: "/",
  };
}

/** Limitation des tentatives, par adresse : 8 essais par quart d'heure. */
const FENETRE_MS = 15 * 60 * 1000;
const ESSAIS_MAX = 8;
const tentatives = new Map<string, { n: number; jusqua: number }>();

export function reinitialiserTentatives() {
  tentatives.clear();
}

function bloque(ip: string, now: number): boolean {
  const t = tentatives.get(ip);
  if (!t || t.jusqua < now) return false;
  return t.n >= ESSAIS_MAX;
}

function noterEchec(ip: string, now: number) {
  const t = tentatives.get(ip);
  if (!t || t.jusqua < now) tentatives.set(ip, { n: 1, jusqua: now + FENETRE_MS });
  else t.n += 1;
}

// Comparé quand le compte n'existe pas : la réponse prend le même temps, et ne
// révèle pas quelles adresses sont inscrites.
const HASH_LEURRE = bcrypt.hashSync("leurre-sans-valeur", 10);

export async function connexion(req: Request, res: Response) {
  const ip = req.ip ?? "inconnue";
  const now = Date.now();
  if (bloque(ip, now)) {
    res.status(429).json({ error: "Trop de tentatives. Réessaie dans un quart d'heure." });
    return;
  }
  const { email, password } = (req.body ?? {}) as { email?: unknown; password?: unknown };
  if (typeof email !== "string" || typeof password !== "string") {
    res.status(400).json({ error: "E-mail et mot de passe requis." });
    return;
  }
  const user = await prisma.user.findUnique({
    where: { email: email.trim().toLowerCase() },
    select: { id: true, passwordHash: true, role: true },
  });
  const ok = await bcrypt.compare(password, user?.passwordHash ?? HASH_LEURRE);
  if (!user || !ok || user.role !== "admin") {
    noterEchec(ip, now);
    res.status(401).json({ error: "Identifiants refusés, ou compte sans droit d'administration." });
    return;
  }
  tentatives.delete(ip);
  const token = jwt.sign({ sub: user.id }, env().GESTION_SECRET, { algorithm: "HS256", expiresIn: "12h" });
  res.cookie(COOKIE, token, options());
  res.json({ ok: true });
}

export function deconnexion(_req: Request, res: Response) {
  const { maxAge: _maxAge, ...sansDuree } = options();
  res.clearCookie(COOKIE, sansDuree);
  res.json({ ok: true });
}

export function exigerAdmin(req: GestionRequest, res: Response, next: NextFunction) {
  const token = req.cookies?.[COOKIE];
  if (!token) {
    res.status(401).json({ error: "Non connecté." });
    return;
  }
  let id: string;
  try {
    const payload = jwt.verify(token, env().GESTION_SECRET, { algorithms: ["HS256"] }) as { sub: string };
    id = payload.sub;
  } catch {
    res.status(401).json({ error: "Session expirée, reconnecte-toi." });
    return;
  }
  prisma.user
    .findUnique({ where: { id }, select: { role: true } })
    .then((u) => {
      if (u?.role !== "admin") {
        res.status(401).json({ error: "Accès retiré." });
        return;
      }
      req.adminId = id;
      next();
    })
    .catch(next);
}
