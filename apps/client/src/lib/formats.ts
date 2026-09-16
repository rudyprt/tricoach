import { JOURS, type Disponibilites } from "./api";

/**
 * Conversions entre ce qu'un athlète écrit et ce que l'API attend.
 *
 * Ces fonctions vivaient dans les composants où elles servaient, parfois en
 * double. Elles sont la seule logique du client qui puisse être fausse sans
 * qu'on le voie : une allure mal convertie fausse toutes les zones.
 */

/** « 4:10 » ou « 4:10/km » → 250 secondes. Null si la saisie est vide ou illisible. */
export function allureVersSecondes(saisie: string): number | null {
  const propre = saisie.trim().replace(/\/(km|100m)$/i, "");
  if (propre === "") return null;
  const match = propre.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const secondes = Number(match[2]);
  // « 4:75 » n'est pas une allure : sans cette garde, on renverrait 315 s,
  // soit 5:15, sans que l'athlète comprenne d'où sort la valeur enregistrée.
  if (secondes > 59) return null;
  return Number(match[1]) * 60 + secondes;
}

export function secondesVersAllure(secondes: number): string {
  const m = Math.floor(secondes / 60);
  const s = Math.round(secondes % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * Saisie d'un chrono de test : « 7:42 », « 7,42 » ou « 462 ».
 * Un athlète lit sa montre, il ne convertit pas en secondes.
 */
export function parseChrono(valeur: string): number | null {
  const propre = valeur.trim().replace(",", ":");
  if (!propre) return null;

  if (propre.includes(":")) {
    const parties = propre.split(":");
    if (parties.length !== 2) return null;
    const minutes = Number(parties[0]);
    const secondes = Number(parties[1]);
    if (!Number.isFinite(minutes) || !Number.isFinite(secondes)) return null;
    if (minutes < 0 || secondes < 0 || secondes > 59) return null;
    return Math.round(minutes * 60 + secondes);
  }

  const n = Number(propre);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
}

/** « 2026-03-07 » → « samedi 7 mars ». */
export function formatJourLong(date: string): string {
  // Midi, et non minuit : une date à minuit UTC recule d'un jour dans les
  // fuseaux négatifs, et l'athlète verrait la veille de sa séance.
  return new Date(`${date}T12:00:00`).toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

export function formatJourCourt(date: string): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/** Minutes déclarées disponibles sur la semaine, d'après les créneaux. */
export function totalCreneauxMin(disponibilites: Disponibilites): number {
  return JOURS.reduce((somme, jour) => {
    const creneau = disponibilites[jour];
    return somme + (creneau?.disponible && creneau.dureeMaxMin ? creneau.dureeMaxMin : 0);
  }, 0);
}

/** « 495 » → « 8 h 15 ». Pour afficher un volume, pas une allure. */
export function formatDuree(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}
