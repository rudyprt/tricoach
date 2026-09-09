import { Router } from "express";
import multer from "multer";
import { prisma } from "../lib/prisma.js";
import { requireAuth, type AuthedRequest } from "../middleware/auth.js";
import { ah, HttpError } from "../lib/http.js";
import { MAX_FILE_BYTES, formatFromFilename, parseActivityFile } from "../lib/activityFiles.js";
import { findMatchingSession } from "../lib/activityMatching.js";
import { rateLimit, byUser } from "../lib/rateLimit.js";

export const activitiesRouter = Router();
activitiesRouter.use(requireAuth);

// Les fichiers restent en mémoire : ils sont analysés puis jetés, rien n'est
// écrit sur disque, ce qui évite tout nettoyage et toute fuite de fichiers.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES, files: 10 },
});

const importRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 60,
  message: "Trop d'imports en une heure. Réessayez plus tard.",
  keyFor: byUser,
});

activitiesRouter.get(
  "/",
  ah(async (req: AuthedRequest, res) => {
    const activities = await prisma.activity.findMany({
      where: { userId: req.userId! },
      orderBy: { startedAt: "desc" },
      take: 50,
    });
    res.json({ activities });
  })
);

/**
 * Import de fichiers exportés depuis une montre. C'est l'alternative sans
 * service tiers : elle fonctionne avec toutes les marques, et ne dépend
 * d'aucun abonnement ni d'aucune autorisation.
 */
activitiesRouter.post(
  "/import",
  importRateLimit,
  upload.array("fichiers", 10),
  ah(async (req: AuthedRequest, res) => {
    const fichiers = (req.files as Express.Multer.File[] | undefined) ?? [];
    if (fichiers.length === 0) {
      throw new HttpError(400, "Aucun fichier reçu. Déposez un fichier .fit, .gpx ou .tcx.");
    }

    const resultats: { fichier: string; statut: string; detail?: string }[] = [];
    let importees = 0;
    let rapprochees = 0;

    for (const fichier of fichiers) {
      const nom = fichier.originalname;
      if (!formatFromFilename(nom)) {
        resultats.push({ fichier: nom, statut: "ignore", detail: "Format non reconnu (.fit, .gpx ou .tcx attendu)." });
        continue;
      }

      try {
        const activite = parseActivityFile(fichier.buffer, nom);

        // Un même fichier réimporté ne doit pas créer de doublon, même renommé :
        // l'identifiant est dérivé de la date de début et de la durée.
        const existante = await prisma.activity.findUnique({
          where: { source_externalId: { source: "fichier", externalId: activite.externalId } },
        });
        if (existante) {
          resultats.push({ fichier: nom, statut: "deja_importe" });
          continue;
        }

        const jour = activite.startedAt;
        const sessions = await prisma.session.findMany({
          where: {
            userId: req.userId!,
            date: {
              gte: new Date(new Date(jour).setUTCHours(0, 0, 0, 0) - 24 * 60 * 60 * 1000),
              lte: new Date(new Date(jour).setUTCHours(0, 0, 0, 0) + 24 * 60 * 60 * 1000),
            },
          },
          select: { id: true, date: true, sport: true, dureeMin: true, status: true },
        });
        const session = findMatchingSession(activite, sessions);

        const { format, ...donnees } = activite;
        await prisma.activity.create({
          data: { ...donnees, userId: req.userId!, source: "fichier", sessionId: session?.id ?? null },
        });
        importees += 1;

        // Une séance déjà renseignée par l'athlète n'est pas écrasée.
        if (session && session.status === "planifiee") {
          await prisma.session.update({
            where: { id: session.id },
            data: { status: "faite", completedAt: activite.startedAt },
          });
          rapprochees += 1;
        }

        resultats.push({
          fichier: nom,
          statut: session ? "importe_et_rattache" : "importe",
          detail: `${format.toUpperCase()} · ${activite.dureeMin} min${activite.distanceKm ? ` · ${activite.distanceKm} km` : ""}`,
        });
      } catch (err) {
        // Un fichier illisible n'interrompt pas les autres : l'athlète peut en
        // déposer plusieurs d'un coup.
        resultats.push({
          fichier: nom,
          statut: "erreur",
          detail: err instanceof HttpError ? err.message : "Fichier illisible.",
        });
      }
    }

    res.json({ importees, rapprochees, resultats });
  })
);

activitiesRouter.delete(
  "/:id",
  ah(async (req: AuthedRequest, res) => {
    const { count } = await prisma.activity.deleteMany({
      where: { id: req.params.id, userId: req.userId! },
    });
    if (count === 0) throw new HttpError(404, "Activité introuvable.");
    res.json({ ok: true });
  })
);
