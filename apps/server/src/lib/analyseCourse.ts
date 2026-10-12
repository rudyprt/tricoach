import { z } from "zod";
import { LIBELLES_FORMAT, type FormatCourse } from "./races.js";
import { formatZonesForPrompt, type TrainingZones } from "./training.js";
import type { RacePlan } from "./racePlan.js";

/**
 * Analyse d'une course disputée.
 *
 * Après la course, l'athlète repartait avec un chrono et des impressions. Un
 * coach, lui, relit la course segment par segment : où le temps s'est perdu,
 * si l'allure du vélo a coûté la course à pied, si les transitions traînent,
 * ce que la nutrition a donné. Puis il en tire ce qu'il faut travailler.
 *
 * Les chiffres (durées, allures, parts du temps total) sont calculés ici : un
 * modèle de langage se trompe en arithmétique, et une allure fausse rendrait
 * toute l'analyse fausse. Le modèle n'interprète que des chiffres justes.
 */

export const SEGMENTS = ["natation", "t1", "velo", "t2", "course"] as const;
export type Segment = (typeof SEGMENTS)[number];

const LIBELLES_SEGMENT: Record<Segment, string> = {
  natation: "Natation",
  t1: "Transition 1",
  velo: "Vélo",
  t2: "Transition 2",
  course: "Course à pied",
};

/** Distances officielles : l'athlète n'a pas à les ressaisir. */
export const DISTANCES_FORMAT: Record<FormatCourse, Distances | null> = {
  sprint: { natationM: 750, veloKm: 20, courseKm: 5 },
  olympique: { natationM: 1500, veloKm: 40, courseKm: 10 },
  half: { natationM: 1900, veloKm: 90, courseKm: 21.1 },
  ironman: { natationM: 3800, veloKm: 180, courseKm: 42.2 },
  autre: null,
};

export interface Distances {
  natationM?: number;
  veloKm?: number;
  courseKm?: number;
}

/** « 1:05:30 » ou « 28:40 » ; vide si le segment n'est pas connu. */
const duree = z
  .string()
  .trim()
  .regex(/^$|^(\d{1,2}:)?[0-5]?\d:[0-5]\d$/, "Durée attendue au format h:mm:ss ou mm:ss.")
  .default("");

const fc = z.number().int().min(80, "FC trop basse.").max(230, "FC trop haute.").nullable().optional();

export const resultatSchema = z
  .object({
    natation: duree,
    t1: duree,
    velo: duree,
    t2: duree,
    course: duree,
    /** Temps officiel ; à défaut, la somme des segments. */
    total: duree,
    distances: z
      .object({
        natationM: z.number().min(100).max(10000).optional(),
        veloKm: z.number().min(5).max(300).optional(),
        courseKm: z.number().min(1).max(60).optional(),
      })
      .optional(),
    fcNatation: fc,
    fcVelo: fc,
    fcCourse: fc,
    classementGeneral: z.string().trim().max(40).default(""),
    classementCategorie: z.string().trim().max(40).default(""),
    conditions: z.string().trim().max(300).default(""),
    /** Comment ça s'est passé : incidents, nutrition, sensations. */
    ressenti: z.string().trim().max(1500).default(""),
  })
  .refine((r) => SEGMENTS.some((s) => r[s]) || r.total, "Indiquez au moins votre temps total ou un temps de segment.");

export type Resultat = z.infer<typeof resultatSchema>;

export function parseResultat(valeur: unknown): Resultat | null {
  const parsed = resultatSchema.safeParse(valeur);
  return parsed.success ? parsed.data : null;
}

export function enSecondes(texte: string): number | null {
  if (!texte) return null;
  const parties = texte.split(":").map(Number);
  if (parties.some((n) => !Number.isFinite(n))) return null;
  return parties.reduce((total, n) => total * 60 + n, 0);
}

/** Lit un temps visé en texte libre : « 2h30 », « 2h30min », « 2:30:00 », « sub 5h ». */
export function dureeLibre(texte: string): number | null {
  const hms = texte.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (hms) return Number(hms[1]) * 3600 + Number(hms[2]) * 60 + Number(hms[3] ?? 0);
  const h = texte.match(/(\d{1,2})\s*h\s*(\d{1,2})?/i);
  if (h) return Number(h[1]) * 3600 + Number(h[2] ?? 0) * 60;
  return null;
}

export function formatDuree(secondes: number): string {
  const s = Math.round(Math.abs(secondes));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}` : `${m}:${String(r).padStart(2, "0")}`;
}

export interface ChiffreSegment {
  segment: Segment;
  libelle: string;
  dureeS: number;
  duree: string;
  /** Part du temps total, en pourcentage. */
  part: number | null;
  /** Allure dans l'unité de la discipline ; null pour une transition ou sans distance. */
  allure: string | null;
  fcMoyenne: number | null;
}

export interface ChiffresCourse {
  segments: ChiffreSegment[];
  totalS: number | null;
  total: string | null;
  /** Écart au temps visé, en secondes : positif si plus lent. */
  ecartObjectifS: number | null;
  distances: Distances | null;
}

export function chiffresCourse(resultat: Resultat, format: string, objectifTemps: string): ChiffresCourse {
  const distances = { ...(DISTANCES_FORMAT[format as FormatCourse] ?? {}), ...(resultat.distances ?? {}) };
  const aDistances = Object.keys(distances).length > 0;
  const durees = SEGMENTS.map((s) => [s, enSecondes(resultat[s])] as const).filter(
    (x): x is readonly [Segment, number] => x[1] !== null && x[1] > 0
  );
  const somme = durees.reduce((t, [, d]) => t + d, 0);
  const totalS = enSecondes(resultat.total) ?? (durees.length === SEGMENTS.length ? somme : null);
  const base = totalS ?? (somme || null);

  const allure = (segment: Segment, d: number): string | null => {
    if (segment === "natation" && distances.natationM) return `${formatDuree((d / distances.natationM) * 100)}/100m`;
    if (segment === "velo" && distances.veloKm) return `${(distances.veloKm / (d / 3600)).toFixed(1)} km/h`;
    if (segment === "course" && distances.courseKm) return `${formatDuree(d / distances.courseKm)}/km`;
    return null;
  };
  const fcDe: Partial<Record<Segment, number | null | undefined>> = {
    natation: resultat.fcNatation,
    velo: resultat.fcVelo,
    course: resultat.fcCourse,
  };

  const vise = objectifTemps ? dureeLibre(objectifTemps) : null;
  return {
    segments: durees.map(([segment, d]) => ({
      segment,
      libelle: LIBELLES_SEGMENT[segment],
      dureeS: d,
      duree: formatDuree(d),
      part: base ? Math.round((d / base) * 1000) / 10 : null,
      allure: allure(segment, d),
      fcMoyenne: fcDe[segment] ?? null,
    })),
    totalS,
    total: totalS ? formatDuree(totalS) : null,
    ecartObjectifS: totalS && vise ? totalS - vise : null,
    distances: aDistances ? distances : null,
  };
}

/* ------------------------------------------------------------------ */
/* Ce que le coach produit                                             */
/* ------------------------------------------------------------------ */

export const analyseSchema = z.object({
  resume: z.string().max(700),
  segments: z
    .array(
      z.object({
        segment: z.enum(SEGMENTS),
        constat: z.string().max(400),
        conseil: z.string().max(400),
      })
    )
    .max(5),
  pointsForts: z.array(z.string().max(250)).max(4),
  axesProgres: z
    .array(
      z.object({
        titre: z.string().max(100),
        pourquoi: z.string().max(400),
        travail: z.string().max(400),
      })
    )
    .min(1)
    .max(3),
  prochaineCourse: z.string().max(600),
});

export type AnalyseCourse = z.infer<typeof analyseSchema>;

export function parseAnalyse(valeur: unknown): AnalyseCourse | null {
  const parsed = analyseSchema.safeParse(valeur);
  return parsed.success ? parsed.data : null;
}

export function parseAnalyseResponse(raw: string): AnalyseCourse {
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("Réponse IA invalide (pas de JSON trouvé).");
  let json: unknown;
  try {
    json = JSON.parse(jsonMatch[0]);
  } catch {
    throw new Error("Réponse IA invalide (JSON illisible ou tronqué).");
  }
  const parsed = analyseSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(`Réponse IA invalide (${parsed.error.issues[0]?.message ?? "format inattendu"}).`);
  }
  return parsed.data;
}

export const CONSIGNES_ANALYSE = [
  "Tu es un coach de triathlon expérimenté. Tu analyses la course qu'un athlète vient de disputer, comme au débrief du lendemain.",
  "Réponds UNIQUEMENT par un JSON valide, sans texte autour ni balises markdown, au format exact :",
  '{"resume":"string","segments":[{"segment":"natation|t1|velo|t2|course","constat":"string","conseil":"string"}],"pointsForts":["string"],"axesProgres":[{"titre":"string","pourquoi":"string","travail":"string"}],"prochaineCourse":"string"}',
  "",
  "Écris à l'athlète (« tu »), en français, concret et bienveillant, sans jargon inutile.",
  "- Les durées, allures, parts du temps total et l'écart à l'objectif sont CALCULÉS et justes : reprends-les tels quels, ne refais aucun calcul.",
  "- \"resume\" : 3 phrases maximum. La course en une vue d'ensemble, et ce qui l'a décidée.",
  "- \"segments\" : une entrée par segment dont le temps est connu. \"constat\" : ce que disent les chiffres, comparés à ses zones, à ses chronos de référence et à son plan de course s'il est fourni. \"conseil\" : une chose à faire différemment.",
  "- Cherche les enchaînements : un vélo trop rapide (FC ou allure au-dessus de ce que prévoit son plan) qui fait s'effondrer la course à pied ; une natation en surrégime ; des transitions longues pour le format (repères : moins de 2 min en sprint et olympique, 2 à 4 min en half, 3 à 6 min en Ironman, hors combinaison).",
  "- Lis son ressenti : crampes, coup de fatigue, troubles digestifs, problème mécanique. Relie-les à la gestion de l'allure ou de la nutrition quand c'est plausible, sans l'affirmer.",
  "- \"pointsForts\" : 2 à 3 réussites réelles, chiffrées si possible.",
  "- \"axesProgres\" : 2 à 3 axes, du plus rentable au moins rentable. \"travail\" décrit le type de séance qui le développe (ex : « sorties vélo longues finies par 20 min à allure course, puis 15 min de course à pied enchaînée »).",
  "- \"prochaineCourse\" : la stratégie à changer pour sa prochaine course.",
  "- Les conditions (chaleur, vent, eau froide, parcours) expliquent une partie des écarts : tiens-en compte avant de conclure à une faiblesse.",
  "Tu n'es pas médecin : une douleur ou un malaise signalés appellent à consulter, sans diagnostic.",
  "Chaque champ texte fait 50 mots maximum.",
].join("\n");

export interface ContexteAnalyse {
  nom: string;
  date: Date;
  format: string;
  priorite: string;
  objectifTemps: string;
  resultat: Resultat;
  chiffres: ChiffresCourse;
  zones: TrainingZones | null;
  chronos: string[];
  plan: RacePlan | null;
  /** Activités enregistrées le jour de la course, décrites. */
  activitesDuJour: string[];
  /** Résumé de l'entraînement des 4 semaines précédentes. */
  preparation: string;
}

export function buildAnalyseUserPrompt(ctx: ContexteAnalyse): string {
  const { resultat: r, chiffres: c } = ctx;
  const format = LIBELLES_FORMAT[ctx.format as FormatCourse] ?? ctx.format;
  const d = c.distances;
  return [
    `Course : « ${ctx.nom} », ${format}, le ${ctx.date.toISOString().slice(0, 10)}, priorité ${ctx.priorite}.`,
    d ? `Distances : natation ${d.natationM ?? "?"} m, vélo ${d.veloKm ?? "?"} km, course ${d.courseKm ?? "?"} km.` : "Distances inconnues.",
    ctx.objectifTemps ? `Temps visé : ${ctx.objectifTemps}.` : "Aucun temps visé annoncé.",
    "",
    "RÉSULTAT (chiffres calculés) :",
    ...c.segments.map(
      (s) =>
        `- ${s.libelle} : ${s.duree}${s.part !== null ? ` (${s.part} % du total)` : ""}${s.allure ? `, ${s.allure}` : ""}${s.fcMoyenne ? `, FC moyenne ${s.fcMoyenne}` : ""}`
    ),
    c.total ? `- Total : ${c.total}` : "- Total inconnu.",
    c.ecartObjectifS !== null
      ? `- Écart au temps visé : ${c.ecartObjectifS > 0 ? "+" : "−"}${formatDuree(c.ecartObjectifS)} (${c.ecartObjectifS > 0 ? "plus lent" : "plus rapide"})`
      : "",
    r.classementGeneral ? `- Classement général : ${r.classementGeneral}` : "",
    r.classementCategorie ? `- Classement catégorie : ${r.classementCategorie}` : "",
    r.conditions ? `Conditions : ${r.conditions}` : "",
    r.ressenti ? `Ce que l'athlète raconte : « ${r.ressenti} »` : "L'athlète n'a rien raconté de sa course.",
    ...(ctx.activitesDuJour.length ? ["", "Enregistré par sa montre ce jour-là :", ...ctx.activitesDuJour.map((a) => `- ${a}`)] : []),
    "",
    `Chronos de référence : ${ctx.chronos.join(" ; ") || "non renseignés"}`,
    ctx.zones ? `Zones de l'athlète :\n${formatZonesForPrompt(ctx.zones)}` : "Zones inconnues.",
    ctx.plan
      ? `Son plan de course prévoyait : natation « ${ctx.plan.natation.allure} » ; vélo « ${ctx.plan.velo.allure} » ; course « ${ctx.plan.course.allure} ».`
      : "Pas de plan de course préparé dans l'application.",
    "",
    `Sa préparation (4 semaines avant) :\n${ctx.preparation}`,
  ]
    .filter((l) => l !== "")
    .join("\n");
}

/**
 * Ce que la génération des semaines doit retenir de la dernière course
 * analysée : ses axes de progrès, pour que l'entraînement s'y attaque.
 */
export function analysePromptLines(course: { nom: string; date: Date; analyse: unknown } | null): string[] {
  const analyse = course ? parseAnalyse(course.analyse) : null;
  if (!course || !analyse) return [];
  return [
    "",
    `ANALYSE DE SA DERNIÈRE COURSE (« ${course.nom} », ${course.date.toISOString().slice(0, 10)}) — axes de progrès à travailler dans les semaines qui viennent, sans dépasser le volume autorisé :`,
    ...analyse.axesProgres.map((a) => `- ${a.titre} : ${a.travail}`),
  ];
}
