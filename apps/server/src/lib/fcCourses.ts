import { parsePerformance } from "./training.js";

/**
 * La fréquence cardiaque d'une course de référence.
 *
 * Faute de test, la FC au seuil était estimée à 92 % de la FC max : une règle
 * générale dont l'écart réel atteint dix battements. La FC moyenne d'une course
 * courue à fond est une mesure de l'athlète lui-même : selon la durée de
 * l'effort, elle se tient à quelques pour cent de son seuil. C'est l'estimation
 * la plus proche dont on dispose sans test.
 */

export interface FcCoursesReference {
  tempsNatation: string;
  tempsVelo: string;
  tempsCourse: string;
  fcMoyNatation?: number | null;
  fcMaxNatation?: number | null;
  fcMoyVelo?: number | null;
  fcMaxVelo?: number | null;
  fcMoyCourse?: number | null;
  fcMaxCourse?: number | null;
}

export interface SeuilsEstimes {
  course: number | null;
  velo: number | null;
  natation: number | null;
}

/**
 * Rapport entre la FC au seuil et la FC moyenne d'une course à fond, selon sa
 * durée. Un 5 km se court au-dessus du seuil, un semi-marathon en dessous ;
 * autour d'une heure, les deux coïncident. Au-delà de cinq heures, la gestion
 * de l'effort pèse plus que la physiologie : la moyenne ne dit plus rien du
 * seuil.
 */
export function facteurSeuil(dureeS: number): number | null {
  const minutes = dureeS / 60;
  if (minutes < 10 || minutes > 300) return null;
  if (minutes < 20) return 0.96;
  if (minutes < 40) return 0.98;
  if (minutes <= 75) return 1;
  if (minutes <= 150) return 1.04;
  return 1.08;
}

/** FC au seuil déduite d'une course, ou null si la course ne s'y prête pas. */
export function seuilDepuisCourse(temps: string, fcMoy: number | null | undefined, fcMax?: number | null): number | null {
  if (!fcMoy) return null;
  const perf = parsePerformance(temps);
  if (!perf) return null;
  const facteur = facteurSeuil(perf.durationS);
  if (!facteur) return null;
  const seuil = Math.round(fcMoy * facteur);
  // Le seuil se tient toujours sous la FC max relevée sur la même course.
  const plafond = fcMax ? fcMax - 3 : 220;
  return Math.max(100, Math.min(seuil, plafond));
}

export function seuilsDepuisCourses(p: FcCoursesReference): SeuilsEstimes {
  return {
    course: seuilDepuisCourse(p.tempsCourse, p.fcMoyCourse, p.fcMaxCourse),
    velo: seuilDepuisCourse(p.tempsVelo, p.fcMoyVelo, p.fcMaxVelo),
    natation: seuilDepuisCourse(p.tempsNatation, p.fcMoyNatation, p.fcMaxNatation),
  };
}

/** La plus haute FC max relevée en course : le vrai maximum est au moins celui-là. */
export function fcMaxDesCourses(p: FcCoursesReference): number | null {
  const valeurs = [p.fcMaxCourse, p.fcMaxVelo, p.fcMaxNatation].filter((v): v is number => Boolean(v));
  return valeurs.length ? Math.max(...valeurs) : null;
}

/** « (FC moy 172, max 185) » à la suite d'un chrono, pour le coach. */
export function fcCourseTexte(fcMoy: number | null | undefined, fcMax: number | null | undefined): string {
  const morceaux = [fcMoy ? `moy ${fcMoy}` : "", fcMax ? `max ${fcMax}` : ""].filter(Boolean);
  return morceaux.length ? ` (FC ${morceaux.join(", ")})` : "";
}
