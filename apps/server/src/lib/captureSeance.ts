import { z } from "zod";
import { askClaude } from "./anthropic.js";
import { recordAiCall } from "./aiUsage.js";
import { MAX_TOKENS, MODELE_CHAT } from "./modeles.js";
import { enSecondes } from "./analyseCourse.js";

/**
 * Lecture d'une capture d'écran de séance.
 *
 * Tout le monde n'a pas de fichier .fit sous la main : beaucoup d'athlètes ont
 * seulement l'écran récapitulatif de Strava, de Garmin Connect, de Coros ou de
 * l'application du téléphone. Le modèle lit les chiffres affichés ; le serveur
 * les convertit et les vérifie, et l'athlète les confirme avant qu'ils
 * n'entrent dans son historique.
 *
 * Les images ne sont jamais conservées : elles sont lues, puis oubliées.
 */

export const TYPES_IMAGE = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
export const MAX_CAPTURES = 4;
export const MAX_OCTETS_CAPTURE = 5 * 1024 * 1024;

const CONSIGNES_LECTURE = [
  "Tu lis des captures d'écran d'une séance de sport (Strava, Garmin Connect, Coros, Polar, Suunto, Apple Santé, application de montre).",
  "Recopie les chiffres affichés, sans rien estimer ni calculer. Une valeur absente de l'image vaut null.",
  "Réponds UNIQUEMENT par un JSON valide, sans texte autour, au format :",
  '{"lisible":boolean,"sport":"natation|velo|course|renfo|autre|null","duree":"h:mm:ss|mm:ss|null","distanceKm":number|null,"allure":"m:ss/km|m:ss/100m|null","fcMoyenne":number|null,"fcMax":number|null,"puissanceMoy":number|null,"denivelePosM":number|null,"remarque":"string|null"}',
  "- \"duree\" : le temps de déplacement (ou temps actif) s'il est affiché, sinon le temps total, tel qu'écrit (ex : \"1:12:30\").",
  "- \"distanceKm\" : en kilomètres ; convertis seulement des mètres (2 000 m → 2) ou des miles (× 1,609).",
  "- \"allure\" : l'allure moyenne telle qu'affichée, avec son unité.",
  "- \"puissanceMoy\" : puissance moyenne en watts (pas la puissance normalisée).",
  "- Plusieurs captures de la même séance : combine-les.",
  "- \"lisible\" vaut false si l'image ne montre pas une séance de sport.",
  "- \"remarque\" : une phrase courte si quelque chose est ambigu (deux séances différentes, valeur coupée), sinon null.",
].join("\n");

const lectureBruteSchema = z.object({
  lisible: z.boolean(),
  sport: z.enum(["natation", "velo", "course", "renfo", "autre"]).nullable().catch(null),
  duree: z.string().nullable().catch(null),
  distanceKm: z.number().nonnegative().nullable().catch(null),
  allure: z.string().nullable().catch(null),
  fcMoyenne: z.number().nullable().catch(null),
  fcMax: z.number().nullable().catch(null),
  puissanceMoy: z.number().nullable().catch(null),
  denivelePosM: z.number().nullable().catch(null),
  remarque: z.string().max(300).nullable().catch(null),
});

/** Ce que l'athlète confirme : les valeurs de la capture, corrigées s'il le faut. */
export const mesuresSchema = z.object({
  dureeMin: z.number().int().min(1, "Indiquez la durée de la séance.").max(1440),
  distanceKm: z.number().min(0).max(1000).nullable().default(null),
  allureSecParKm: z.number().int().min(60).max(1800).nullable().default(null),
  fcMoyenne: z.number().int().min(40).max(230).nullable().default(null),
  fcMax: z.number().int().min(60).max(240).nullable().default(null),
  puissanceMoy: z.number().int().min(0).max(2500).nullable().default(null),
  denivelePosM: z.number().int().min(0).max(15000).nullable().default(null),
});
export type Mesures = z.infer<typeof mesuresSchema>;

export interface LectureCapture {
  sport: string | null;
  mesures: Partial<Mesures>;
  remarque: string | null;
}

const bornee = (v: number | null, min: number, max: number) =>
  v !== null && Number.isFinite(v) && v >= min && v <= max ? Math.round(v) : null;

/** « 4:52/km » → 292 ; une allure aux 100 m reste hors du champ, propre à la course. */
function allureParKm(texte: string | null): number | null {
  if (!texte || !/\/\s*km/i.test(texte)) return null;
  const m = texte.match(/(\d{1,2}):(\d{2})/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** Convertit et vérifie ce que le modèle a lu : des valeurs plausibles, ou rien. */
export function interpreterLecture(brute: z.infer<typeof lectureBruteSchema>): LectureCapture {
  const secondes = brute.duree ? enSecondes(brute.duree.trim()) : null;
  const dureeMin = secondes ? bornee(secondes / 60, 1, 1440) : null;
  const distanceKm =
    brute.distanceKm !== null && brute.distanceKm > 0 && brute.distanceKm <= 1000
      ? Math.round(brute.distanceKm * 100) / 100
      : null;
  let allure = allureParKm(brute.allure);
  if (!allure && brute.sport === "course" && dureeMin && distanceKm) allure = Math.round((dureeMin * 60) / distanceKm);

  return {
    sport: brute.sport,
    mesures: {
      dureeMin: dureeMin ?? undefined,
      distanceKm,
      allureSecParKm: bornee(allure, 60, 1800),
      fcMoyenne: bornee(brute.fcMoyenne, 40, 230),
      fcMax: bornee(brute.fcMax, 60, 240),
      puissanceMoy: bornee(brute.puissanceMoy, 1, 2500),
      denivelePosM: bornee(brute.denivelePosM, 0, 15000),
    },
    remarque: brute.remarque,
  };
}

export async function lireCaptures(
  userId: string,
  images: { buffer: Buffer; mimetype: string }[]
): Promise<LectureCapture> {
  const response = await askClaude({
    modele: MODELE_CHAT,
    etiquette: "lecture_capture",
    system: CONSIGNES_LECTURE,
    messages: [
      {
        role: "user",
        content: [
          ...images.map((image) => ({
            type: "image" as const,
            source: {
              type: "base64" as const,
              media_type: image.mimetype as (typeof TYPES_IMAGE)[number],
              data: image.buffer.toString("base64"),
            },
          })),
          { type: "text" as const, text: "Lis cette séance." },
        ],
      },
    ],
    maxTokens: MAX_TOKENS.lectureCapture,
  });

  const json = response.text.match(/\{[\s\S]*\}/)?.[0];
  let brute: z.infer<typeof lectureBruteSchema> | null = null;
  try {
    const parsed = json ? lectureBruteSchema.safeParse(JSON.parse(json)) : null;
    brute = parsed?.success ? parsed.data : null;
  } catch {
    brute = null;
  }
  await recordAiCall({ userId, kind: "lecture_capture", response, succeeded: Boolean(brute?.lisible) });

  if (!brute) throw new Error("Lecture de capture illisible.");
  if (!brute.lisible) {
    return { sport: null, mesures: {}, remarque: "Cette image ne ressemble pas au récapitulatif d'une séance." };
  }
  return interpreterLecture(brute);
}
