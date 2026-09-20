import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "../lib/env.js";
import { touchLastSeen } from "../lib/presence.js";

export interface AuthedRequest extends Request {
  userId?: string;
}

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const token = req.cookies?.token;
  if (!token) {
    res.status(401).json({ error: "Non authentifié." });
    return;
  }
  try {
    /*
     * L'algorithme est imposé, jamais lu dans le jeton. Le laisser libre est la
     * porte d'entrée classique de la confusion d'algorithmes : un attaquant
     * présente un jeton signé autrement et la vérification l'accepte.
     */
    const payload = jwt.verify(token, env().JWT_SECRET, { algorithms: ["HS256"] }) as { userId: string };
    req.userId = payload.userId;
    // Suivi de fréquentation : volontairement hors du chemin de réponse.
    touchLastSeen(payload.userId);
    next();
  } catch {
    res.status(401).json({ error: "Session invalide, reconnectez-vous." });
  }
}
