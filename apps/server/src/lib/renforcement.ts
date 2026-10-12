import type { TrainingPhase } from "./training.js";

/**
 * Le renforcement, prescrit comme une vraie séance.
 *
 * Le coach écrivait « Gainage et mobilité, 30 min » : un titre, une durée, et
 * à l'athlète d'inventer le reste. Personne ne sait quoi faire de trente
 * minutes de « gainage », et la séance finit sautée. Une séance de
 * renforcement se lit comme une fiche de salle : des exercices nommés, des
 * séries, des répétitions, une charge, un temps de repos.
 *
 * Son contenu suit la préparation, comme le reste du programme : on construit
 * la force loin de la course, on la convertit en puissance ensuite, et on
 * l'entretient sans fatigue à l'approche de l'objectif.
 */

export const MATERIELS_RENFO = ["poids_du_corps", "elastiques", "halteres", "salle"] as const;
export type MaterielRenfo = (typeof MATERIELS_RENFO)[number];

/** Ce que chaque phase demande au renforcement : volume, charge, fréquence. */
const PAR_PHASE: Record<TrainingPhase, string> = {
  base:
    "Phase de fondation — force générale : 2 séances par semaine si le temps le permet. 3 séries de 10 à 15 répétitions, tempo contrôlé (2-3 s à la descente), RPE 6-7/10, 60 à 90 s de récupération. C'est le moment d'apprendre les mouvements et de corriger les déséquilibres.",
  developpement:
    "Phase de développement — force : 1 à 2 séances par semaine. Exercices de base (squat, soulevé de terre roumain, fentes) en 3-4 séries de 5 à 8 répétitions, RPE 7-8/10, 2 min de récupération. Pour un format court (sprint, olympique), ajoute 1 exercice de pliométrie légère (sauts, 3 x 6).",
  specifique:
    "Phase spécifique — entretien de la force : 1 séance par semaine, courte (30 min). 2 à 3 séries de 5 à 6 répétitions, charges soutenues mais jamais jusqu'à l'échec (RPE 7). Le renforcement ne doit jamais entamer la fraîcheur des séances clés.",
  affutage:
    "Phase d'affûtage — entretien léger : au plus 1 séance, 20 à 25 min, 2 séries, charges modérées, aucun exercice nouveau. Aucun renforcement dans les 4 jours qui précèdent la course : les courbatures n'ont rien à y faire.",
  course:
    "Semaine de course : pas de renforcement. Au plus 10 à 15 min de mobilité et d'activation légère, loin du jour J.",
  transition:
    "Phase de transition : renforcement général et varié, mobilité, gainage, sans charge lourde. L'occasion de soigner les points faibles de la saison.",
};

/** Consignes du prompt système pour toute séance de renforcement. */
export function renfoPromptLines(phase: TrainingPhase): string[] {
  return [...renfoReglesLines(), `- ${renfoPhaseLigne(phase)}`];
}

/** Ce qui vaut quelle que soit la phase : la partie mise en cache du prompt. */
export function renfoReglesLines(): string[] {
  return [
    "",
    "SÉANCES DE RENFORCEMENT (sport: renfo) — à écrire comme une vraie séance de musculation, jamais comme un simple titre :",
    "- \"corps.exercices\" contient 5 à 7 exercices (la limite de 4 lignes ne vaut pas ici). Chaque exercice : \"nom\" (le nom précis du mouvement, ex : \"Fentes bulgares\"), \"repetitions\" (séries x répétitions, ex : \"3 x 10 par jambe\", ou \"3 x 40 s\" pour un exercice tenu), \"allure\" (la charge ou l'intensité concrète, ex : \"poids du corps\", \"élastique moyen\", \"RPE 7/10 — 2 répétitions en réserve\"), \"recuperation\" (ex : \"60 s\") et \"consigne\" (le point technique clé, 10 mots maximum).",
    "- Une séance couvre le corps du triathlète : hanches et chaîne postérieure (soulevé de terre roumain, hip thrust, pont fessier), jambes en unilatéral (fentes, step-up), mollets et pieds (mollets excentriques, pour le tendon d'Achille), gainage dont anti-rotation (planche latérale, Pallof), et haut du corps pour la nage (tirage, rowing, rotation externe d'épaule).",
    "- Adapte le contenu à l'objectif : format court (sprint, olympique) → force et explosivité ; format long (half, 70.3, Ironman) → endurance de force, unilatéral, gainage et prévention des blessures ; objectif « la terminer » ou athlète débutant → mouvements simples, prévention et gainage d'abord.",
    "- Blessures ou contraintes déclarées : n'inclus aucun exercice qui charge la zone concernée, et propose une alternative qui la ménage.",
    "- \"echauffement\" : 8 à 10 min de mobilité articulaire et d'activation. \"retourCalme\" : 5 à 10 min d'étirements doux ou de mobilité. Leur \"cible\" est un RPE (ex : \"RPE 3/10\"), jamais une zone ni une allure.",
    "- \"corps.cible\" donne l'intensité globale en RPE (ex : \"RPE 7/10\"). Séance de 30 à 50 min au total.",
    "- Placement : jamais de renforcement des jambes la veille d'une séance clé de course à pied ou de vélo ; idéalement le même jour qu'une séance facile.",
  ];
}

/** Volume, charge et fréquence du renforcement dans la phase courante. */
export function renfoPhaseLigne(phase: TrainingPhase): string {
  return PAR_PHASE[phase];
}

/** Ligne du matériel : la charge prescrite doit être réalisable chez l'athlète. */
export function renfoMaterielLigne(materiel: MaterielRenfo): string {
  switch (materiel) {
    case "salle":
      return "- Renforcement : accès à une salle de musculation (barres, haltères, machines). Exprime les charges en RPE ou en répétitions en réserve, jamais en kilos que tu ne connais pas.";
    case "halteres":
      return "- Renforcement : haltères ou kettlebell à la maison. Exprime la charge en RPE, éventuellement avec un exemple de poids par haltère.";
    case "elastiques":
      return "- Renforcement : élastiques de résistance et poids du corps. Indique la tension de l'élastique (léger, moyen, fort).";
    default:
      return "- Renforcement : aucun matériel, poids du corps uniquement. Fais progresser par l'unilatéral, le tempo lent et les exercices tenus, pas par la charge.";
  }
}
