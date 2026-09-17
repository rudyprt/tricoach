import { prisma } from "./prisma.js";
import { formatDate } from "./week.js";

/**
 * Charge d'entraînement, forme et fraîcheur.
 *
 * Le plafond « +10 % de volume par semaine » protège d'une montée trop brutale,
 * mais il ne dit rien de l'état de l'athlète : deux semaines identiques en
 * minutes peuvent laisser frais ou épuisé selon ce qui les a précédées. Le
 * modèle à deux moyennes mobiles — une longue pour la condition acquise, une
 * courte pour la fatigue — répond à cette question-là.
 *
 * Précision : ces valeurs sont des estimations. La charge d'une séance est
 * calculée à partir de la meilleure donnée disponible (puissance, puis
 * fréquence cardiaque, puis durée), et les trois méthodes ne se valent pas.
 * Elles servent à lire une tendance, pas à comparer deux athlètes.
 */

/** Constantes de temps, en jours, du modèle de Banister. */
export const TAU_FORME = 42;
export const TAU_FATIGUE = 7;

/**
 * Coefficient d'intensité par défaut, par discipline, quand ni puissance ni
 * fréquence cardiaque ne sont disponibles. Une heure de natation coûte plus
 * qu'une heure de vélo : le vélo se roule en partie en roue libre, la natation
 * ne se nage jamais en descente.
 */
const INTENSITE_PAR_SPORT: Record<string, number> = {
  natation: 1.0,
  course: 1.0,
  velo: 0.85,
  renfo: 0.6,
  autre: 0.7,
};

export interface SeanceMesuree {
  date: Date;
  sport: string;
  dureeMin: number;
  fcMoyenne?: number | null;
  puissanceMoy?: number | null;
}

export interface ReferencesAthlete {
  ftpWatts: number | null;
  fcSeuil: number | null;
  fcMax: number | null;
}

/**
 * Charge d'une séance, sur l'échelle habituelle où 100 correspond à une heure
 * d'effort soutenu au seuil.
 */
export function chargeSeance(seance: SeanceMesuree, refs: ReferencesAthlete): number {
  const heures = seance.dureeMin / 60;
  if (heures <= 0) return 0;

  // 1. Puissance : la mesure la plus fiable, parce qu'elle mesure le travail
  // produit et non la réponse du corps à ce travail.
  if (seance.puissanceMoy && refs.ftpWatts && refs.ftpWatts > 0) {
    const intensite = seance.puissanceMoy / refs.ftpWatts;
    return Math.round(heures * intensite * intensite * 100);
  }

  // 2. Fréquence cardiaque, rapportée au seuil. Elle dérive avec la chaleur et
  // la fatigue, d'où la borne : une séance ne peut pas valoir le double d'un
  // contre-la-montre de même durée.
  const seuil = refs.fcSeuil ?? (refs.fcMax ? Math.round(refs.fcMax * 0.92) : null);
  if (seance.fcMoyenne && seuil && seuil > 0) {
    const intensite = Math.min(1.25, seance.fcMoyenne / seuil);
    return Math.round(heures * intensite * intensite * 100);
  }

  // 3. Durée seule. Grossier, mais une tendance sur six semaines reste lisible.
  const coefficient = INTENSITE_PAR_SPORT[seance.sport] ?? INTENSITE_PAR_SPORT.autre;
  return Math.round(heures * coefficient * coefficient * 100);
}

export interface PointDeCharge {
  date: string;
  charge: number;
  forme: number;
  fatigue: number;
  fraicheur: number;
}

/**
 * Déroule les deux moyennes mobiles jour par jour. Les jours sans séance sont
 * inclus : c'est précisément le repos qui fait baisser la fatigue plus vite que
 * la forme, et produit la fraîcheur d'avant-course.
 */
export function serieDeCharge(
  chargesParJour: Map<string, number>,
  debut: Date,
  fin: Date,
  etatInitial: { forme: number; fatigue: number } = { forme: 0, fatigue: 0 }
): PointDeCharge[] {
  const points: PointDeCharge[] = [];
  let forme = etatInitial.forme;
  let fatigue = etatInitial.fatigue;

  const alphaForme = 1 - Math.exp(-1 / TAU_FORME);
  const alphaFatigue = 1 - Math.exp(-1 / TAU_FATIGUE);

  for (let jour = new Date(debut); jour <= fin; jour.setUTCDate(jour.getUTCDate() + 1)) {
    const cle = formatDate(jour);
    const charge = chargesParJour.get(cle) ?? 0;

    // La fraîcheur du jour est l'écart de la veille : elle décrit avec quoi
    // l'athlète aborde la journée, avant de s'entraîner.
    const fraicheur = forme - fatigue;

    forme += (charge - forme) * alphaForme;
    fatigue += (charge - fatigue) * alphaFatigue;

    points.push({
      date: cle,
      charge,
      forme: Math.round(forme * 10) / 10,
      fatigue: Math.round(fatigue * 10) / 10,
      fraicheur: Math.round(fraicheur * 10) / 10,
    });
  }

  return points;
}

export type EtatDeForme = "frais" | "equilibre" | "charge" | "surcharge";

export interface LectureDeCharge {
  etat: EtatDeForme;
  titre: string;
  message: string;
}

/**
 * Traduit la fraîcheur en une phrase utile. Les seuils viennent de l'usage
 * courant du modèle : au-delà de -30, la fatigue accumulée dépasse ce qu'une
 * semaine normale produit, et c'est le moment où les blessures arrivent.
 */
export function lireLaCharge(fraicheur: number, forme: number): LectureDeCharge {
  if (fraicheur < -30) {
    return {
      etat: "surcharge",
      titre: "Fatigue élevée",
      message:
        "Votre fatigue dépasse nettement votre condition. C'est le moment où surviennent les blessures et les coups de moins bien. Prévoyez des jours faciles, et dites-le à votre coach si ça dure.",
    };
  }
  if (fraicheur < -10) {
    return {
      etat: "charge",
      titre: "En charge",
      message:
        "Vous encaissez un bloc d'entraînement. C'est normal et c'est là que la progression se construit — à condition que ça ne dure pas plus de trois semaines d'affilée.",
    };
  }
  if (fraicheur > 15) {
    return {
      etat: "frais",
      titre: "Frais",
      message:
        forme < 20
          ? "Vous êtes frais, mais votre condition reste basse : c'est le profil d'une reprise ou d'une période creuse. Le volume peut remonter."
          : "Vous êtes frais avec une bonne condition : c'est l'état recherché un jour de course.",
    };
  }
  return {
    etat: "equilibre",
    titre: "Équilibré",
    message: "Charge et récupération s'équilibrent. Votre condition se maintient et vous absorbez l'entraînement.",
  };
}

export interface BilanDeCharge {
  points: PointDeCharge[];
  forme: number;
  fatigue: number;
  fraicheur: number;
  lecture: LectureDeCharge;
  /** Part des séances dont la charge a été estimée à partir de la seule durée. */
  seancesEstimees: number;
  seancesTotal: number;
}

const FENETRE_JOURS = 90;

/**
 * Bilan de charge d'un athlète.
 *
 * Les activités mesurées priment sur les séances déclarées : quand la montre
 * dit ce qui a été fait, c'est elle qui compte. Une séance simplement cochée
 * « faite » ne vaut que si aucune activité ne la recouvre.
 */
export async function bilanDeCharge(userId: string, maintenant: Date = new Date()): Promise<BilanDeCharge> {
  const fin = new Date(`${formatDate(maintenant)}T00:00:00.000Z`);
  const debut = new Date(fin);
  debut.setUTCDate(debut.getUTCDate() - FENETRE_JOURS);

  const profile = await prisma.athleteProfile.findUnique({
    where: { userId },
    select: { ftpWatts: true, fcSeuil: true, fcMax: true },
  });
  const refs: ReferencesAthlete = {
    ftpWatts: profile?.ftpWatts ?? null,
    fcSeuil: profile?.fcSeuil ?? null,
    fcMax: profile?.fcMax ?? null,
  };

  const [activites, seances] = await Promise.all([
    prisma.activity.findMany({
      where: { userId, startedAt: { gte: debut }, sport: { not: "repos" } },
      select: { startedAt: true, sport: true, dureeMin: true, fcMoyenne: true, puissanceMoy: true, sessionId: true },
      orderBy: { startedAt: "asc" },
      take: 1000,
    }),
    prisma.session.findMany({
      where: { userId, status: "faite", date: { gte: debut }, sport: { not: "repos" } },
      select: { id: true, date: true, sport: true, dureeMin: true, dureeReelleMin: true },
      orderBy: { date: "asc" },
      take: 1000,
    }),
  ]);

  const chargesParJour = new Map<string, number>();
  const ajouter = (date: Date, charge: number) => {
    const cle = formatDate(date);
    chargesParJour.set(cle, (chargesParJour.get(cle) ?? 0) + charge);
  };

  let estimees = 0;
  let total = 0;

  const seancesCouvertes = new Set(activites.map((a) => a.sessionId).filter(Boolean) as string[]);

  for (const a of activites) {
    const seance: SeanceMesuree = {
      date: a.startedAt,
      sport: a.sport,
      dureeMin: a.dureeMin,
      fcMoyenne: a.fcMoyenne,
      puissanceMoy: a.puissanceMoy,
    };
    ajouter(a.startedAt, chargeSeance(seance, refs));
    total += 1;
    if (!(a.puissanceMoy && refs.ftpWatts) && !(a.fcMoyenne && (refs.fcSeuil || refs.fcMax))) estimees += 1;
  }

  for (const s of seances) {
    if (seancesCouvertes.has(s.id)) continue; // Déjà comptée via l'activité importée.
    // La durée corrigée par l'athlète prime sur celle qui était prévue : une
    // sortie écourtée ne doit pas peser comme si elle avait été tenue.
    const duree = s.dureeReelleMin ?? s.dureeMin;
    ajouter(s.date, chargeSeance({ date: s.date, sport: s.sport, dureeMin: duree }, refs));
    total += 1;
    estimees += 1;
  }

  const points = serieDeCharge(chargesParJour, debut, fin);
  const dernier = points[points.length - 1] ?? { forme: 0, fatigue: 0, fraicheur: 0 };

  return {
    points,
    forme: dernier.forme,
    fatigue: dernier.fatigue,
    fraicheur: dernier.fraicheur,
    lecture: lireLaCharge(dernier.fraicheur, dernier.forme),
    seancesEstimees: estimees,
    seancesTotal: total,
  };
}

/**
 * Ce que le coach doit savoir de l'état de l'athlète avant de construire la
 * semaine. Sans cela, il ne dispose que du volume des sept derniers jours, qui
 * ne dit rien de la fatigue accumulée sur un mois.
 */
export function chargePromptLines(bilan: BilanDeCharge): string[] {
  if (bilan.seancesTotal < 6) return []; // Trop peu de données pour être utile.

  const lignes = [
    "",
    "ÉTAT DE FORME MESURÉ (moyennes mobiles de charge d'entraînement) :",
    `Condition acquise : ${Math.round(bilan.forme)}. Fatigue récente : ${Math.round(bilan.fatigue)}. Fraîcheur (condition moins fatigue) : ${Math.round(bilan.fraicheur)}.`,
    `Lecture : ${bilan.lecture.titre.toLowerCase()} — ${bilan.lecture.message}`,
  ];

  if (bilan.lecture.etat === "surcharge") {
    lignes.push(
      "CONSÉQUENCE OBLIGATOIRE : cette semaine doit être une semaine de récupération. Réduis le volume d'au moins un quart sous la limite indiquée, supprime toute séance à haute intensité, et explique-lui pourquoi dans les objectifs de séance."
    );
  } else if (bilan.lecture.etat === "charge") {
    lignes.push(
      "CONSÉQUENCE : n'augmente pas le volume cette semaine. Maintiens-le, et place au moins deux jours vraiment faciles."
    );
  } else if (bilan.lecture.etat === "frais" && bilan.forme >= 20) {
    lignes.push("CONSÉQUENCE : l'athlète a de la marge, la semaine peut être exigeante.");
  }

  if (bilan.seancesEstimees / bilan.seancesTotal > 0.5) {
    lignes.push(
      "Ces valeurs sont estimées à partir des durées de séance, faute de capteur de puissance ou de cardiofréquencemètre : traite-les comme une tendance, pas comme une mesure."
    );
  }

  return lignes;
}
