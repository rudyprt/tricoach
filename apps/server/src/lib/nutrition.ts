import type { SessionStructure } from "./session.js";

/**
 * Nutrition autour de l'effort : avant, pendant, après chaque séance.
 *
 * La plupart des triathlètes s'entraînent le ventre vide puis découvrent le
 * jour de la course qu'ils ne digèrent pas 80 g de glucides par heure. Le
 * ravitaillement se prépare comme le reste : séance après séance, à des doses
 * qui suivent la durée et l'intensité, et que l'estomac apprend à tolérer.
 *
 * Tout est calculé ici, sans modèle de langage : des règles issues des
 * recommandations de nutrition du sport d'endurance, ajustées à ce que l'on
 * sait de l'athlète — son poids, sa sudation mesurée, la quantité de glucides
 * qu'il a déjà tolérée, ses formats préférés. Gratuit à chaque affichage, et
 * jamais d'arithmétique approximative.
 *
 * Ce ne sont pas des conseils médicaux : pas de régime, pas de perte de poids,
 * seulement le carburant de l'entraînement.
 */

export const FORMATS_RAVITO = ["boisson", "gel", "barre", "solide"] as const;
export type FormatRavito = (typeof FORMATS_RAVITO)[number];

/** Ce que l'on sait de l'athlète. Tout est facultatif : les règles générales comblent. */
export interface ProfilRavito {
  poidsKg?: number | null;
  formats?: string[];
  cafeine?: boolean;
  /** Traces blanches sur les vêtements, goût salé : pertes en sodium élevées. */
  sueurSalee?: boolean;
  /** Sudation mesurée, en ml par heure, par sport ou toutes séances confondues. */
  sudation?: { course?: number | null; velo?: number | null; natation?: number | null; global?: number | null };
  /** Glucides par heure déjà bien tolérés, d'après le journal. */
  toleranceGH?: number | null;
  /** Dose au-delà de laquelle l'athlète a eu des troubles digestifs. */
  limiteGH?: number | null;
}

export interface SeanceRavito {
  sport: string;
  titre: string;
  dureeMin: number;
  structure?: SessionStructure | null;
}

/** La course pour laquelle l'estomac s'entraîne. */
export interface ObjectifDigestif {
  nom: string;
  semainesRestantes: number;
  /** Glucides par heure visés le jour de la course. */
  cibleCourseGH: number;
}

export interface Ravitaillement {
  avant: string[];
  pendant: {
    glucidesGH: number;
    fourchetteGH: [number, number];
    boissonMlH: number;
    sodiumMgH: number;
    /** Ce que l'athlète prend concrètement, dans ses formats. */
    exemple: string | null;
    conseils: string[];
  } | null;
  apres: string[];
  /** Séance d'entraînement digestif : la dose du jour et pourquoi. */
  entrainementDigestif: string | null;
  /** D'où viennent les chiffres : mesuré ou estimé. */
  sources: string[];
}

/* ------------------------------------------------------------------ */
/* Intensité                                                           */
/* ------------------------------------------------------------------ */

/**
 * Zone moyenne (pondérée par la durée) et zone maximale de la séance, lues dans
 * les cibles de ses blocs. À défaut, le titre suffit à distinguer une sortie
 * longue d'un fractionné.
 */
export function intensiteSeance(seance: SeanceRavito): { moyenne: number; max: number } {
  const blocs = seance.structure ? [seance.structure.echauffement, seance.structure.corps, seance.structure.retourCalme] : [];
  let somme = 0;
  let duree = 0;
  let max = 0;
  for (const bloc of blocs) {
    if (!bloc) continue;
    const zones = [...`${bloc.cible} ${bloc.description}`.matchAll(/Z([1-5])/g)].map((m) => Number(m[1]));
    if (zones.length === 0) continue;
    const z = Math.max(...zones);
    somme += z * bloc.dureeMin;
    duree += bloc.dureeMin;
    max = Math.max(max, z);
  }
  if (duree > 0) return { moyenne: somme / duree, max };

  const titre = seance.titre.toLowerCase();
  if (/seuil|vma|fraction|interval|tempo|allure|côte|cote|sprint|test/.test(titre)) return { moyenne: 3.2, max: 4 };
  if (/récup|recup|footing|facile|souple/.test(titre)) return { moyenne: 1.5, max: 2 };
  return { moyenne: 2.2, max: 2 };
}

/* ------------------------------------------------------------------ */
/* Règles                                                              */
/* ------------------------------------------------------------------ */

const arrondir = (n: number, pas: number) => Math.round(n / pas) * pas;

/** Glucides par heure recommandés, avant toute personnalisation. */
function glucidesDeBase(sport: string, dureeMin: number, intensite: { moyenne: number; max: number }): [number, number] {
  if (sport === "renfo") return [0, 0];
  if (sport === "natation") return dureeMin > 75 ? [20, 40] : [0, 0];
  if (dureeMin < 45) return [0, 0];
  if (dureeMin < 75) return intensite.max >= 4 || intensite.moyenne >= 3 ? [15, 30] : [0, 0];
  if (dureeMin < 120) return intensite.moyenne < 2.5 ? [30, 45] : [30, 60];
  if (dureeMin < 180) return [45, 75];
  return [60, 90];
}

/** Boisson par heure : la sudation mesurée prime ; sinon une valeur usuelle par sport. */
function boissonDeBase(sport: string, dureeMin: number, sudationMlH: number | null): number {
  if (sport === "natation") return dureeMin > 60 ? 250 : 0;
  if (dureeMin < 45) return 0;
  // On compense environ 70 % des pertes : boire tout ce qu'on sue ne passe pas,
  // et boire plus que ce qu'on perd est dangereux (hyponatrémie).
  if (sudationMlH) return Math.min(1000, Math.max(300, arrondir(sudationMlH * 0.7, 50)));
  return sport === "velo" ? 600 : sport === "course" ? 500 : 400;
}

/** Contenu en glucides des formats usuels, en grammes. */
const UNITES = {
  gel: { g: 25, nom: "gel" },
  barre: { g: 40, nom: "barre (ou demi-barre)" },
  solide: { g: 25, nom: "banane ou pâte de fruits" },
} as const;

/** Une boisson d'effort à 6 % apporte 60 g de glucides par litre. */
const GLUCIDES_BOISSON_G_L = 60;

function composer(
  glucidesGH: number,
  boissonMlH: number,
  sport: string,
  formats: string[]
): string | null {
  if (glucidesGH <= 0) return boissonMlH > 0 ? `Par heure : ${boissonMlH} ml d'eau, par petites gorgées toutes les 15 à 20 min.` : null;
  const prefs = formats.length ? formats : ["boisson", "gel"];
  const morceaux: string[] = [];
  let reste = glucidesGH;

  if (prefs.includes("boisson") && boissonMlH > 0) {
    const g = Math.min(reste, Math.round((boissonMlH / 1000) * GLUCIDES_BOISSON_G_L));
    morceaux.push(`${boissonMlH} ml de boisson d'effort à 6 % (${g} g)`);
    reste -= g;
  } else if (boissonMlH > 0) {
    morceaux.push(`${boissonMlH} ml d'eau`);
  }

  if (reste >= 10) {
    // En course à pied, le solide passe mal : le gel d'abord.
    const ordre: (keyof typeof UNITES)[] =
      sport === "course" ? ["gel", "solide", "barre"] : ["barre", "solide", "gel"];
    const choix = ordre.find((f) => prefs.includes(f)) ?? "gel";
    const unite = UNITES[choix];
    const parHeure = reste / unite.g;
    const intervalle = Math.max(15, arrondir(60 / parHeure, 5));
    morceaux.push(`1 ${unite.nom} (${unite.g} g) toutes les ${intervalle} min`);
  }
  return `Par heure : ${morceaux.join(" + ")}.`;
}

export function calculerRavitaillement(
  seance: SeanceRavito,
  profil: ProfilRavito = {},
  options: { objectifDigestif?: ObjectifDigestif | null; seanceLeLendemain?: boolean } = {}
): Ravitaillement | null {
  if (seance.sport === "repos" || seance.dureeMin <= 0) return null;

  const intensite = intensiteSeance(seance);
  const poids = profil.poidsKg ?? null;
  const sources: string[] = [];
  const sudation =
    (seance.sport === "course" || seance.sport === "velo" || seance.sport === "natation"
      ? profil.sudation?.[seance.sport]
      : null) ??
    profil.sudation?.global ??
    null;
  if (sudation) sources.push(`Boisson calée sur ta sudation mesurée (${sudation} ml/h).`);
  else if (seance.dureeMin >= 60 && seance.sport !== "natation") sources.push("Boisson estimée : un test de sudation la rendrait personnelle.");

  /* --- Pendant ---------------------------------------------------- */
  let [bas, haut] = glucidesDeBase(seance.sport, seance.dureeMin, intensite);
  // L'estomac se fatigue plus en course à pied qu'à vélo.
  if (seance.sport === "course") haut = Math.min(haut, 70);
  let cible = arrondir((bas + haut) / 2, 5);

  // Ce que l'athlète tolère déjà borne la dose, sauf pour l'entraîner.
  const plafond = profil.limiteGH ? profil.limiteGH - 10 : null;
  let entrainementDigestif: string | null = null;
  const od = options.objectifDigestif;
  const longue = (seance.sport === "velo" || seance.sport === "course") && seance.dureeMin >= 90;

  if (od && longue) {
    const depart = profil.toleranceGH ?? 45;
    const visee = Math.min(od.cibleCourseGH, depart + 10, seance.sport === "course" ? 80 : 100);
    if (visee > cible) {
      cible = visee;
      haut = Math.max(haut, visee);
    }
    entrainementDigestif = `Entraînement digestif : à ${od.semainesRestantes} semaine(s) de « ${od.nom} », vise ${cible} g/h aujourd'hui (objectif le jour J : ${od.cibleCourseGH} g/h). Note ensuite comment tu l'as toléré : la dose suivante en dépend.`;
  } else if (profil.toleranceGH && cible > profil.toleranceGH + 10) {
    cible = profil.toleranceGH + 10;
    sources.push(`Glucides limités à ce que tu as déjà toléré (${profil.toleranceGH} g/h), plus une marge de 10 g.`);
  }
  if (plafond !== null && cible > plafond) {
    cible = Math.max(0, plafond);
    sources.push(`Dose maintenue sous ${profil.limiteGH} g/h, où tu as eu des troubles digestifs.`);
  }
  if (profil.toleranceGH && !sources.some((s) => s.includes("toléré"))) {
    sources.push(`Tolérance relevée dans ton journal : ${profil.toleranceGH} g/h.`);
  }

  const boisson = boissonDeBase(seance.sport, seance.dureeMin, sudation);
  const concentration = profil.sueurSalee ? 900 : 600;
  const sodium =
    seance.dureeMin >= 90 || (sudation && sudation >= 1000 && seance.dureeMin >= 60)
      ? arrondir((boisson / 1000) * concentration, 50)
      : 0;

  const conseils: string[] = [];
  if (cible > 0) conseils.push("Commence à t'alimenter dès 20 à 30 min, puis à intervalles réguliers : n'attends pas d'avoir faim.");
  if (boisson > 0 && seance.sport !== "natation") conseils.push("Ajoute 150 à 250 ml/h s'il fait chaud, sans dépasser ce que ton estomac accepte.");
  if (seance.sport === "natation" && boisson > 0) conseils.push("Un bidon au bord du bassin : quelques gorgées toutes les 20 min.");
  if (sodium > 0) conseils.push(`Sodium : environ ${sodium} mg/h (boisson d'effort salée ou pastilles d'électrolytes).`);
  if (cible >= 60) conseils.push("Au-delà de 60 g/h, choisis des produits glucose + fructose : ils passent mieux.");

  const pendant =
    cible > 0 || boisson > 0
      ? {
          glucidesGH: cible,
          fourchetteGH: [bas, Math.max(haut, cible)] as [number, number],
          boissonMlH: boisson,
          sodiumMgH: sodium,
          exemple: composer(cible, boisson, seance.sport, profil.formats ?? []),
          conseils,
        }
      : null;

  /* --- Avant ------------------------------------------------------ */
  const avant: string[] = [];
  const exigeante = seance.dureeMin >= 120 || intensite.max >= 4;
  if (exigeante) {
    avant.push(
      poids
        ? `Repas riche en glucides 3 h avant : ${arrondir(poids * 1, 10)} à ${arrondir(poids * 2, 10)} g de glucides (pâtes, riz, pain), peu de fibres et de graisses.`
        : "Repas riche en glucides 3 h avant (pâtes, riz, pain), peu de fibres et de graisses."
    );
    avant.push("Ou, si la séance est tôt : une collation de 30 à 60 g de glucides 60 à 90 min avant (banane, pain et confiture).");
  } else if (seance.dureeMin >= 60) {
    avant.push("Si ton dernier repas date de plus de 3 h : une collation légère 1 h avant (banane, tartine de confiture, ~30 g de glucides).");
  } else {
    avant.push("Rien de particulier si tu as mangé dans les 3 à 4 h précédentes.");
  }
  if (seance.dureeMin >= 60 && seance.sport !== "natation") avant.push("Bois 400 à 600 ml dans les 2 h qui précèdent.");
  if (profil.cafeine && intensite.max >= 4) {
    avant.push(
      poids
        ? `Caféine possible 45 à 60 min avant : ${arrondir(poids * 3, 10)} mg au plus (3 mg/kg), seulement si tu en as l'habitude.`
        : "Caféine possible 45 à 60 min avant (un café), seulement si tu en as l'habitude."
    );
  }

  /* --- Après ------------------------------------------------------ */
  const apres: string[] = [];
  apres.push(
    poids
      ? `Protéines dans l'heure : ${Math.max(20, Math.round(poids * 0.3))} g (yaourt grec, lait, œufs, poisson ou équivalent végétal).`
      : "Protéines dans l'heure : 20 à 25 g (yaourt grec, lait, œufs, poisson ou équivalent végétal)."
  );
  if (seance.dureeMin >= 90 || intensite.max >= 4 || options.seanceLeLendemain) {
    const glucides = poids ? `${arrondir(poids, 5)} à ${arrondir(poids * 1.2, 5)} g` : "60 à 90 g";
    apres.push(
      `Glucides : ${glucides} dans l'heure qui suit${options.seanceLeLendemain ? " — prioritaire, tu t'entraînes de nouveau demain" : ""}.`
    );
  }
  if (sudation && seance.dureeMin >= 60) {
    const perte = Math.max(0, (sudation - boisson) * (seance.dureeMin / 60));
    if (perte >= 300) apres.push(`Réhydratation : environ ${arrondir(perte * 1.5, 50)} ml dans les heures qui suivent, avec un peu de sel.`);
  } else if (seance.dureeMin >= 75) {
    apres.push("Réhydratation : bois régulièrement jusqu'à des urines claires, avec un peu de sel au repas.");
  }

  return { avant, pendant, apres, entrainementDigestif, sources };
}

/* ------------------------------------------------------------------ */
/* Mesures de l'athlète                                                */
/* ------------------------------------------------------------------ */

/**
 * Taux de sudation d'un test : perte de poids plus boisson bue, rapportés à la
 * durée. Un kilo perdu vaut un litre de sueur.
 */
export function tauxSudation(test: { poidsAvantKg: number; poidsApresKg: number; boissonMl: number; dureeMin: number }): number {
  const pertesMl = (test.poidsAvantKg - test.poidsApresKg) * 1000 + test.boissonMl;
  return Math.max(0, Math.round(pertesMl / (test.dureeMin / 60)));
}

/** Moyenne des trois derniers tests d'un sport (ou de tous), arrondie. */
export function sudationRetenue(tests: { sport: string; tauxMlH: number }[], sport?: string): number | null {
  const retenus = (sport ? tests.filter((t) => t.sport === sport) : tests).slice(0, 3);
  if (retenus.length === 0) return null;
  return arrondir(retenus.reduce((s, t) => s + t.tauxMlH, 0) / retenus.length, 10);
}

export interface PriseJournal {
  glucidesG: number;
  dureeMin: number;
  tolerance: "bien" | "gene" | "troubles";
}

/**
 * Ce que le journal dit de l'estomac : la plus forte dose bien tolérée, et la
 * plus faible qui a posé problème.
 */
export function toleranceDigestive(prises: PriseJournal[]): { toleranceGH: number | null; limiteGH: number | null } {
  const parHeure = (p: PriseJournal) => Math.round(p.glucidesG / (p.dureeMin / 60));
  const bien = prises.filter((p) => p.tolerance === "bien" && p.dureeMin >= 45).map(parHeure);
  const troubles = prises.filter((p) => p.tolerance === "troubles" && p.dureeMin >= 45).map(parHeure);
  const toleranceGH = bien.length ? Math.max(...bien) : null;
  // Des troubles en dessous d'une dose déjà bien tolérée relèvent d'autre chose
  // (chaleur, produit, stress) : ils ne fixent pas de limite.
  const limites = troubles.filter((t) => toleranceGH === null || t > toleranceGH);
  return { toleranceGH, limiteGH: limites.length ? Math.min(...limites) : null };
}

/** Glucides par heure visés le jour de la course, selon l'épreuve. */
export function cibleCourseGH(course: { discipline?: string | null; format: string; distanceKm?: number | null }): number | null {
  const d = course.discipline ?? "triathlon";
  if (d === "triathlon") return ({ ironman: 90, half: 80, olympique: 60 } as Record<string, number>)[course.format] ?? null;
  if (d === "velo" && (course.distanceKm ?? 0) >= 100) return 80;
  if (d === "course" && (course.distanceKm ?? 0) >= 30) return 60;
  return null;
}

/**
 * Repères de ravitaillement du jour de la course, tirés de ce que l'athlète a
 * mesuré et toléré à l'entraînement. Le plan de course les reprend tels quels :
 * le jour J n'est pas le moment d'essayer une dose nouvelle.
 */
export function reperesCourse(
  profil: ProfilRavito,
  course: { discipline?: string | null; format: string; distanceKm?: number | null }
): { velo: { glucidesGH: number; boissonMlH: number; sodiumMgH: number }; course: { glucidesGH: number; boissonMlH: number; sodiumMgH: number }; teste: boolean } {
  const visee = cibleCourseGH(course) ?? 60;
  const toleree = profil.toleranceGH ? Math.min(visee, profil.toleranceGH) : visee;
  const sure = profil.limiteGH ? Math.min(toleree, profil.limiteGH - 10) : toleree;
  const concentration = profil.sueurSalee ? 900 : 600;
  const boisson = (sport: "velo" | "course") =>
    boissonDeBase(sport, 120, profil.sudation?.[sport] ?? profil.sudation?.global ?? null);
  const repere = (sport: "velo" | "course", glucides: number) => {
    const b = boisson(sport);
    return { glucidesGH: Math.max(0, glucides), boissonMlH: b, sodiumMgH: arrondir((b / 1000) * concentration, 50) };
  };
  return {
    velo: repere("velo", sure),
    course: repere("course", Math.min(sure, 70)),
    teste: Boolean(profil.toleranceGH),
  };
}
