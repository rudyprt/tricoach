import { z } from "zod";
import { LIBELLES_FORMAT, type FormatCourse } from "./races.js";
import type { TrainingZones } from "./training.js";
import { formatZonesForPrompt } from "./training.js";

/**
 * Plan de course : allures cible, nutrition, hydratation, transitions.
 *
 * Sur un half ou un Ironman, ce n'est pas l'entraînement qui fait abandonner,
 * c'est de partir trop vite et de ne pas manger. L'application entraînait
 * l'athlète pendant six mois puis le laissait seul le jour J.
 */

export const blocSchema = z.object({
  titre: z.string().max(80),
  allure: z.string().max(200),
  nutrition: z.string().max(400),
  hydratation: z.string().max(300),
  erreurs: z.string().max(300),
});

export const racePlanSchema = z.object({
  resume: z.string().max(600),
  veille: z.string().max(600),
  matin: z.string().max(600),
  natation: blocSchema,
  transition1: z.string().max(400),
  velo: blocSchema,
  transition2: z.string().max(400),
  course: blocSchema,
  /** Repères chiffrés : glucides par heure, sodium, volume de boisson. */
  reperes: z.array(z.string().max(160)).max(8),
});

export type RacePlan = z.infer<typeof racePlanSchema>;

export function parseRacePlan(valeur: unknown): RacePlan | null {
  const parsed = racePlanSchema.safeParse(valeur);
  return parsed.success ? parsed.data : null;
}

/**
 * Durée d'effort attendue, qui décide de tout le reste : sur une heure, on ne
 * mange pas ; sur dix, la nutrition devient la discipline principale.
 */
const DUREE_INDICATIVE: Record<FormatCourse, string> = {
  sprint: "entre 1 h et 1 h 40",
  olympique: "entre 2 h et 3 h 30",
  half: "entre 4 h 30 et 7 h",
  ironman: "entre 9 h et 16 h",
  autre: "durée inconnue — demande-la lui implicitement en couvrant plusieurs cas",
};

export function buildRacePlanSystemPrompt(): string {
  return [
    "Tu es un coach de triathlon expérimenté qui prépare le plan de course d'un athlète.",
    "Tu réponds UNIQUEMENT avec un JSON valide, sans texte autour ni balises markdown, au format exact suivant :",
    '{"resume":"string","veille":"string","matin":"string","natation":{"titre":"string","allure":"string","nutrition":"string","hydratation":"string","erreurs":"string"},"transition1":"string","velo":{...même forme...},"transition2":"string","course":{...même forme...},"reperes":["string"]}',
    "",
    "Écris directement à l'athlète (« tu »), en français, de façon concrète et chiffrée. Pas de généralités.",
    "\"resume\" : 2 phrases sur la stratégie d'ensemble de cette course.",
    "\"veille\" et \"matin\" : ce qu'il mange et boit, à quelle heure, et ce qu'il prépare.",
    "Pour chaque discipline : \"allure\" reprend EXACTEMENT les zones fournies, sans les recalculer ; \"nutrition\" donne des quantités horaires ; \"hydratation\" donne des volumes ; \"erreurs\" nomme LA faute classique de cette partie de course.",
    "\"transition1\" et \"transition2\" : la séquence des gestes, dans l'ordre.",
    "\"reperes\" : 4 à 6 repères chiffrés à retenir (glucides par heure, sodium, volume de boisson, écart d'allure à ne pas dépasser au départ).",
    "",
    "RÈGLE DE SÉCURITÉ : la nutrition de course doit avoir été testée à l'entraînement. Dis-le explicitement dans \"veille\" ou dans \"resume\" : ne rien essayer de nouveau le jour de la course.",
    "Tu n'es pas médecin. Ne donne aucun conseil médical, aucun complément autre que boisson, glucides et sodium, et ne prescris rien à quelqu'un qui aurait un problème de santé : invite-le alors à consulter.",
    "Sois concis : chaque champ texte fait 60 mots maximum.",
  ].join("\n");
}

export interface RacePlanContext {
  nom: string;
  date: Date;
  format: string;
  lieu: string;
  objectifTemps: string;
  priorite: string;
  zones: TrainingZones | null;
  contraintes: string;
  premiereFois: boolean;
}

export function buildRacePlanUserPrompt(ctx: RacePlanContext): string {
  const format = (ctx.format as FormatCourse) ?? "autre";
  const lignes = [
    `Course : « ${ctx.nom} », ${LIBELLES_FORMAT[format] ?? ctx.format}, le ${ctx.date.toISOString().slice(0, 10)}${ctx.lieu ? ` à ${ctx.lieu}` : ""}.`,
    `Durée d'effort attendue pour ce format : ${DUREE_INDICATIVE[format] ?? DUREE_INDICATIVE.autre}.`,
    ctx.objectifTemps ? `Temps visé par l'athlète : ${ctx.objectifTemps}.` : "L'athlète n'a pas annoncé de temps visé.",
    ctx.priorite === "A"
      ? "C'est son objectif principal : il doit arriver reposé et courir pour la performance."
      : ctx.priorite === "B"
        ? "C'est un objectif secondaire : il la court en préparation d'une course plus importante, sans tout donner."
        : "C'est une course d'entraînement : elle sert de répétition générale, pas de performance.",
    ctx.premiereFois
      ? "C'est sa PREMIÈRE course sur cette distance : insiste sur la prudence au départ et sur le fait de finir."
      : "",
    ctx.contraintes ? `Contraintes et antécédents déclarés : ${ctx.contraintes}` : "",
    "",
    ctx.zones
      ? `Zones d'entraînement de l'athlète — reprends ces valeurs telles quelles pour les allures cible :\n${formatZonesForPrompt(ctx.zones)}`
      : "Les zones de cet athlète ne sont pas connues : exprime les allures en sensation et en capacité à parler.",
  ];

  return lignes.filter(Boolean).join("\n");
}

/**
 * Extrait le JSON d'une réponse du modèle. Même prudence que pour les
 * programmes : une réponse tronquée doit produire une erreur lisible, pas un
 * plan à moitié vide que l'athlète découvrirait la veille de sa course.
 */
export function parseRacePlanResponse(raw: string): RacePlan {
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("Réponse IA invalide (pas de JSON trouvé).");

  let json: unknown;
  try {
    json = JSON.parse(jsonMatch[0]);
  } catch {
    throw new Error("Réponse IA invalide (JSON illisible ou tronqué).");
  }

  const parsed = racePlanSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(`Réponse IA invalide (${parsed.error.issues[0]?.message ?? "format inattendu"}).`);
  }
  return parsed.data;
}
