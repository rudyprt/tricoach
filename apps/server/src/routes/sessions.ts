import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth, type AuthedRequest } from "../middleware/auth.js";
import { serializeSession } from "../lib/session.js";
import { ah, HttpError } from "../lib/http.js";
import { zonesActuelles } from "../lib/zoneInputs.js";
import { rafraichirCibles } from "../lib/cibles.js";
import { construireFitWorkout, nomFichierFit } from "../lib/fitWorkout.js";

export const sessionsRouter = Router();
sessionsRouter.use(requireAuth);

const listQuerySchema = z.object({
  /** Bornes de dates, au format AAAA-MM-JJ. */
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
  cursor: z.string().min(1).optional(),
});

/**
 * L'historique d'un athlète grandit indéfiniment : sans borne, cette route
 * finit par renvoyer plusieurs années de séances à chaque ouverture de
 * l'application. Les appelants qui veulent tout parcourent les pages.
 */
sessionsRouter.get(
  "/",
  ah(async (req: AuthedRequest, res) => {
    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw new HttpError(400, "Paramètres de liste invalides.");
    }
    const { from, to, limit, cursor } = parsed.data;

    const sessions = await prisma.session.findMany({
      where: {
        userId: req.userId!,
        ...(from || to
          ? {
              date: {
                ...(from ? { gte: new Date(`${from}T00:00:00.000Z`) } : {}),
                ...(to ? { lte: new Date(`${to}T00:00:00.000Z`) } : {}),
              },
            }
          : {}),
      },
      orderBy: { date: "asc" },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    const hasMore = sessions.length > limit;
    const page = hasMore ? sessions.slice(0, limit) : sessions;

    // Les séances encore à faire sont relues sur les zones du moment : un test
    // passé depuis leur génération a pu déplacer les seuils.
    const zones = await zonesActuelles(req.userId!);
    const serialisees = page.map(serializeSession);

    res.json({
      sessions: zones ? rafraichirCibles(serialisees, zones).seances : serialisees,
      nextCursor: hasMore ? page[page.length - 1]?.id : null,
    });
  })
);

const completeSchema = z.object({
  status: z.enum(["planifiee", "faite", "manquee"]),
  ressenti: z.string().max(1000, "Ressenti trop long (1000 caractères maximum).").optional(),
  /**
   * Durée réellement effectuée, si elle diffère du prévu. Corriger une séance
   * passée n'était possible qu'en important un fichier de montre — or on écourte
   * ou on rallonge une séance pour mille raisons.
   */
  dureeReelleMin: z.number().int().min(1).max(1440, "Durée invalide.").nullable().optional(),
});

sessionsRouter.patch(
  "/:id",
  ah(async (req: AuthedRequest, res) => {
    const parsed = completeSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Données invalides." });
      return;
    }

    // La mise à jour porte sur l'identifiant ET le propriétaire : impossible de
    // modifier la séance d'un autre athlète, même en cas de course entre requêtes.
    const { count } = await prisma.session.updateMany({
      where: { id: req.params.id, userId: req.userId! },
      data: {
        status: parsed.data.status,
        ressenti: parsed.data.ressenti,
        // `undefined` laisse la valeur en place ; seul un null explicite
        // l'efface, ce qui distingue « je ne corrige pas » de « je reviens au
        // prévu ».
        ...(parsed.data.dureeReelleMin !== undefined ? { dureeReelleMin: parsed.data.dureeReelleMin } : {}),
        completedAt: parsed.data.status === "faite" ? new Date() : null,
      },
    });
    if (count === 0) {
      throw new HttpError(404, "Séance introuvable.");
    }

    const updated = await prisma.session.findUniqueOrThrow({ where: { id: req.params.id } });
    res.json(serializeSession(updated));
  })
);

const swapSchema = z.object({
  sessionIdA: z.string().min(1),
  sessionIdB: z.string().min(1),
});

sessionsRouter.post(
  "/swap",
  ah(async (req: AuthedRequest, res) => {
    const parsed = swapSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Données invalides." });
      return;
    }
    const { sessionIdA, sessionIdB } = parsed.data;
    if (sessionIdA === sessionIdB) {
      res.status(400).json({ error: "Sélectionnez deux séances différentes." });
      return;
    }

    const owned = await prisma.session.findMany({
      where: { id: { in: [sessionIdA, sessionIdB] }, userId: req.userId! },
    });
    const a = owned.find((s) => s.id === sessionIdA);
    const b = owned.find((s) => s.id === sessionIdB);
    if (!a || !b) {
      throw new HttpError(404, "Séance introuvable.");
    }

    const [updatedA, updatedB] = await prisma.$transaction([
      prisma.session.update({ where: { id: a.id }, data: { date: b.date } }),
      prisma.session.update({ where: { id: b.id }, data: { date: a.date } }),
    ]);

    res.json([serializeSession(updatedA), serializeSession(updatedB)]);
  })
);

/**
 * La séance au format FIT, à importer dans Garmin Connect, l'application Coros
 * ou tout autre outil qui accepte un entraînement structuré.
 *
 * Les intensités sont celles du moment, pas celles de la génération : un test
 * passé depuis a pu déplacer les seuils, et c'est le fichier emporté sur la
 * montre qui doit en tenir compte.
 */
sessionsRouter.get(
  "/:id/workout.fit",
  ah(async (req: AuthedRequest, res) => {
    const seance = await prisma.session.findFirst({
      where: { id: req.params.id, userId: req.userId! },
    });
    if (!seance) throw new HttpError(404, "Séance introuvable.");

    const zones = await zonesActuelles(req.userId!);
    if (!zones) throw new HttpError(400, "Renseignez votre profil pour exporter une séance.");

    const serialisee = serializeSession(seance);
    const [aJour] = rafraichirCibles([serialisee], zones).seances;

    const fichier = construireFitWorkout(aJour, zones);
    if (!fichier) {
      throw new HttpError(422, "Cette séance n'a pas de structure exportable (repos ou séance libre).");
    }

    res.setHeader("Content-Type", "application/vnd.ant.fit");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${nomFichierFit(seance.date, seance.sport, seance.titre)}"`
    );
    res.send(Buffer.from(fichier));
  })
);
