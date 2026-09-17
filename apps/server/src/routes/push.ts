import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth, type AuthedRequest } from "../middleware/auth.js";
import { ah, HttpError } from "../lib/http.js";
import { athleteWriteRateLimit } from "../lib/rateLimit.js";
import { isPushConfigured, notifier, publicVapidKey } from "../lib/push.js";

export const pushRouter = Router();

/**
 * Clé publique du serveur, nécessaire au navigateur pour créer un abonnement.
 * Publique par nature : elle ne permet que de chiffrer à notre destination.
 * Accessible sans session, car le client la demande avant même de proposer
 * l'activation.
 */
pushRouter.get("/cle", (_req, res) => {
  res.json({ disponible: isPushConfigured(), clePublique: publicVapidKey() });
});

pushRouter.use(requireAuth);
pushRouter.use(athleteWriteRateLimit);

const abonnementSchema = z.object({
  endpoint: z.string().url("Point de terminaison invalide.").max(1000),
  keys: z.object({
    p256dh: z.string().min(1).max(255),
    auth: z.string().min(1).max(255),
  }),
});

/**
 * Enregistre un appareil. Le point de terminaison est unique : un même
 * navigateur qui se réabonne met à jour ses clés plutôt que de créer un
 * doublon, sinon chaque rappel partirait deux fois sur le même téléphone.
 */
pushRouter.post(
  "/abonnements",
  ah(async (req: AuthedRequest, res) => {
    if (!isPushConfigured()) throw new HttpError(503, "Les notifications ne sont pas configurées sur ce serveur.");

    const parsed = abonnementSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message ?? "Abonnement invalide.");

    const { endpoint, keys } = parsed.data;
    const abonnement = await prisma.pushSubscription.upsert({
      where: { endpoint },
      create: { userId: req.userId!, endpoint, p256dh: keys.p256dh, auth: keys.auth },
      // Le compte est repris : un téléphone prêté puis rendu ne doit pas
      // continuer de recevoir les notifications du précédent utilisateur.
      update: { userId: req.userId!, p256dh: keys.p256dh, auth: keys.auth },
    });

    res.status(201).json({ id: abonnement.id });
  })
);

pushRouter.delete(
  "/abonnements",
  ah(async (req: AuthedRequest, res) => {
    const endpoint = typeof req.body?.endpoint === "string" ? req.body.endpoint : null;
    if (!endpoint) throw new HttpError(400, "Point de terminaison manquant.");

    await prisma.pushSubscription.deleteMany({ where: { endpoint, userId: req.userId! } });
    res.json({ ok: true });
  })
);

/** État des notifications pour cet athlète, et nombre d'appareils enregistrés. */
pushRouter.get(
  "/etat",
  ah(async (req: AuthedRequest, res) => {
    const appareils = await prisma.pushSubscription.count({ where: { userId: req.userId! } });
    res.json({ disponible: isPushConfigured(), appareils });
  })
);

/**
 * Envoi de contrôle. Une notification qui n'arrive pas est indétectable sans
 * cela : l'athlète l'active, ne reçoit rien pendant une semaine, et conclut que
 * la fonctionnalité est cassée.
 */
pushRouter.post(
  "/test",
  ah(async (req: AuthedRequest, res) => {
    const bilan = await notifier(req.userId!, {
      titre: "TriCoach",
      corps: "Les notifications fonctionnent. Vous recevrez vos rappels ici.",
      tag: "test",
    });
    if (bilan.envoyees === 0) {
      throw new HttpError(400, "Aucun appareil n'a pu être joint. Réactivez les notifications depuis cet appareil.");
    }
    res.json(bilan);
  })
);
