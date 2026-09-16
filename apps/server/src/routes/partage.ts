import crypto from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth, type AuthedRequest } from "../middleware/auth.js";
import { ah, HttpError } from "../lib/http.js";
import { athleteWriteRateLimit, rateLimit } from "../lib/rateLimit.js";
import { serializeSession } from "../lib/session.js";
import { addDays, startOfWeek } from "../lib/week.js";
import { env } from "../lib/env.js";

export const partageRouter = Router();

const DUREE_PARTAGE_JOURS = 30;

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/**
 * Consultation publique d'une semaine partagée.
 *
 * Volontairement placée avant `requireAuth` : le destinataire du lien — un
 * coach humain, un partenaire — n'a pas de compte, c'est tout l'intérêt.
 * Le jeton est long et haché en base ; la limitation par adresse empêche de le
 * deviner en force.
 */
const consultationRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: "Trop de consultations. Patientez quelques secondes.",
  // Par défaut, le limiteur compte par adresse : c'est ce qu'il faut ici,
  // puisque le visiteur n'a pas de compte.
});

partageRouter.get(
  "/:token",
  consultationRateLimit,
  ah(async (req, res) => {
    const token = req.params.token;
    if (!/^[a-f0-9]{48}$/.test(token)) throw new HttpError(404, "Ce lien de partage n'existe pas ou a expiré.");

    const partage = await prisma.sharedWeek.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { user: { select: { name: true } } },
    });
    if (!partage || partage.expiresAt < new Date()) {
      throw new HttpError(404, "Ce lien de partage n'existe pas ou a expiré.");
    }

    const sessions = await prisma.session.findMany({
      where: {
        userId: partage.userId,
        date: { gte: partage.weekStart, lt: addDays(partage.weekStart, 7) },
      },
      orderBy: { date: "asc" },
    });

    // Consultation comptée sans bloquer la réponse : l'athlète veut savoir si
    // son lien a servi, mais un échec d'écriture ne doit pas casser la page.
    prisma.sharedWeek
      .update({ where: { id: partage.id }, data: { vues: { increment: 1 } } })
      .catch(() => undefined);

    res.json({
      // Le prénom seulement : un lien partagé ne doit pas divulguer l'adresse
      // e-mail ni quoi que ce soit du compte.
      athlete: partage.user.name.split(" ")[0],
      weekStart: partage.weekStart.toISOString().slice(0, 10),
      expiresAt: partage.expiresAt.toISOString(),
      sessions: sessions.map(serializeSession),
    });
  })
);

partageRouter.use(requireAuth);
partageRouter.use(athleteWriteRateLimit);

const creationSchema = z.object({
  /** Semaine à partager, au format AAAA-MM-JJ ; par défaut la semaine en cours. */
  weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

partageRouter.post(
  "/",
  ah(async (req: AuthedRequest, res) => {
    const userId = req.userId!;
    const parsed = creationSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw new HttpError(400, "Semaine invalide.");

    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { timezone: true } });
    const weekStart = parsed.data.weekStart
      ? new Date(`${parsed.data.weekStart}T00:00:00.000Z`)
      : startOfWeek(new Date(), user.timezone);
    if (Number.isNaN(weekStart.getTime())) throw new HttpError(400, "Semaine invalide.");

    const sessions = await prisma.session.count({
      where: { userId, date: { gte: weekStart, lt: addDays(weekStart, 7) } },
    });
    if (sessions === 0) throw new HttpError(400, "Cette semaine n'a pas encore de programme à partager.");

    // Un lien par semaine : régénérer remplace l'ancien, qui cesse aussitôt de
    // fonctionner. C'est ce qu'attend quelqu'un qui « révoque » un partage.
    await prisma.sharedWeek.deleteMany({ where: { userId, weekStart } });

    const token = crypto.randomBytes(24).toString("hex");
    const expiresAt = new Date(Date.now() + DUREE_PARTAGE_JOURS * 86400000);
    await prisma.sharedWeek.create({
      data: { userId, weekStart, tokenHash: hashToken(token), expiresAt },
    });

    const base = env().APP_URL.replace(/\/$/, "");
    res.status(201).json({
      url: `${base}/semaine/${token}`,
      expiresAt: expiresAt.toISOString(),
      dureeJours: DUREE_PARTAGE_JOURS,
    });
  })
);

/** Révocation : le lien cesse immédiatement de fonctionner. */
partageRouter.delete(
  "/",
  ah(async (req: AuthedRequest, res) => {
    const parsed = creationSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw new HttpError(400, "Semaine invalide.");

    const user = await prisma.user.findUniqueOrThrow({
      where: { id: req.userId! },
      select: { timezone: true },
    });
    const weekStart = parsed.data.weekStart
      ? new Date(`${parsed.data.weekStart}T00:00:00.000Z`)
      : startOfWeek(new Date(), user.timezone);

    const suppression = await prisma.sharedWeek.deleteMany({ where: { userId: req.userId!, weekStart } });
    res.json({ revoques: suppression.count });
  })
);
