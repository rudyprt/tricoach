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
    const payload = jwt.verify(token, env().JWT_SECRET) as { userId: string };
    req.userId = payload.userId;
    // Suivi de fréquentation : volontairement hors du chemin de réponse.
    touchLastSeen(payload.userId);
    next();
  } catch {
    res.status(401).json({ error: "Session invalide, reconnectez-vous." });
  }
}
