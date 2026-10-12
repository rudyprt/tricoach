import { Router } from "express";
import multer from "multer";
import { prisma } from "../lib/prisma.js";
import { requireAuth, type AuthedRequest } from "../middleware/auth.js";
import { ah, HttpError } from "../lib/http.js";
import { rateLimit, byUser } from "../lib/rateLimit.js";
import { hasStandardAccess } from "../lib/subscription.js";
import { isAiConfigured, AiNotConfiguredError } from "../lib/anthropic.js";
import { MAX_CAPTURES, MAX_OCTETS_CAPTURE, TYPES_IMAGE, lireCaptures, mesuresSchema } from "../lib/captureSeance.js";
import { bilanSeance } from "../lib/bilanSeance.js";
import { serializeSession } from "../lib/session.js";
import { zonesActuelles } from "../lib/zoneInputs.js";

/**
 * Captures d'écran d'une séance : lues par le modèle, confirmées par
 * l'athlète, puis enregistrées comme une activité mesurée.
 */
export const capturesRouter = Router();
capturesRouter.use(requireAuth);

// En mémoire seulement : l'image est lue puis oubliée, rien n'est écrit.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_OCTETS_CAPTURE, files: MAX_CAPTURES },
});

const lectureRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  message: "Trop de captures lues en une heure. Réessayez plus tard.",
  keyFor: byUser,
});

const LIBELLE_SPORT: Record<string, string> = {
  natation: "natation",
  velo: "vélo",
  course: "course à pied",
  renfo: "renforcement",
};

async function seanceDe(req: AuthedRequest) {
  const seance = await prisma.session.findFirst({ where: { id: req.params.id, userId: req.userId! } });
  if (!seance) throw new HttpError(404, "Séance introuvable.");
  if (seance.sport === "repos") throw new HttpError(400, "Un jour de repos n'a rien à importer.");
  return seance;
}

/** Lit les captures et renvoie les valeurs trouvées, sans rien enregistrer. */
capturesRouter.post(
  "/:id/capture",
  lectureRateLimit,
  upload.array("captures", MAX_CAPTURES),
  ah(async (req: AuthedRequest, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.userId! } });
    if (!user || !hasStandardAccess(user)) {
      throw new HttpError(402, "Choisissez une offre pour importer vos captures d'écran.", "SUBSCRIPTION_REQUIRED");
    }
    if (!isAiConfigured()) throw new HttpError(503, new AiNotConfiguredError().message);
    const seance = await seanceDe(req);

    const images = (req.files as Express.Multer.File[] | undefined) ?? [];
    if (images.length === 0) throw new HttpError(400, "Aucune capture reçue.");
    const refusee = images.find((i) => !(TYPES_IMAGE as readonly string[]).includes(i.mimetype));
    if (refusee) {
      throw new HttpError(
        400,
        `« ${refusee.originalname} » n'est pas une image lisible (JPEG, PNG ou WebP). Sur iPhone, une capture d'écran convient ; une photo HEIC, non.`
      );
    }

    let lecture;
    try {
      lecture = await lireCaptures(req.userId!, images);
    } catch (err) {
      console.error("Lecture de capture impossible :", err);
      throw new HttpError(502, "La capture n'a pas pu être lue. Réessayez, ou saisissez les valeurs à la main.");
    }

    const avertissements: string[] = [];
    if (lecture.remarque) avertissements.push(lecture.remarque);
    if (lecture.sport && lecture.sport !== "autre" && lecture.sport !== seance.sport) {
      avertissements.push(
        `La capture semble montrer une séance de ${LIBELLE_SPORT[lecture.sport] ?? lecture.sport}, alors que celle-ci est en ${LIBELLE_SPORT[seance.sport] ?? seance.sport}.`
      );
    }
    res.json({ mesures: lecture.mesures, avertissements });
  })
);

/** Enregistre les valeurs confirmées par l'athlète et rend le bilan de la séance. */
capturesRouter.post(
  "/:id/capture/valider",
  ah(async (req: AuthedRequest, res) => {
    const seance = await seanceDe(req);
    const parsed = mesuresSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message ?? "Valeurs invalides.");
    const mesures = parsed.data;

    // Une capture par séance : la valider de nouveau corrige la précédente.
    const donnees = {
      ...mesures,
      sport: seance.sport,
      name: `Capture — ${seance.titre}`,
      startedAt: seance.date,
      sessionId: seance.id,
    };
    await prisma.activity.upsert({
      where: { source_externalId: { source: "capture", externalId: `capture-${seance.id}` } },
      create: { ...donnees, userId: req.userId!, source: "capture", externalId: `capture-${seance.id}` },
      update: donnees,
    });

    // La durée mesurée fait foi sur la durée prévue, comme pour un fichier.
    const misAJour = await prisma.session.update({
      where: { id: seance.id },
      data: {
        status: "faite",
        completedAt: seance.completedAt ?? new Date(),
        dureeReelleMin: mesures.dureeMin,
      },
    });

    const bilan = bilanSeance(serializeSession(misAJour), mesures, await zonesActuelles(req.userId!));
    res.json({ session: serializeSession(misAJour), bilan });
  })
);
