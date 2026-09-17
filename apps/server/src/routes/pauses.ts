import { Router } from "express";
import { athleteWriteRateLimit } from "../lib/rateLimit.js";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth, type AuthedRequest } from "../middleware/auth.js";
import { ah, HttpError } from "../lib/http.js";
import {
  LIBELLES_PAUSE,
  RAISONS_PAUSE,
  dernierePauseTerminee,
  etatDeReprise,
  joursInterrompus,
  pauseEnCours,
} from "../lib/pause.js";
import { startOfWeek } from "../lib/week.js";

export const pausesRouter = Router();
pausesRouter.use(requireAuth);
pausesRouter.use(athleteWriteRateLimit);

/** L'état d'entraînement de l'athlète : en pause, en reprise, ou normal. */
pausesRouter.get(
  "/",
  ah(async (req: AuthedRequest, res) => {
    const userId = req.userId!;
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { timezone: true },
    });
    const weekStart = startOfWeek(new Date(), user.timezone);

    const enCours = await pauseEnCours(userId);
    if (enCours) {
      res.json({
        etat: "en_pause",
        pause: {
          ...enCours,
          libelle: LIBELLES_PAUSE[enCours.raison as keyof typeof LIBELLES_PAUSE] ?? enCours.raison,
          joursEcoules: joursInterrompus(enCours, new Date()),
        },
        reprise: null,
      });
      return;
    }

    const derniere = await dernierePauseTerminee(userId, weekStart);
    const reprise = derniere ? etatDeReprise(derniere, weekStart) : null;
    res.json({ etat: reprise ? "en_reprise" : "normal", pause: null, reprise });
  })
);

const declarationSchema = z.object({
  raison: z.enum(RAISONS_PAUSE),
  detail: z.string().max(500, "Précision trop longue (500 caractères maximum).").optional().default(""),
  /** Date de reprise envisagée, au format YYYY-MM-DD. */
  finPrevue: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
});

/**
 * Déclarer une interruption. Les séances planifiées à venir sont supprimées :
 * les laisser affichées reviendrait à demander à l'athlète de marquer
 * « manquée » chaque séance qu'il ne pouvait pas faire, et fausserait le bilan
 * de la semaine sur lequel le coach s'appuie ensuite.
 */
pausesRouter.post(
  "/",
  ah(async (req: AuthedRequest, res) => {
    const userId = req.userId!;
    const parsed = declarationSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, parsed.error.issues[0]?.message ?? "Déclaration invalide.");
    }

    if (await pauseEnCours(userId)) {
      throw new HttpError(400, "Une interruption est déjà en cours. Reprenez-la avant d'en déclarer une nouvelle.");
    }

    const { raison, detail, finPrevue } = parsed.data;
    const debut = new Date();
    const finPrevueDate = finPrevue ? new Date(`${finPrevue}T00:00:00.000Z`) : null;
    if (finPrevueDate && Number.isNaN(finPrevueDate.getTime())) {
      throw new HttpError(400, "Date de reprise invalide.");
    }

    const aujourdHui = new Date(debut);
    aujourdHui.setUTCHours(0, 0, 0, 0);

    const [pause] = await prisma.$transaction([
      prisma.trainingPause.create({
        data: { userId, raison, detail, debut, finPrevue: finPrevueDate },
      }),
      prisma.session.deleteMany({
        where: { userId, status: "planifiee", date: { gte: aujourdHui } },
      }),
    ]);

    res.status(201).json(pause);
  })
);

/** Reprendre l'entraînement. La reprise progressive démarre à cette date. */
pausesRouter.post(
  "/reprendre",
  ah(async (req: AuthedRequest, res) => {
    const userId = req.userId!;
    const enCours = await pauseEnCours(userId);
    if (!enCours) throw new HttpError(400, "Aucune interruption en cours.");

    const pause = await prisma.trainingPause.update({
      where: { id: enCours.id },
      data: { finReelle: new Date() },
    });

    const weekStart = startOfWeek(new Date());
    res.json({ pause, reprise: etatDeReprise(pause, weekStart) });
  })
);

/** Historique, pour que l'athlète voie ses interruptions passées. */
pausesRouter.get(
  "/historique",
  ah(async (req: AuthedRequest, res) => {
    const pauses = await prisma.trainingPause.findMany({
      where: { userId: req.userId!, finReelle: { not: null } },
      orderBy: { debut: "desc" },
      take: 20,
    });

    res.json({
      pauses: pauses.map((p) => ({
        ...p,
        libelle: LIBELLES_PAUSE[p.raison as keyof typeof LIBELLES_PAUSE] ?? p.raison,
        jours: joursInterrompus(p, new Date()),
      })),
    });
  })
);
