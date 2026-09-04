import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";

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
    const payload = jwt.verify(token, process.env.JWT_SECRET as string) as { userId: string };
    req.userId = payload.userId;
    next();
  } catch {
    res.status(401).json({ error: "Session invalide, reconnectez-vous." });
  }
}
