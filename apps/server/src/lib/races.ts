import { prisma } from "./prisma.js";
import { addDays, formatDate } from "./week.js";

export const PRIORITES = ["A", "B", "C"] as const;
export type PrioriteCourse = (typeof PRIORITES)[number];

export const FORMATS = ["sprint", "olympique", "half", "ironman", "autre"] as const;
export type FormatCourse = (typeof FORMATS)[number];

export const LIBELLES_FORMAT: Record<FormatCourse, string> = {
  sprint: "Sprint (750 m / 20 km / 5 km)",
  olympique: "Olympique (1,5 km / 40 km / 10 km)",
  half: "Half / 70.3 (1,9 km / 90 km / 21 km)",
  ironman: "Ironman (3,8 km / 180 km / 42 km)",
  autre: "Autre",
};

export const LIBELLES_PRIORITE: Record<PrioriteCourse, string> = {
  A: "Objectif principal",
  B: "Objectif secondaire",
  C: "Course d'entraînement",
};

export interface CourseInscrite {
  id: string;
  nom: string;
  date: Date;
  format: string;
  priorite: string;
  lieu: string;
  objectifTemps: string;
}

/**
 * La prochaine course A : c'est elle qui pilote la périodisation. Une course B
 * ou C ne construit pas une saison, elle s'y insère.
 */
export function prochaineCourseA(courses: CourseInscrite[], depuis: Date): CourseInscrite | null {
  return (
    courses
      .filter((c) => c.priorite === "A" && c.date >= depuis)
      .sort((a, b) => a.date.getTime() - b.date.getTime())[0] ?? null
  );
}

/** Les courses qui tombent dans la semaine générée. */
export function coursesDeLaSemaine(courses: CourseInscrite[], weekStart: Date): CourseInscrite[] {
  const fin = addDays(weekStart, 7);
  return courses
    .filter((c) => c.date >= weekStart && c.date < fin)
    .sort((a, b) => a.date.getTime() - b.date.getTime());
}

/**
 * Une course B proche justifie un affûtage court — quelques jours, pas deux
 * semaines. L'affûtage complet est réservé à la course A, sinon la saison n'est
 * plus qu'une suite d'affûtages et la forme ne se construit jamais.
 */
export function afutageCourtRequis(courses: CourseInscrite[], weekStart: Date): CourseInscrite | null {
  return coursesDeLaSemaine(courses, weekStart).find((c) => c.priorite === "B") ?? null;
}

/**
 * Coefficient de volume imposé par les courses de la semaine, ou null si elles
 * n'en imposent aucun. Une course C se court à l'entraînement, sans alléger.
 */
export function facteurVolumeCourses(courses: CourseInscrite[], weekStart: Date): number | null {
  const semaine = coursesDeLaSemaine(courses, weekStart);
  if (semaine.some((c) => c.priorite === "A")) return null; // La périodisation s'en charge.
  if (semaine.some((c) => c.priorite === "B")) return 0.75;
  return null;
}

function formatLisible(format: string): string {
  return LIBELLES_FORMAT[format as FormatCourse] ?? format;
}

/**
 * Consignes transmises au coach à propos des courses inscrites. Sans elles, une
 * course intermédiaire serait courue en pleine charge d'entraînement, ou bien
 * l'athlète affûterait pour chacune et n'arriverait jamais en forme à la
 * course qui compte.
 */
export function coursesPromptLines(courses: CourseInscrite[], weekStart: Date): string[] {
  if (courses.length === 0) return [];

  const semaine = coursesDeLaSemaine(courses, weekStart);
  const aVenir = courses
    .filter((c) => c.date >= addDays(weekStart, 7))
    .sort((a, b) => a.date.getTime() - b.date.getTime())
    .slice(0, 4);

  const lignes: string[] = ["", "CALENDRIER DE COURSES DE L'ATHLÈTE :"];

  for (const course of semaine) {
    const jour = formatDate(course.date);
    if (course.priorite === "A") {
      lignes.push(
        `- ${jour} — « ${course.nom} », ${formatLisible(course.format)}. OBJECTIF PRINCIPAL, couru cette semaine : la séance de ce jour EST la course.`
      );
    } else if (course.priorite === "B") {
      lignes.push(
        `- ${jour} — « ${course.nom} », ${formatLisible(course.format)}. Objectif SECONDAIRE couru cette semaine : allège les trois jours qui précèdent (affûtage court), fais-en la séance du jour, et prévois une journée facile le lendemain. Ne construis pas un affûtage complet : la forme doit continuer de monter pour l'objectif principal.`
      );
    } else {
      lignes.push(
        `- ${jour} — « ${course.nom} », ${formatLisible(course.format)}. Course d'ENTRAÎNEMENT : elle remplace la séance intensive du jour, sans allègement des jours précédents. L'athlète la court en préparation, pas pour la performance.`
      );
    }
    if (course.objectifTemps) lignes.push(`  Temps visé : ${course.objectifTemps}.`);
  }

  if (aVenir.length > 0) {
    lignes.push(
      `Courses suivantes : ${aVenir
        .map((c) => `${formatDate(c.date)} « ${c.nom} » (priorité ${c.priorite})`)
        .join(", ")}.`
    );
  }

  return lignes;
}

/** Les courses de l'athlète, à venir et récemment passées. */
export async function coursesDeLAthlete(userId: string, weekStart: Date): Promise<CourseInscrite[]> {
  return prisma.race.findMany({
    where: { userId, date: { gte: addDays(weekStart, -14) } },
    orderBy: { date: "asc" },
    select: { id: true, nom: true, date: true, format: true, priorite: true, lieu: true, objectifTemps: true },
    take: 50,
  });
}

/**
 * Aligne l'objectif du profil sur la prochaine course A.
 *
 * Le profil reste la source unique consultée par la périodisation, les zones et
 * l'affichage : le calendrier le pilote, plutôt que de dupliquer la notion
 * d'objectif à deux endroits qui finiraient par diverger.
 */
export async function synchroniserObjectif(userId: string): Promise<void> {
  const profile = await prisma.athleteProfile.findUnique({
    where: { userId },
    select: { objectif: true, objectifDate: true },
  });
  if (!profile) return;

  const maintenant = new Date();
  maintenant.setUTCHours(0, 0, 0, 0);

  const courses = await prisma.race.findMany({
    where: { userId },
    orderBy: { date: "asc" },
    select: { id: true, nom: true, date: true, format: true, priorite: true, lieu: true, objectifTemps: true },
  });

  const principale = prochaineCourseA(courses, maintenant);
  if (!principale) return;

  if (profile.objectif !== principale.nom || profile.objectifDate.getTime() !== principale.date.getTime()) {
    await prisma.athleteProfile.update({
      where: { userId },
      data: { objectif: principale.nom, objectifDate: principale.date },
    });
  }
}
