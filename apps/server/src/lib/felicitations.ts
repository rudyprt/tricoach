import { intensiteSeance, type SeanceRavito } from "./nutrition.js";

/**
 * Le message qui suit une séance faite : un mot pour la saluer, ce qu'elle a
 * été, et comment en récupérer.
 *
 * Une séance validée ne laissait qu'une coche verte. Un coach dit « bravo »,
 * rappelle ce qui vient d'être fait et ce qu'il faut faire maintenant pour que
 * la séance porte ses fruits : c'est pendant la récupération que l'on
 * progresse, pas pendant l'effort.
 *
 * Rédigé sans modèle de langage : instantané, gratuit, et jamais à côté des
 * chiffres. L'offre Premium y ajoute la nutrition de récupération dosée pour
 * l'athlète ; les autres reçoivent le sommeil, l'activité et l'hydratation.
 */

export interface SeanceFaite extends SeanceRavito {
  id: string;
  dureeReelleMin?: number | null;
  distanceKm?: number | null;
}

export interface MesuresFaites {
  distanceKm?: number | null;
  allureSecParKm?: number | null;
  fcMoyenne?: number | null;
  puissanceMoy?: number | null;
  denivelePosM?: number | null;
}

export interface Felicitations {
  titre: string;
  resume: string[];
  recuperation: string[];
  /** Nutrition de récupération personnalisée : réservée à l'offre Premium. */
  nutrition: string[] | null;
}

const BRAVO: Record<string, string[]> = {
  course: ["Bravo, course bouclée 🏃", "Belle sortie, c'est dans les jambes 🏃", "Séance de course validée 💪"],
  velo: ["Bravo, sortie vélo validée 🚴", "Belle séance sur le vélo 🚴", "Kilomètres engrangés, bravo 💪"],
  natation: ["Bravo, séance de natation validée 🏊", "Belle séance dans l'eau 🏊", "Longueurs avalées, bravo 💪"],
  renfo: ["Bravo, renforcement fait 🏋️", "Séance de force validée 💪", "Le gainage paie, bravo 🏋️"],
};

/** Toujours le même message pour une séance donnée : il ne change pas à chaque ouverture. */
function choisir<T>(options: T[], graine: string): T {
  let h = 0;
  for (const c of graine) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return options[h % options.length];
}

const allure = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}/km`;
const km = (d: number) => `${String(Math.round(d * 10) / 10).replace(".", ",")} km`;

export function redigerFelicitations(
  seance: SeanceFaite,
  options: {
    mesures?: MesuresFaites | null;
    /** Niveau du bilan prévu / réalisé, quand une mesure existe. */
    niveauBilan?: "conforme" | "ecart" | "alerte" | null;
    prochaine?: { titre: string; dansJours: number; intense: boolean } | null;
    /** Lignes « après » du ravitaillement, pour l'offre Premium. */
    nutritionApres?: string[] | null;
  } = {}
): Felicitations {
  const duree = seance.dureeReelleMin ?? seance.dureeMin;
  const intensite = intensiteSeance(seance);
  const exigeante = intensite.max >= 4 || duree >= 90;
  const m = options.mesures ?? {};

  /* --- Résumé ------------------------------------------------------ */
  const chiffres = [`${duree} min`];
  const distance = m.distanceKm ?? seance.distanceKm;
  if (distance && seance.sport !== "renfo") {
    chiffres.push(seance.sport === "natation" ? `${Math.round(distance * 1000)} m` : km(distance));
  }
  if (m.allureSecParKm && seance.sport === "course") chiffres.push(allure(m.allureSecParKm));
  if (m.puissanceMoy && seance.sport === "velo") chiffres.push(`${m.puissanceMoy} W`);
  if (m.fcMoyenne) chiffres.push(`FC moy ${m.fcMoyenne}`);
  if (m.denivelePosM && m.denivelePosM >= 100) chiffres.push(`D+ ${m.denivelePosM} m`);

  const resume = [`${seance.titre} : ${chiffres.join(" · ")}.`];
  if (options.niveauBilan === "conforme") resume.push("Conforme au plan : exactement ce qu'il fallait.");
  else if (options.niveauBilan === "ecart") resume.push("Un peu à côté du plan, rien de grave : le détail est dans le bilan.");
  else if (options.niveauBilan === "alerte") resume.push("Assez loin du plan : regarde le bilan, et réajuste la semaine si besoin.");
  else if (seance.dureeReelleMin && seance.dureeReelleMin < seance.dureeMin * 0.8) {
    resume.push("Plus courte que prévu : c'est fait quand même, et c'est ce qui compte.");
  }

  /* --- Récupération ------------------------------------------------ */
  const recuperation: string[] = [];
  const demainExigeant = options.prochaine && options.prochaine.dansJours <= 1 && options.prochaine.intense;
  recuperation.push(
    exigeante || demainExigeant
      ? "Sommeil : vise 8 h cette nuit, c'est là que l'organisme répare et s'adapte. Évite les écrans tard et la caféine après 16 h."
      : "Sommeil : 7 h 30 à 9 h cette nuit ; une séance n'est complète qu'après une bonne nuit."
  );
  if (!options.nutritionApres) {
    recuperation.push(
      duree >= 60
        ? "Hydratation : bois régulièrement dans les heures qui viennent, jusqu'à des urines claires, avec un repas salé."
        : "Hydratation : un grand verre d'eau maintenant, puis selon la soif."
    );
  }
  if (exigeante) {
    recuperation.push(
      "Activité : reste en mouvement doux aujourd'hui (marche, escaliers) plutôt qu'assis toute la journée ; 5 à 10 min de mobilité ce soir."
    );
  } else {
    recuperation.push("Activité : une séance facile se récupère vite ; quelques minutes de mobilité suffisent.");
  }
  if (options.prochaine) {
    const quand = options.prochaine.dansJours <= 1 ? "Demain" : `Dans ${options.prochaine.dansJours} jours`;
    recuperation.push(
      `${quand} : ${options.prochaine.titre}.${options.prochaine.intense ? " Arrive frais : c'est une séance qui compte." : ""}`
    );
  } else if (exigeante) {
    recuperation.push("Pas de séance demain : profites-en pour récupérer vraiment.");
  }

  return {
    titre: choisir(BRAVO[seance.sport] ?? ["Bravo, séance validée 💪"], seance.id),
    resume,
    recuperation,
    nutrition: options.nutritionApres ?? null,
  };
}
