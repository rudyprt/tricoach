import type { TrainingZones, ZoneRange } from "./training.js";

/**
 * Cohérence des unités d'intensité, par discipline.
 *
 * Le modèle reçoit les zones de l'athlète et la consigne de les reprendre
 * telles quelles. Il lui arrive pourtant d'écrire une allure de course sur une
 * séance de natation — « Z4 seuil — 4:08/km » dans le bassin — parce qu'il
 * génère sept jours d'affilée et que la course domine ses exemples.
 *
 * Une consigne de prompt ne peut pas le garantir. Ce module le garantit : le
 * serveur connaît la bonne valeur pour chaque zone et chaque discipline, il
 * remplace donc ce qui ne colle pas plutôt que de le laisser passer.
 */

/** Unité attendue selon la discipline. */
const UNITES: Record<string, { attendue: RegExp; interdites: RegExp[]; nom: string }> = {
  natation: {
    attendue: /\/\s?100\s?m\b/i,
    // Une allure au kilomètre ou une puissance n'ont aucun sens dans un bassin.
    interdites: [/\d\s?:\s?\d{2}\s?\/\s?km\b/i, /\b\d{2,4}\s?W\b/i, /\bkm\/h\b/i],
    nom: "temps aux 100 m",
  },
  course: {
    attendue: /\/\s?km\b/i,
    interdites: [/\d\s?:\s?\d{2}\s?\/\s?100\s?m\b/i, /\b\d{2,4}\s?W\b/i],
    nom: "allure au kilomètre",
  },
  velo: {
    attendue: /\b\d{2,4}\s?W\b/i,
    // Une allure à pied sur le vélo, et la vitesse en km/h qui ne veut rien
    // dire dès qu'il y a du vent ou du dénivelé.
    interdites: [/\d\s?:\s?\d{2}\s?\/\s?km\b/i, /\d\s?:\s?\d{2}\s?\/\s?100\s?m\b/i],
    nom: "puissance en watts",
  },
};

/** Retrouve la zone citée dans un texte : « Z4 », « Zone 4 ». */
export function zoneCitee(texte: string): string | null {
  const match = texte.match(/\b(?:zone\s*|z)([1-5])\b/i);
  return match ? `Z${match[1]}` : null;
}

export interface CorrectionCible {
  sport: string;
  bloc: string;
  avant: string;
  apres: string;
}

/**
 * Remplace la valeur chiffrée d'une cible par celle de la bonne zone.
 *
 * Le libellé de zone est conservé : c'est l'intention du coach, et elle est
 * presque toujours juste. Seul le nombre, exprimé dans la mauvaise unité, est
 * remplacé par la valeur que le serveur a calculée.
 */
function corriger(cible: string, ranges: ZoneRange[]): string | null {
  const zone = zoneCitee(cible);
  const attendue = zone ? ranges.find((r) => r.zone === zone) : null;
  if (!attendue) return null;

  return `${attendue.zone} ${attendue.label} — ${attendue.value}`;
}

/** Une cible est-elle exprimée dans une unité impossible pour cette discipline ? */
export function uniteIncoherente(sport: string, cible: string): boolean {
  const regles = UNITES[sport];
  if (!regles || !cible) return false;
  // Une cible qui porte déjà la bonne unité est acceptée, même si elle en
  // mentionne une autre à titre de repère.
  if (regles.attendue.test(cible)) return false;
  return regles.interdites.some((interdite) => interdite.test(cible));
}

interface BlocCible {
  cible?: string;
  exercices?: { allure?: string }[] | null;
}

interface SeanceCorrigeable {
  sport: string;
  structure?: {
    echauffement?: BlocCible;
    corps?: BlocCible;
    retourCalme?: BlocCible;
  } | null;
}

const BLOCS = ["echauffement", "corps", "retourCalme"] as const;

function rangesPour(sport: string, zones: TrainingZones): ZoneRange[] | null {
  if (sport === "natation") return zones.natation;
  if (sport === "course") return zones.course;
  if (sport === "velo") return zones.velo;
  return null;
}

/**
 * Parcourt un programme et rétablit les unités. Renvoie les corrections
 * appliquées, pour qu'elles soient tracées : une dérive fréquente signalerait
 * un prompt à revoir, et non un simple accident.
 */
export function corrigerCibles<T extends SeanceCorrigeable>(
  seances: T[],
  zones: TrainingZones
): { seances: T[]; corrections: CorrectionCible[] } {
  const corrections: CorrectionCible[] = [];

  const corrigees = seances.map((seance) => {
    const ranges = rangesPour(seance.sport, zones);
    if (!seance.structure || !ranges) return seance;

    const structure = { ...seance.structure };
    let modifiee = false;

    for (const nom of BLOCS) {
      const bloc = structure[nom];
      if (!bloc) continue;

      let nouveauBloc = bloc;

      if (bloc.cible && uniteIncoherente(seance.sport, bloc.cible)) {
        const remplacement = corriger(bloc.cible, ranges);
        if (remplacement) {
          corrections.push({ sport: seance.sport, bloc: nom, avant: bloc.cible, apres: remplacement });
          nouveauBloc = { ...nouveauBloc, cible: remplacement };
          modifiee = true;
        }
      }

      // Les allures des exercices dérivent de la même façon que les cibles.
      if (bloc.exercices?.length) {
        const exercices = bloc.exercices.map((exercice) => {
          if (!exercice.allure || !uniteIncoherente(seance.sport, exercice.allure)) return exercice;
          const remplacement = corriger(exercice.allure, ranges);
          if (!remplacement) return exercice;
          corrections.push({
            sport: seance.sport,
            bloc: `${nom}.exercices`,
            avant: exercice.allure,
            apres: remplacement,
          });
          modifiee = true;
          return { ...exercice, allure: remplacement };
        });
        nouveauBloc = { ...nouveauBloc, exercices };
      }

      if (nouveauBloc !== bloc) structure[nom] = nouveauBloc;
    }

    return modifiee ? { ...seance, structure } : seance;
  });

  return { seances: corrigees, corrections };
}
