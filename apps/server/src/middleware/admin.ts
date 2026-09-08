import type { NextFunction, Response } from "express";
import { prisma } from "../lib/prisma.js";
import type { AuthedRequest } from "./auth.js";

export const ADMIN_ROLE = "admin";

/**
 * Le rôle est relu en base à chaque requête, jamais porté par le jeton : une
 * révocation prend effet immédiatement, sans attendre l'expiration du cookie
 * (30 jours).
 */
export function requireAdmin(req: AuthedRequest, res: Response, next: NextFunction) {
  if (!req.userId) {
    res.status(401).json({ error: "Non authentifié." });
    return;
  }

  prisma.user
    .findUnique({ where: { id: req.userId }, select: { id: true, email: true, role: true } })
    .then(async (user) => {
      if (!user) {
        res.status(404).json({ error: "Ressource introuvable." });
        return;
      }
      // Import tardif : adminBootstrap importe ADMIN_ROLE depuis ce fichier.
      const { syncBootstrapAdmin } = await import("../lib/adminBootstrap.js");
      const role = await syncBootstrapAdmin(user);

      if (role !== ADMIN_ROLE) {
        // Message volontairement identique à celui d'une ressource absente :
        // l'existence de l'espace d'administration n'a pas à être confirmée.
        res.status(404).json({ error: "Ressource introuvable." });
        return;
      }
      next();
    })
    .catch(next);
}
