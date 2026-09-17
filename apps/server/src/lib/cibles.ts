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

interface ReglesUnite {
  /** Une cible qui la porte est acceptée telle quelle. */
  attendue: RegExp;
  /** Une cible qui en porte une, sans porter l'attendue, est corrigée. */
  interdites: RegExp[];
}

const ALLURE_KM = /\d\s?:\s?\d{2}\s?\/\s?km\b/i;
const ALLURE_100M = /\d\s?:\s?\d{2}\s?\/\s?100\s?m\b/i;
const WATTS = /\b\d{2,4}\s?W\b/i;
const VITESSE = /\b\d{1,2}([.,]\d)?\s?km\s?\/\s?h\b/i;

/**
 * L'unité attendue au vélo dépend de ce que l'athlète peut réellement lire.
 *
 * Avec un capteur, la puissance ; sans capteur mais avec un cardio, la
 * fréquence cardiaque ; sans rien, la vitesse — imparfaite, puisqu'à effort
 * égal elle varie du simple au double selon la pente et le vent, mais c'est le
 * seul repère chiffré dont dispose alors l'athlète. Dans les deux derniers cas,
 * des watts seraient une valeur qu'il ne peut pas vérifier.
 */
function reglesVelo(zones: TrainingZones): ReglesUnite {
  if (zones.velo) {
    return { attendue: WATTS, interdites: [ALLURE_KM, ALLURE_100M] };
  }
  if (zones.frequenceCardiaque) {
    // La FC ou la vitesse conviennent ; seules les allures à pied et les watts
    // inventés sont écartés.
    return { attendue: /\bbpm\b|\bFC\b/i, interdites: [ALLURE_KM, ALLURE_100M, WATTS] };
  }
  return { attendue: VITESSE, interdites: [ALLURE_KM, ALLURE_100M, WATTS] };
}

function regles(sport: string, zones: TrainingZones): ReglesUnite | null {
  if (sport === "natation") {
    // Une allure au kilomètre, une puissance ou une vitesse n'ont aucun sens
    // dans un bassin.
    return { attendue: /\/\s?100\s?m\b/i, interdites: [ALLURE_KM, WATTS, VITESSE] };
  }
  if (sport === "course") {
    return { attendue: /\/\s?km\b/i, interdites: [ALLURE_100M, WATTS] };
  }
  if (sport === "velo") return reglesVelo(zones);
  return null;
}

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

/** Une cible est-elle exprimée dans une unité que l'athlète ne peut pas lire ? */
export function uniteIncoherente(sport: string, cible: string, zones: TrainingZones): boolean {
  const r = regles(sport, zones);
  if (!r || !cible) return false;
  // Une cible qui porte déjà la bonne unité est acceptée, même si elle en
  // mentionne une autre à titre de repère.
  if (r.attendue.test(cible)) return false;
  return r.interdites.some((interdite) => interdite.test(cible));
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

/**
 * Valeurs de remplacement pour une discipline. Au vélo sans capteur, ce sont
 * les zones de fréquence cardiaque qui font foi : c'est ce que l'athlète lit
 * sur sa montre.
 */
function rangesPour(sport: string, zones: TrainingZones): ZoneRange[] | null {
  if (sport === "natation") return zones.natation;
  if (sport === "course") return zones.course;
  if (sport === "velo") return zones.velo ?? zones.frequenceCardiaque;
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

      if (bloc.cible && uniteIncoherente(seance.sport, bloc.cible, zones)) {
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
          if (!exercice.allure || !uniteIncoherente(seance.sport, exercice.allure, zones)) return exercice;
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
