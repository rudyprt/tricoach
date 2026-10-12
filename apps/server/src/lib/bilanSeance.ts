import { ajouterFrequencesCardiaques, bornesNumeriques, zoneCitee } from "./cibles.js";
import type { SessionStructure } from "./session.js";
import type { TrainingZones, ZoneRange } from "./training.js";

/**
 * Bilan d'une séance importée : ce qui a été fait, comparé à ce qui était prévu.
 *
 * Calcul pur, sans appel au modèle — il ne coûte rien et répond tout de suite.
 * Il ne réécrit pas la semaine : il dit l'écart, et ne propose de réajuster
 * que lorsqu'il est assez grand pour le justifier (séance écourtée de plus
 * d'un tiers, cœur nettement au-dessus de la cible). Le réajustement, lui,
 * reste un geste de l'athlète.
 */

export type NiveauBilan = "conforme" | "ecart" | "alerte";

export interface BilanSeance {
  niveau: NiveauBilan;
  constats: { niveau: NiveauBilan; texte: string }[];
  proposerReajustement: boolean;
}

export interface SeancePrevue {
  sport: string;
  dureeMin: number;
  structure: SessionStructure | null;
}

export interface ActiviteMesuree {
  dureeMin: number;
  fcMoyenne: number | null;
  allureSecParKm: number | null;
  puissanceMoy: number | null;
}

const RANG: Record<NiveauBilan, number> = { conforme: 0, ecart: 1, alerte: 2 };
const allure = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}/km`;

/** Fourchette moyenne attendue sur la séance, pondérée par la durée de chaque bloc. */
function fourchettePonderee(
  structure: SessionStructure,
  valeurDe: (bloc: SessionStructure["echauffement"]) => [number, number] | null
): [number, number] | null {
  let bas = 0;
  let haut = 0;
  let duree = 0;
  for (const bloc of [structure.echauffement, structure.corps, structure.retourCalme]) {
    const v = valeurDe(bloc);
    if (!v || bloc.dureeMin <= 0) continue;
    bas += v[0] * bloc.dureeMin;
    haut += v[1] * bloc.dureeMin;
    duree += bloc.dureeMin;
  }
  return duree > 0 ? [Math.round(bas / duree), Math.round(haut / duree)] : null;
}

function plageDeZone(ranges: ZoneRange[] | null | undefined, cible: string): [number, number] | null {
  const zone = zoneCitee(cible);
  const range = zone ? ranges?.find((r) => r.zone === zone) : null;
  return range ? bornesNumeriques(range.value) : null;
}

export function bilanSeance(seance: SeancePrevue, activite: ActiviteMesuree, zones: TrainingZones | null): BilanSeance {
  const constats: BilanSeance["constats"] = [];

  // Durée
  if (seance.dureeMin > 0) {
    const ratio = activite.dureeMin / seance.dureeMin;
    const texte = `${activite.dureeMin} min sur ${seance.dureeMin} prévues`;
    if (ratio < 0.7) constats.push({ niveau: "alerte", texte: `Séance écourtée : ${texte}.` });
    else if (ratio < 0.85) constats.push({ niveau: "ecart", texte: `Un peu plus courte que prévu : ${texte}.` });
    else if (ratio > 1.25) constats.push({ niveau: "ecart", texte: `Plus longue que prévu : ${texte}.` });
    else constats.push({ niveau: "conforme", texte: `Durée respectée : ${texte}.` });
  }

  /*
   * Une moyenne mélange efforts et récupérations : sur un fractionné, elle
   * tombe forcément sous la zone du corps de séance. La comparer donnerait une
   * fausse alerte ; on le dit plutôt que de juger.
   */
  const fractionne = seance.structure?.corps.exercices?.some((e) => e.recuperation) ?? false;
  if (!seance.structure || !zones || ["renfo", "repos"].includes(seance.sport)) {
    return conclure(constats);
  }
  if (fractionne) {
    constats.push({
      niveau: "conforme",
      texte: "Séance fractionnée : les moyennes mêlent efforts et récupérations, elles ne se comparent pas à une zone.",
    });
    return conclure(constats);
  }

  // Fréquence cardiaque : la cible de chaque bloc, pondérée par sa durée
  if (activite.fcMoyenne) {
    const [avecFc] = ajouterFrequencesCardiaques([{ sport: seance.sport, structure: seance.structure }], zones);
    const cible = fourchettePonderee(avecFc.structure!, (b) => (b.fc ? bornesNumeriques(b.fc) : null));
    if (cible) {
      const [bas, haut] = cible;
      const fc = activite.fcMoyenne;
      const plage = `${bas}–${haut} bpm`;
      if (fc > haut + 10) {
        constats.push({ niveau: "alerte", texte: `FC moyenne ${fc} bpm, nettement au-dessus de la cible (${plage}) : séance bien plus dure que prévu.` });
      } else if (fc > haut + 4) {
        constats.push({ niveau: "ecart", texte: `FC moyenne ${fc} bpm, un peu au-dessus de la cible (${plage}).` });
      } else if (fc < bas - 8) {
        constats.push({ niveau: "ecart", texte: `FC moyenne ${fc} bpm, sous la cible (${plage}) : séance plus facile que prévu.` });
      } else {
        constats.push({ niveau: "conforme", texte: `FC moyenne ${fc} bpm, dans la cible (${plage}).` });
      }
    }
  }

  // Allure (course) ou puissance (vélo)
  if (seance.sport === "course" && activite.allureSecParKm) {
    const cible = fourchettePonderee(seance.structure, (b) => plageDeZone(zones.course, b.cible));
    if (cible) {
      const [rapide, lente] = cible;
      const a = activite.allureSecParKm;
      const plage = `${allure(rapide)}–${allure(lente)}`;
      if (a < rapide * 0.97) constats.push({ niveau: "ecart", texte: `Allure ${allure(a)}, plus rapide que prévu (${plage}).` });
      else if (a > lente * 1.05) constats.push({ niveau: "ecart", texte: `Allure ${allure(a)}, plus lente que prévu (${plage}) : relief ou fatigue ?` });
      else constats.push({ niveau: "conforme", texte: `Allure ${allure(a)}, dans la cible (${plage}).` });
    }
  }
  if (seance.sport === "velo" && activite.puissanceMoy && zones.velo) {
    const cible = fourchettePonderee(seance.structure, (b) => plageDeZone(zones.velo, b.cible));
    if (cible) {
      const [bas, haut] = cible;
      const w = activite.puissanceMoy;
      if (w > haut * 1.05) constats.push({ niveau: "ecart", texte: `Puissance moyenne ${w} W, au-dessus de la cible (${bas}–${haut} W).` });
      else if (w < bas * 0.9) constats.push({ niveau: "ecart", texte: `Puissance moyenne ${w} W, sous la cible (${bas}–${haut} W).` });
      else constats.push({ niveau: "conforme", texte: `Puissance moyenne ${w} W, dans la cible (${bas}–${haut} W).` });
    }
  }

  return conclure(constats);
}

function conclure(constats: BilanSeance["constats"]): BilanSeance {
  const niveau = constats.reduce<NiveauBilan>((pire, c) => (RANG[c.niveau] > RANG[pire] ? c.niveau : pire), "conforme");
  return { niveau, constats, proposerReajustement: niveau === "alerte" };
}
