import { prisma } from "./prisma.js";
import type { ZoneInputs } from "./training.js";
import { parseZoneOverrides } from "./zoneOverrides.js";
import { parseMateriel } from "./disponibilites.js";

/** Profil, tel que stocké, avec les champs utiles au calcul des zones. */
export interface ProfileZoneFields {
  tempsCourse: string;
  tempsNatation: string;
  tempsVelo: string;
  ftpWatts: number | null;
  seuilCourseSecParKm: number | null;
  cssSecPer100m: number | null;
  fcSeuil: number | null;
  fcMax: number | null;
  customZones: unknown;
  /** Matériel et accès déclarés, dont le bassin où l'athlète nage. */
  materiel?: unknown;
}

/**
 * Rassemble tout ce qui alimente le calcul des zones, y compris ce que les
 * séances importées révèlent.
 *
 * La fréquence cardiaque maximale observée sur les activités est une mesure
 * directe, pas un modèle : s'en servir quand l'athlète n'a pas fait de test
 * vaut mieux que la formule « 220 moins l'âge », dont l'écart-type dépasse
 * dix battements.
 */
export async function buildZoneInputs(userId: string, profile: ProfileZoneFields): Promise<ZoneInputs> {
  let fcMax = profile.fcMax;

  if (!fcMax) {
    const observee = await prisma.activity.aggregate({
      where: {
        userId,
        // Une valeur trop ancienne ne décrit plus l'athlète ; une valeur
        // aberrante de capteur est écartée par la borne haute.
        startedAt: { gte: new Date(Date.now() - 365 * 24 * 3600 * 1000) },
        fcMax: { gt: 120, lt: 220 },
      },
      _max: { fcMax: true },
    });
    fcMax = observee._max.fcMax ?? null;
  }

  return {
    tempsCourse: profile.tempsCourse,
    tempsNatation: profile.tempsNatation,
    tempsVelo: profile.tempsVelo,
    ftpWatts: profile.ftpWatts,
    seuilCourseSecParKm: profile.seuilCourseSecParKm,
    cssSecPer100m: profile.cssSecPer100m,
    fcSeuil: profile.fcSeuil,
    fcMax,
    // Le milieu où l'athlète nage change le temps aux 100 m à effort égal :
    // une allure calculée en bassin est inatteignable en eau libre.
    bassin: parseMateriel(profile.materiel)?.piscine ?? null,
    overrides: parseZoneOverrides(profile.customZones),
  };
}

/**
 * Meilleure puissance moyenne sur une sortie d'une durée proche d'un test de
 * seuil. Sert à proposer une FTP à l'athlète, jamais à la lui imposer : une
 * moyenne de sortie inclut les descentes et sous-estime la vraie valeur.
 */
export async function suggestFtp(userId: string): Promise<{ puissanceMoy: number; ftpSuggere: number } | null> {
  const meilleure = await prisma.activity.findFirst({
    where: {
      userId,
      sport: "velo",
      puissanceMoy: { gt: 50 },
      dureeMin: { gte: 20, lte: 75 },
      startedAt: { gte: new Date(Date.now() - 180 * 24 * 3600 * 1000) },
    },
    orderBy: { puissanceMoy: "desc" },
    select: { puissanceMoy: true },
  });

  if (!meilleure?.puissanceMoy) return null;
  return { puissanceMoy: meilleure.puissanceMoy, ftpSuggere: Math.round(meilleure.puissanceMoy * 0.95) };
}
