import { uniteIncoherente, zoneCitee } from "../lib/cibles.js";
import type { TrainingZones } from "../lib/training.js";
import type { ProfilEval } from "./profils.js";

/**
 * Ce qu'un coach ne ferait jamais.
 *
 * Chaque règle porte sur une faute vérifiable sans jugement de goût : un volume
 * qui déborde, une unité inexécutable, une contrainte ignorée. Ce qui relève de
 * l'appréciation — le choix d'une séance plutôt qu'une autre — n'y figure pas :
 * une règle discutable rendrait le score inutilisable.
 *
 * Les règles sont des fonctions pures sur le programme produit. Elles se testent
 * donc sans appeler le modèle, ce qui compte : une règle fausse donnerait une
 * confiance fausse.
 */

export interface SeanceGeneree {
  date: string;
  sport: string;
  titre: string;
  dureeMin: number;
  distanceKm: number | null;
  description: string;
  objectif: string | null;
  structure: {
    echauffement: { dureeMin: number; cible: string; description: string };
    corps: { dureeMin: number; cible: string; description: string; exercices?: { repetitions: string; allure: string; recuperation?: string }[] };
    retourCalme: { dureeMin: number; cible: string; description: string };
  } | null;
}

export interface ContexteEval {
  profil: ProfilEval;
  zones: TrainingZones;
  /** Volume maximal annoncé au modèle, en minutes. */
  maxVolumeMin: number;
  /** Les sept dates demandées, dans l'ordre. */
  jours: string[];
}

export interface Manquement {
  regle: string;
  detail: string;
}

export interface Regle {
  nom: string;
  /** Ce que la règle protège, en une phrase, pour le rapport. */
  pourquoi: string;
  verifier: (seances: SeanceGeneree[], ctx: ContexteEval) => Manquement[];
}

const SPORTS_EFFORT = ["natation", "velo", "course", "renfo"];

const volumeTotal = (seances: SeanceGeneree[]) =>
  seances.filter((s) => s.sport !== "repos").reduce((somme, s) => somme + s.dureeMin, 0);

/** Une séance est « dure » si une de ses cibles vise Z4 ou Z5. */
export function estDure(seance: SeanceGeneree): boolean {
  if (!seance.structure) return false;
  const cibles = [
    seance.structure.echauffement.cible,
    seance.structure.corps.cible,
    seance.structure.retourCalme.cible,
    ...(seance.structure.corps.exercices ?? []).map((e) => e.allure),
  ];
  return cibles.some((c) => ["Z4", "Z5"].includes(zoneCitee(c) ?? ""));
}

export const REGLES: Regle[] = [
  {
    nom: "sept-jours",
    pourquoi: "Un jour manquant laisse un trou que l'athlète interprète comme un repos non voulu.",
    verifier: (seances, ctx) => {
      const vues = new Set(seances.map((s) => s.date));
      const manquants = ctx.jours.filter((j) => !vues.has(j));
      return manquants.length ? [{ regle: "sept-jours", detail: `jours absents : ${manquants.join(", ")}` }] : [];
    },
  },
  {
    nom: "volume-respecte",
    pourquoi: "Dépasser le volume annoncé est la première cause de blessure sur un plan généré.",
    verifier: (seances, ctx) => {
      const total = volumeTotal(seances);
      // Marge de 10 % : le modèle arrondit les durées, et refuser quelques
      // minutes rendrait la règle tatillonne plutôt qu'utile.
      const plafond = Math.round(ctx.maxVolumeMin * 1.1);
      return total > plafond
        ? [{ regle: "volume-respecte", detail: `${total} min générées pour ${ctx.maxVolumeMin} autorisées` }]
        : [];
    },
  },
  {
    nom: "unites-executables",
    pourquoi: "Une allure au kilomètre dans un bassin, ou des watts sans capteur, ne peuvent pas être suivis.",
    verifier: (seances, ctx) => {
      const fautes: Manquement[] = [];
      for (const s of seances) {
        if (!s.structure) continue;
        const cibles = [
          ["échauffement", s.structure.echauffement.cible],
          ["corps", s.structure.corps.cible],
          ["retour au calme", s.structure.retourCalme.cible],
          ...(s.structure.corps.exercices ?? []).map((e, i) => [`exercice ${i + 1}`, e.allure] as [string, string]),
        ] as [string, string][];
        for (const [ou, cible] of cibles) {
          if (uniteIncoherente(s.sport, cible, ctx.zones)) {
            fautes.push({ regle: "unites-executables", detail: `${s.date} ${s.sport} (${ou}) : « ${cible} »` });
          }
        }
      }
      return fautes;
    },
  },
  {
    nom: "structure-complete",
    pourquoi: "Sans structure, l'athlète ne sait pas quoi faire : le programme redevient une liste de titres.",
    verifier: (seances) =>
      seances
        .filter((s) => SPORTS_EFFORT.includes(s.sport) && !s.structure)
        .map((s) => ({ regle: "structure-complete", detail: `${s.date} ${s.sport} sans structure` })),
  },
  {
    nom: "duree-coherente",
    pourquoi: "Des blocs qui ne totalisent pas la durée annoncée rendent la séance impossible à planifier.",
    verifier: (seances) => {
      const fautes: Manquement[] = [];
      for (const s of seances) {
        if (!s.structure || s.sport === "repos") continue;
        const somme =
          s.structure.echauffement.dureeMin + s.structure.corps.dureeMin + s.structure.retourCalme.dureeMin;
        // Un quart d'écart : au-delà, ce n'est plus un arrondi.
        if (Math.abs(somme - s.dureeMin) > Math.max(10, s.dureeMin * 0.25)) {
          fautes.push({ regle: "duree-coherente", detail: `${s.date} ${s.sport} : blocs ${somme} min pour ${s.dureeMin} annoncées` });
        }
      }
      return fautes;
    },
  },
  {
    nom: "pas-deux-dures-de-suite",
    pourquoi: "Deux séances intenses consécutives ne laissent pas le temps de récupérer.",
    verifier: (seances) => {
      const parDate = [...seances].sort((a, b) => a.date.localeCompare(b.date));
      const fautes: Manquement[] = [];
      for (let i = 1; i < parDate.length; i++) {
        if (estDure(parDate[i - 1]) && estDure(parDate[i])) {
          fautes.push({
            regle: "pas-deux-dures-de-suite",
            detail: `${parDate[i - 1].date} et ${parDate[i].date} enchaînent deux séances à haute intensité`,
          });
        }
      }
      return fautes;
    },
  },
  {
    nom: "objectif-present",
    pourquoi: "Une séance sans raison énoncée se saute plus facilement qu'une séance expliquée.",
    verifier: (seances) =>
      seances
        .filter((s) => SPORTS_EFFORT.includes(s.sport) && !s.objectif?.trim())
        .map((s) => ({ regle: "objectif-present", detail: `${s.date} ${s.sport} sans objectif` })),
  },
  {
    nom: "trois-disciplines",
    pourquoi: "Un triathlète qui ne voit qu'une ou deux disciplines dans sa semaine ne prépare pas son épreuve.",
    verifier: (seances) => {
      const presentes = new Set(seances.filter((s) => s.sport !== "repos" && s.sport !== "renfo").map((s) => s.sport));
      const manquantes = ["natation", "velo", "course"].filter((d) => !presentes.has(d));
      return manquantes.length
        ? [{ regle: "trois-disciplines", detail: `aucune séance de ${manquantes.join(", ")}` }]
        : [];
    },
  },
  {
    nom: "au-moins-un-repos",
    pourquoi: "Sept jours d'affilée sans repos, c'est ce qu'aucun plan sérieux ne propose.",
    verifier: (seances) =>
      seances.some((s) => s.sport === "repos")
        ? []
        : [{ regle: "au-moins-un-repos", detail: "aucun jour de repos dans la semaine" }],
  },
  {
    nom: "contrainte-respectee",
    pourquoi: "Une contrainte déclarée et ignorée détruit la confiance dans tout le reste du programme.",
    verifier: (seances, ctx) => {
      const fautes: Manquement[] = [];

      // Piscine indisponible le week-end : samedi et dimanche sont les deux
      // derniers jours de la semaine générée.
      if (/piscine.*week-?end/i.test(ctx.profil.profil.contraintes)) {
        const weekend = ctx.jours.slice(5);
        for (const s of seances) {
          if (s.sport === "natation" && weekend.includes(s.date)) {
            fautes.push({ regle: "contrainte-respectee", detail: `natation le ${s.date}, piscine déclarée fermée` });
          }
        }
      }

      // Blessure au genou : la course doit être réduite, pas poursuivie comme si
      // de rien n'était.
      if (/genou|tendinite/i.test(ctx.profil.profil.contraintes)) {
        const minutesCourse = seances.filter((s) => s.sport === "course").reduce((t, s) => t + s.dureeMin, 0);
        const part = volumeTotal(seances) ? minutesCourse / volumeTotal(seances) : 0;
        if (part > 0.25) {
          fautes.push({
            regle: "contrainte-respectee",
            detail: `${Math.round(part * 100)} % du volume en course malgré une blessure au genou`,
          });
        }
      }

      return fautes;
    },
  },
];

export interface ResultatProfil {
  cle: string;
  intention: string;
  reussies: number;
  total: number;
  manquements: Manquement[];
  /** Renseigné quand la génération elle-même a échoué. */
  erreur?: string;
}

/** Applique toutes les règles à un programme. */
export function evaluer(seances: SeanceGeneree[], ctx: ContexteEval): ResultatProfil {
  const manquements = REGLES.flatMap((r) => r.verifier(seances, ctx));
  const enEchec = new Set(manquements.map((m) => m.regle));
  return {
    cle: ctx.profil.cle,
    intention: ctx.profil.intention,
    reussies: REGLES.length - enEchec.size,
    total: REGLES.length,
    manquements,
  };
}
