import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth, type AuthedRequest } from "../middleware/auth.js";
import { serializeSession } from "../lib/session.js";
import { ah, HttpError } from "../lib/http.js";
import { harmoniserDistances } from "../lib/distanceSeance.js";
import { zonesActuelles } from "../lib/zoneInputs.js";
import { ajouterFrequencesCardiaques, rafraichirCibles } from "../lib/cibles.js";
import { bilanSeance } from "../lib/bilanSeance.js";
import { construireFitWorkout, nomFichierFit } from "../lib/fitWorkout.js";
import { parseMateriel } from "../lib/disponibilites.js";
import { redigerFelicitations } from "../lib/felicitations.js";
import { calculerRavitaillement, intensiteSeance } from "../lib/nutrition.js";
import { chargerProfilRavito } from "../lib/nutritionDonnees.js";
import { isPremium } from "../lib/subscription.js";
import { addDays } from "../lib/week.js";
import { santeAutorisee } from "../lib/consentSante.js";

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
      // La distance totale est la somme des blocs : annonce et plan ne divergent plus.
      sessions: zones
        ? harmoniserDistances(ajouterFrequencesCardiaques(rafraichirCibles(serialisees, zones).seances, zones), zones)
        : serialisees,
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
  /** Case de consentement cochée sous le ressenti, quand il n'était pas encore donné. */
  consentSante: z.boolean().optional(),
});

sessionsRouter.patch(
  "/:id",
  ah(async (req: AuthedRequest, res) => {
    const parsed = completeSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Données invalides." });
      return;
    }

    /*
     * Un ressenti parle souvent d'une douleur : c'est une donnée de santé, qui
     * n'est enregistrée qu'avec le consentement de l'athlète.
     */
    if (parsed.data.ressenti?.trim()) {
      if (!(await santeAutorisee(req.userId!, parsed.data.consentSante))) {
        throw new HttpError(400, "Cochez la case de consentement pour que votre ressenti puisse être enregistré.");
      }
    }

    // La mise à jour porte sur l'identifiant ET le propriétaire : impossible de
    // modifier la séance d'un autre athlète, même en cas de course entre requêtes.
    const { count } = await prisma.session.updateMany({
      where: { id: req.params.id, userId: req.userId! },
      data: {
        status: parsed.data.status,
        ressenti: parsed.data.ressenti === undefined ? undefined : parsed.data.ressenti.trim() || null,
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
/**
 * Bilan d'une séance faite à partir du fichier de la montre : ce qui a été
 * fait, comparé à ce qui était prévu. Calcul pur, sans appel au modèle.
 */
/**
 * Le message qui suit une séance faite : bravo, ce qu'elle a été, comment en
 * récupérer. L'offre Premium y ajoute la nutrition de récupération dosée.
 */
sessionsRouter.get(
  "/:id/felicitations",
  ah(async (req: AuthedRequest, res) => {
    const userId = req.userId!;
    const seance = await prisma.session.findFirst({ where: { id: req.params.id, userId } });
    if (!seance) throw new HttpError(404, "Séance introuvable.");
    if (seance.status !== "faite" || seance.sport === "repos") {
      res.json({ felicitations: null });
      return;
    }

    const [user, activite, prochaine] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: { plan: true } }),
      prisma.activity.findFirst({ where: { sessionId: seance.id, userId }, orderBy: { importedAt: "desc" } }),
      prisma.session.findFirst({
        where: { userId, date: { gt: seance.date, lte: addDays(seance.date, 2) }, sport: { not: "repos" } },
        orderBy: { date: "asc" },
      }),
    ]);
    const zones = await zonesActuelles(userId);
    const serialisee = serializeSession(seance);
    const premium = Boolean(user && isPremium(user));

    let nutritionApres: string[] | null = null;
    if (premium) {
      const ravito = calculerRavitaillement(
        { sport: seance.sport, titre: seance.titre, dureeMin: seance.dureeReelleMin ?? seance.dureeMin, structure: serialisee.structure },
        await chargerProfilRavito(userId),
        { seanceLeLendemain: Boolean(prochaine && prochaine.date <= addDays(seance.date, 1)) }
      );
      nutritionApres = ravito?.apres ?? null;
    }

    res.json({
      felicitations: redigerFelicitations(
        { ...serialisee, structure: serialisee.structure },
        {
          mesures: activite,
          niveauBilan: activite ? bilanSeance(serialisee, activite, zones).niveau : null,
          prochaine: prochaine
            ? {
                titre: prochaine.titre,
                dansJours: Math.round((prochaine.date.getTime() - seance.date.getTime()) / 86400000),
                intense: intensiteSeance({
                  sport: prochaine.sport,
                  titre: prochaine.titre,
                  dureeMin: prochaine.dureeMin,
                  structure: serializeSession(prochaine).structure,
                }).max >= 4,
              }
            : null,
          nutritionApres,
        }
      ),
      premium,
    });
  })
);

sessionsRouter.get(
  "/:id/bilan",
  ah(async (req: AuthedRequest, res) => {
    const seance = await prisma.session.findFirst({ where: { id: req.params.id, userId: req.userId! } });
    if (!seance) throw new HttpError(404, "Séance introuvable.");
    const activite = await prisma.activity.findFirst({
      where: { sessionId: seance.id, userId: req.userId! },
      orderBy: { importedAt: "desc" },
    });
    if (!activite) {
      res.json({ bilan: null });
      return;
    }
    res.json({ bilan: bilanSeance(serializeSession(seance), activite, await zonesActuelles(req.userId!)) });
  })
);

sessionsRouter.get(
  "/:id/workout.fit",
  ah(async (req: AuthedRequest, res) => {
    const seance = await prisma.session.findFirst({
      where: { id: req.params.id, userId: req.userId! },
    });
    if (!seance) throw new HttpError(404, "Séance introuvable.");

    const zones = await zonesActuelles(req.userId!);
    if (!zones) throw new HttpError(400, "Renseignez votre profil pour exporter une séance.");

    /* La natation s'encode selon le bassin : une séance en bassin se compte en
     * longueurs, une séance en eau libre en minutes. Sans cette information le
     * fichier est refusé par la montre. */
    const profil = await prisma.athleteProfile.findUnique({
      where: { userId: req.userId! },
      select: { materiel: true },
    });
    const bassin = parseMateriel(profil?.materiel)?.piscine ?? null;

    const serialisee = serializeSession(seance);
    // Même titre et même distance que dans l'application.
    const [aJour] = harmoniserDistances(ajouterFrequencesCardiaques(rafraichirCibles([serialisee], zones).seances, zones), zones);

    const fichier = construireFitWorkout(aJour, zones, bassin);
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
