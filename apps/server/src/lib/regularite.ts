import { prisma } from "./prisma.js";
import { addDays, formatDate, startOfWeek } from "./week.js";

/**
 * Régularité et jalons.
 *
 * L'application mesurait la charge et les seuils, mais ne disait jamais à
 * l'athlète ce qu'il avait accompli. Or ce qui fait revenir quelqu'un semaine
 * après semaine, ce n'est pas une courbe de fatigue : c'est de voir que la
 * série tient, et qu'un cap vient d'être franchi.
 */

export interface SemaineTenue {
  weekStart: string;
  prevuMin: number;
  realiseMin: number;
  seancesPrevues: number;
  seancesFaites: number;
  /** Une semaine compte comme tenue dès que les deux tiers sont réalisés. */
  tenue: boolean;
}

/** Seuil de réussite d'une semaine. Exiger 100 % découragerait plus qu'il ne motive. */
const PART_MINIMALE = 2 / 3;

export interface Jalon {
  cle: string;
  titre: string;
  detail: string;
  /** Date à laquelle il a été atteint. */
  atteintLe: string;
}

export interface BilanRegularite {
  /** Semaines tenues consécutives, en remontant depuis la dernière terminée. */
  serie: number;
  /** Meilleure série jamais atteinte. */
  meilleureSerie: number;
  semaines: SemaineTenue[];
  totalSeances: number;
  totalHeures: number;
  jalons: Jalon[];
}

/** Nombre de semaines rendues : un trimestre se lit d'un coup d'œil. */
const FENETRE_SEMAINES = 12;

function partRealisee(semaine: SemaineTenue): boolean {
  if (semaine.seancesPrevues === 0) return false;
  return semaine.seancesFaites / semaine.seancesPrevues >= PART_MINIMALE;
}

export async function bilanRegularite(userId: string, timezone: string): Promise<BilanRegularite> {
  const semaineCourante = startOfWeek(new Date(), timezone);
  const debut = addDays(semaineCourante, -7 * (FENETRE_SEMAINES - 1));

  const [sessions, total] = await Promise.all([
    prisma.session.findMany({
      where: { userId, date: { gte: debut }, sport: { not: "repos" } },
      select: { date: true, dureeMin: true, dureeReelleMin: true, status: true },
      orderBy: { date: "asc" },
      take: 500,
    }),
    prisma.session.aggregate({
      where: { userId, status: "faite", sport: { not: "repos" } },
      _count: { _all: true },
      _sum: { dureeMin: true },
    }),
  ]);

  const parSemaine = new Map<string, SemaineTenue>();
  for (let i = 0; i < FENETRE_SEMAINES; i += 1) {
    const cle = formatDate(addDays(debut, i * 7));
    parSemaine.set(cle, {
      weekStart: cle,
      prevuMin: 0,
      realiseMin: 0,
      seancesPrevues: 0,
      seancesFaites: 0,
      tenue: false,
    });
  }

  for (const session of sessions) {
    const cle = formatDate(startOfWeek(session.date, "UTC"));
    const semaine = parSemaine.get(cle);
    if (!semaine) continue;

    semaine.prevuMin += session.dureeMin;
    semaine.seancesPrevues += 1;
    if (session.status === "faite") {
      // Le réalisé est celui que l'athlète a corrigé, s'il l'a fait.
      semaine.realiseMin += session.dureeReelleMin ?? session.dureeMin;
      semaine.seancesFaites += 1;
    }
  }

  const semaines = [...parSemaine.values()].map((s) => ({ ...s, tenue: partRealisee(s) }));

  // La semaine en cours est exclue du décompte : elle n'est pas finie, et la
  // voir « non tenue » un mardi serait décourageant et faux.
  const terminees = semaines.filter((s) => s.weekStart !== formatDate(semaineCourante));

  let serie = 0;
  for (let i = terminees.length - 1; i >= 0; i -= 1) {
    if (!terminees[i].tenue) break;
    serie += 1;
  }

  let meilleureSerie = 0;
  let courante = 0;
  for (const semaine of terminees) {
    courante = semaine.tenue ? courante + 1 : 0;
    meilleureSerie = Math.max(meilleureSerie, courante);
  }

  const totalSeances = total._count._all;
  const totalHeures = Math.round((total._sum.dureeMin ?? 0) / 60);

  return {
    serie,
    meilleureSerie,
    semaines,
    totalSeances,
    totalHeures,
    jalons: await jalonsAtteints(userId, totalSeances, totalHeures),
  };
}

const PALIERS_SEANCES = [10, 25, 50, 100, 250, 500];
const PALIERS_HEURES = [25, 50, 100, 250, 500, 1000];

/**
 * Jalons franchis, du plus récent au plus ancien.
 *
 * Volontairement peu nombreux et liés au volume réel : des badges décernés pour
 * chaque clic n'auraient aucune valeur, et l'athlète le verrait tout de suite.
 */
async function jalonsAtteints(userId: string, totalSeances: number, totalHeures: number): Promise<Jalon[]> {
  const jalons: Jalon[] = [];

  const derniere = await prisma.session.findFirst({
    where: { userId, status: "faite", sport: { not: "repos" } },
    orderBy: { date: "desc" },
    select: { date: true },
  });
  const date = derniere ? formatDate(derniere.date) : formatDate(new Date());

  const dernierPalierSeances = [...PALIERS_SEANCES].reverse().find((p) => totalSeances >= p);
  if (dernierPalierSeances) {
    jalons.push({
      cle: `seances-${dernierPalierSeances}`,
      titre: `${dernierPalierSeances} séances réalisées`,
      detail: "Chacune compte, y compris les plus courtes.",
      atteintLe: date,
    });
  }

  const dernierPalierHeures = [...PALIERS_HEURES].reverse().find((p) => totalHeures >= p);
  if (dernierPalierHeures) {
    jalons.push({
      cle: `heures-${dernierPalierHeures}`,
      titre: `${dernierPalierHeures} heures d'entraînement`,
      detail: "Le volume accumulé est ce qui construit votre endurance.",
      atteintLe: date,
    });
  }

  return jalons;
}

export interface RecordPersonnel {
  sport: string;
  libelle: string;
  valeur: string;
  date: string;
}

/**
 * Meilleures performances mesurées, par discipline et par distance.
 *
 * Tirées des activités importées : ce sont des mesures, pas des déclarations.
 */
export async function recordsPersonnels(userId: string): Promise<RecordPersonnel[]> {
  const activites = await prisma.activity.findMany({
    where: { userId, distanceKm: { not: null }, allureSecParKm: { not: null } },
    select: { sport: true, distanceKm: true, allureSecParKm: true, startedAt: true, dureeMin: true },
    orderBy: { startedAt: "desc" },
    take: 500,
  });

  const distances = [
    { sport: "course", km: 5, tolerance: 0.4, libelle: "5 km" },
    { sport: "course", km: 10, tolerance: 0.8, libelle: "10 km" },
    { sport: "course", km: 21.1, tolerance: 1.5, libelle: "Semi-marathon" },
    { sport: "course", km: 42.2, tolerance: 2.5, libelle: "Marathon" },
  ];

  const records: RecordPersonnel[] = [];

  for (const cible of distances) {
    // Une sortie de 10,6 km compte comme un 10 km : personne ne s'arrête au
    // mètre près, et exiger la distance exacte ne retiendrait presque rien.
    const candidates = activites.filter(
      (a) =>
        a.sport === cible.sport &&
        a.distanceKm != null &&
        Math.abs(a.distanceKm - cible.km) <= cible.tolerance
    );
    if (candidates.length === 0) continue;

    const meilleure = candidates.reduce((a, b) => (a.allureSecParKm! <= b.allureSecParKm! ? a : b));
    const secondes = Math.round(meilleure.allureSecParKm! * cible.km);
    records.push({
      sport: cible.sport,
      libelle: cible.libelle,
      valeur: formatChrono(secondes),
      date: formatDate(meilleure.startedAt),
    });
  }

  return records;
}

function formatChrono(secondes: number): string {
  const h = Math.floor(secondes / 3600);
  const m = Math.floor((secondes % 3600) / 60);
  const s = secondes % 60;
  return h > 0
    ? `${h}h${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}
