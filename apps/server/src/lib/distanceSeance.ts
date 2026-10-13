import type { TrainingZones, ZoneRange } from "./training.js";
import { bornesNumeriques, zoneCitee } from "./cibles.js";

/**
 * La distance d'une séance, tirée de son plan.
 *
 * Le modèle écrit la distance totale d'un côté et le détail des blocs de
 * l'autre, et les deux ne s'additionnent pas toujours : « 2,5 km » de natation
 * pour un plan qui en fait 1,9, un footing de 8 km annoncé pour 50 minutes à
 * 6:30/km. L'athlète ne sait plus lequel croire.
 *
 * La distance de chaque bloc est donc calculée ici — répétitions et
 * récupérations quand elles sont chiffrées en mètres, sinon la durée du bloc à
 * l'allure de sa zone — et le total en est la somme. Quand un bloc ne se
 * laisse pas chiffrer (un vélo prescrit en watts, sans repère de vitesse), la
 * distance écrite par le coach est conservée telle quelle.
 */

type Sport = "course" | "natation" | "velo";

interface Exercice {
  repetitions?: string;
  allure?: string;
  recuperation?: string;
}

interface Bloc {
  dureeMin: number;
  cible?: string;
  description?: string;
  exercices?: Exercice[] | null;
  distanceKm?: number;
}

interface SeanceDistance {
  sport: string;
  titre?: string;
  distanceKm?: number | null;
  structure?: { echauffement?: Bloc; corps?: Bloc; retourCalme?: Bloc } | null;
}

const BLOCS = ["echauffement", "corps", "retourCalme"] as const;

/** Vitesses plausibles, en km/h : au-delà, un chiffre a été mal lu. */
const VITESSE_PLAUSIBLE: Record<Sport, [number, number]> = {
  course: [5, 25],
  natation: [1, 6],
  velo: [10, 50],
};

/** Pas d'arrondi : 50 m dans un bassin, 100 m à pied, 500 m à vélo. */
const PAS_KM: Record<Sport, number> = { natation: 0.05, course: 0.1, velo: 0.5 };

const arrondir = (km: number, pas: number) => Math.round(km / pas) * pas;
const nombre = (texte: string) => Number(texte.replace(",", "."));

function enKm(valeur: number, unite: string | undefined, sport: Sport): number {
  if (unite?.toLowerCase() === "km") return valeur;
  if (unite?.toLowerCase() === "m") return valeur / 1000;
  // Sans unité : « 6 x 400 » se lit en mètres dès que le nombre ressemble à une distance de piste ou de bassin.
  return sport !== "velo" && valeur >= 25 ? valeur / 1000 : NaN;
}

/** Durée écrite en minutes ou en secondes : « 3 min », « 90 s », « 1'30 ». */
function dureeMinutes(texte: string): number | null {
  const mmss = texte.match(/(\d{1,2})\s*'\s*(\d{2})/);
  if (mmss) return Number(mmss[1]) + Number(mmss[2]) / 60;
  const min = texte.match(/(\d+(?:[.,]\d+)?)\s*(?:min|mn)\b/i);
  if (min) return nombre(min[1]);
  const sec = texte.match(/(\d+)\s*(?:s|sec|")(?![a-zé])/i);
  if (sec) return Number(sec[1]) / 60;
  return null;
}

/** Vitesse en km/h lue dans une valeur d'intensité, quand son unité le permet. */
function vitesseDeValeur(valeur: string): number | null {
  const bornes = bornesNumeriques(valeur);
  if (!bornes) return null;
  const milieu = (bornes[0] + bornes[1]) / 2;
  if (/\/\s?km\b/i.test(valeur)) return milieu > 0 ? 3600 / milieu : null;
  if (/\/\s?100\s?m\b/i.test(valeur)) return milieu > 0 ? 360 / milieu : null;
  if (/km\s?\/\s?h/i.test(valeur)) return milieu;
  return null;
}

function rangesVitesse(sport: Sport, zones: TrainingZones | null): ZoneRange[] | null {
  if (!zones) return null;
  if (sport === "course") return zones.course;
  if (sport === "natation") return zones.natation;
  return zones.veloVitesse;
}

/**
 * Vitesse d'un texte d'intensité : sa valeur chiffrée si elle est une allure ou
 * une vitesse, sinon la zone qu'il cite, lue dans les zones de l'athlète.
 */
function vitesse(texte: string | undefined, sport: Sport, zones: TrainingZones | null, zoneParDefaut?: string): number | null {
  if (texte) {
    const directe = vitesseDeValeur(texte);
    if (directe) return directe;
  }
  const zone = (texte && zoneCitee(texte)) || zoneParDefaut;
  const range = zone ? rangesVitesse(sport, zones)?.find((r) => r.zone === zone) : null;
  return range ? vitesseDeValeur(range.value) : null;
}

/** Distance d'une répétition : « 6 x 400m » → 2,4 ; « 2 x (4 x 200 m) » → 1,6 ; « 5 x 3 min » à l'allure. */
function distanceExercice(ex: Exercice, sport: Sport, zones: TrainingZones | null, vitesseBloc: number | null): number | null {
  const texte = ex.repetitions ?? "";
  let fois = 1;
  let effort: number | null = null;

  const auTemps = texte.match(/(?:(\d+)\s*[x×]\s*)?(\d+(?:[.,]\d+)?\s*(?:min|mn|'|sec|s|")(?![a-zé])(?:\s*\d{2})?)/i);
  const imbrique = texte.match(/(\d+)\s*[x×]\s*\(\s*(\d+)\s*[x×]\s*(\d+(?:[.,]\d+)?)\s*(km|m)?\b/i);
  const simple = texte.match(/(\d+)\s*[x×]\s*(\d+(?:[.,]\d+)?)\s*(km|m)?\b/i);
  const unique = texte.match(/^\s*(\d+(?:[.,]\d+)?)\s*(km|m)\b/i);

  if (auTemps) {
    // Répétitions au temps : « 5 x 3 min » à l'allure de l'exercice.
    const duree = dureeMinutes(auTemps[2]);
    const v = vitesse(ex.allure, sport, zones) ?? vitesseBloc;
    if (!duree || !v) return null;
    fois = auTemps[1] ? Number(auTemps[1]) : 1;
    effort = (duree / 60) * v;
  } else if (imbrique) {
    fois = Number(imbrique[1]) * Number(imbrique[2]);
    effort = enKm(nombre(imbrique[3]), imbrique[4], sport);
  } else if (simple) {
    fois = Number(simple[1]);
    effort = enKm(nombre(simple[2]), simple[3], sport);
  } else if (unique) {
    effort = enKm(nombre(unique[1]), unique[2], sport);
  }
  if (effort === null || Number.isNaN(effort)) return null;

  // Récupération : en mètres, ou au temps à allure facile.
  let recup = 0;
  if (ex.recuperation) {
    const distance = ex.recuperation.match(/(\d+(?:[.,]\d+)?)\s*(km|m)\b/i);
    if (distance) recup = enKm(nombre(distance[1]), distance[2], sport);
    else {
      const duree = dureeMinutes(ex.recuperation);
      // Une récupération « sur place » ou « départ toutes les » ne parcourt rien.
      const immobile = /place|arrêt|arret|statique|mur|bord|départ|depart/i.test(ex.recuperation);
      const v = vitesse(undefined, sport, zones, "Z1");
      if (duree && v && !immobile && sport !== "natation") recup = (duree / 60) * v * 0.8;
    }
  }
  if (Number.isNaN(recup)) recup = 0;
  return fois * (effort + recup);
}

/** Distances écrites dans un texte : « 400 m crawl, 4 x 50 m éducatifs » → 0,6 km. */
function distanceDecrite(texte: string, sport: Sport): number | null {
  let total = 0;
  let reste = texte;
  for (const m of texte.matchAll(/(\d+)\s*[x×]\s*(\d+(?:[.,]\d+)?)\s*(km|m)\b/gi)) {
    total += Number(m[1]) * enKm(nombre(m[2]), m[3], sport);
    reste = reste.replace(m[0], " ");
  }
  for (const m of reste.matchAll(/(\d+(?:[.,]\d+)?)\s*(km|m)\b/gi)) total += enKm(nombre(m[1]), m[2], sport);
  return total > 0 && Number.isFinite(total) ? total : null;
}

function distanceBloc(bloc: Bloc, sport: Sport, zones: TrainingZones | null): number | null {
  const vitesseBloc = vitesse(bloc.cible, sport, zones);
  if (bloc.exercices?.length) {
    const parties = bloc.exercices.map((ex) => distanceExercice(ex, sport, zones, vitesseBloc));
    if (parties.every((p): p is number => p !== null)) return parties.reduce((a, b) => a + b, 0);
  }
  // En natation, le plan s'écrit en mètres : la description fait foi.
  const decrite = bloc.description ? distanceDecrite(bloc.description, sport) : null;
  if (decrite && (sport === "natation" || !bloc.exercices?.length)) return decrite;
  if (vitesseBloc && bloc.dureeMin > 0) return (bloc.dureeMin / 60) * vitesseBloc;
  return null;
}

/**
 * Ajoute la distance de chaque bloc et remplace la distance totale par leur
 * somme, quand tous les blocs se laissent chiffrer et que le résultat reste
 * plausible. Sinon la séance est rendue telle quelle.
 */
export function harmoniserDistances<T extends SeanceDistance & { dureeMin: number }>(
  seances: T[],
  zones: TrainingZones | null
): T[] {
  return seances.map((seance) => {
    const sport = seance.sport as Sport;
    if (!(sport in PAS_KM) || !seance.structure) return seance;

    const distances = BLOCS.map((nom) => {
      const bloc = seance.structure?.[nom];
      return bloc ? distanceBloc(bloc, sport, zones) : 0;
    });
    if (distances.some((d) => d === null || !Number.isFinite(d))) return seance;

    const total = (distances as number[]).reduce((a, b) => a + b, 0);
    const [vmin, vmax] = VITESSE_PLAUSIBLE[sport];
    const vitesseMoyenne = seance.dureeMin > 0 ? total / (seance.dureeMin / 60) : 0;
    if (total <= 0 || vitesseMoyenne < vmin || vitesseMoyenne > vmax) return seance;

    const pasBloc = sport === "natation" ? 0.025 : PAS_KM[sport];
    const structure = { ...seance.structure };
    BLOCS.forEach((nom, i) => {
      const bloc = structure[nom];
      if (bloc) structure[nom] = { ...bloc, distanceKm: Math.round(arrondir(distances[i] as number, pasBloc) * 1000) / 1000 };
    });
    const distanceKm = Math.round(arrondir(total, PAS_KM[sport]) * 100) / 100;
    return {
      ...seance,
      ...(seance.titre !== undefined ? { titre: titreAjuste(seance.titre, distanceKm) } : {}),
      structure,
      distanceKm,
    };
  });
}

/**
 * Le titre suit la distance : « Sortie longue 18 km » ne peut pas annoncer
 * 15,5 km de plan. Seule une distance totale est réécrite — une mention unique
 * hors répétitions —, dans l'unité choisie par le coach. Un titre qui cite
 * plusieurs distances (« 12 km dont 4 km au seuil ») ou des répétitions
 * (« 6 x 800 m ») parle d'autre chose que du total : il est laissé tel quel.
 */
export function titreAjuste(titre: string, distanceKm: number): string {
  // Une distance précédée de « 6 x » est une répétition, pas le total.
  const mentions = [...titre.matchAll(/(?<![x×]\s*\(?\s*|[\d.,])(\d+(?:[.,]\d+)?)\s*(km|m)\b/gi)];
  if (mentions.length !== 1) return titre;

  const [texte, valeur, unite] = mentions[0];
  const position = mentions[0].index ?? 0;
  const annonceeKm = unite.toLowerCase() === "km" ? Number(valeur.replace(",", ".")) : Number(valeur) / 1000;
  // Un écart d'arrondi ne justifie pas de réécrire ce qu'a écrit le coach.
  if (Math.abs(annonceeKm - distanceKm) <= Math.max(0.05, distanceKm * 0.03)) return titre;

  const espace = /\s/.test(texte) ? " " : "";
  const remplacement =
    unite.toLowerCase() === "m"
      ? `${Math.round(distanceKm * 1000)}${espace}m`
      : `${String(Math.round(distanceKm * 10) / 10).replace(".", valeur.includes(".") ? "." : ",")}${espace}km`;
  return titre.slice(0, position) + remplacement + titre.slice(position + texte.length);
}
