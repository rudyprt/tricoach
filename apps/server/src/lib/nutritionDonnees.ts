import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "./prisma.js";
import { addDays } from "./week.js";
import {
  cibleCourseGH,
  sudationRetenue,
  toleranceDigestive,
  type ObjectifDigestif,
  type PriseJournal,
  type ProfilRavito,
} from "./nutrition.js";

/**
 * Ce que l'application sait de la nutrition d'un athlète : ses préférences,
 * ses tests de sudation, et ce que son journal dit de son estomac.
 */

export const journalSchema = z.object({
  glucidesG: z.number().int().min(0).max(1500),
  boissonMl: z.number().int().min(0).max(15000).default(0),
  tolerance: z.enum(["bien", "gene", "troubles"]),
  note: z.string().trim().max(300).default(""),
});
export type JournalNutrition = z.infer<typeof journalSchema>;

/** Le journal sert sur dix semaines : au-delà, l'estomac a changé. */
const FENETRE_JOURNAL_JOURS = 70;
/** L'entraînement digestif commence seize semaines avant la course. */
const FENETRE_DIGESTIVE_SEMAINES = 16;

export async function chargerProfilRavito(userId: string): Promise<ProfilRavito> {
  const [profil, tests, journal] = await Promise.all([
    prisma.profilNutrition.findUnique({ where: { userId } }),
    prisma.testSudation.findMany({ where: { userId }, orderBy: { date: "desc" }, take: 20 }),
    prisma.session.findMany({
      where: {
        userId,
        nutritionPrise: { not: Prisma.DbNull },
        date: { gte: addDays(new Date(), -FENETRE_JOURNAL_JOURS) },
      },
      select: { nutritionPrise: true, dureeMin: true, dureeReelleMin: true },
      take: 100,
    }),
  ]);

  const prises: PriseJournal[] = journal.flatMap((s) => {
    const parsed = journalSchema.safeParse(s.nutritionPrise);
    return parsed.success
      ? [{ glucidesG: parsed.data.glucidesG, tolerance: parsed.data.tolerance, dureeMin: s.dureeReelleMin ?? s.dureeMin }]
      : [];
  });

  return {
    poidsKg: profil?.poidsKg ?? null,
    formats: profil?.formats ?? [],
    cafeine: profil?.cafeine ?? false,
    sueurSalee: profil?.sueurSalee ?? false,
    sudation: {
      course: sudationRetenue(tests, "course"),
      velo: sudationRetenue(tests, "velo"),
      natation: sudationRetenue(tests, "natation"),
      global: sudationRetenue(tests),
    },
    ...toleranceDigestive(prises),
  };
}

/**
 * La prochaine course qui demande d'entraîner l'estomac, si elle tombe dans
 * les seize semaines qui suivent la séance. La course A d'abord.
 */
export async function objectifDigestif(userId: string, dateSeance: Date): Promise<ObjectifDigestif | null> {
  const courses = await prisma.race.findMany({
    where: { userId, date: { gte: dateSeance, lte: addDays(dateSeance, FENETRE_DIGESTIVE_SEMAINES * 7) } },
    orderBy: [{ priorite: "asc" }, { date: "asc" }],
    select: { nom: true, date: true, format: true, discipline: true, distanceKm: true },
  });
  for (const course of courses) {
    const cible = cibleCourseGH(course);
    if (cible) {
      return {
        nom: course.nom,
        cibleCourseGH: cible,
        semainesRestantes: Math.max(0, Math.round((course.date.getTime() - dateSeance.getTime()) / (7 * 86400000))),
      };
    }
  }
  return null;
}

/** Une ligne pour le coach : ce qui personnalise ses conseils de ravitaillement. */
export function nutritionPromptLigne(p: ProfilRavito): string {
  const morceaux = [
    p.sudation?.global ? `sudation mesurée ${p.sudation.global} ml/h` : "",
    p.sueurSalee ? "sueur salée" : "",
    p.toleranceGH ? `tolère ${p.toleranceGH} g/h de glucides` : "",
    p.limiteGH ? `troubles digestifs à partir de ${p.limiteGH} g/h` : "",
    p.formats?.length ? `formats préférés : ${p.formats.join(", ")}` : "",
    p.cafeine ? "caféine habituelle" : "",
  ].filter(Boolean);
  return morceaux.length ? `Nutrition de l'athlète : ${morceaux.join(" ; ")}.` : "";
}
