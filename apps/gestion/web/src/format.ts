const eur = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" });
const eurRond = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });

export function euros(cents: number): string {
  return eur.format(cents / 100);
}

/** Pour les axes et les gros chiffres : pas de centimes. */
export function eurosRonds(cents: number): string {
  return eurRond.format(cents / 100);
}

const MOIS_COURTS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
const MOIS_LONGS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

export function moisCourt(mois: string): string {
  return MOIS_COURTS[Number(mois.slice(5)) - 1];
}

export function moisLong(mois: string): string {
  return `${MOIS_LONGS[Number(mois.slice(5)) - 1]} ${mois.slice(0, 4)}`;
}

export function dateFr(date: string): string {
  const [a, m, j] = date.split("-");
  return `${j}/${m}/${a}`;
}

/** "12,50" ou "12.5" → 1250. Null si illisible. */
export function versCents(saisie: string): number | null {
  const propre = saisie.replace(/\s|€/g, "").replace(",", ".");
  if (!/^-?\d+(\.\d{1,2})?$/.test(propre)) return null;
  return Math.round(Number(propre) * 100);
}

export function centsVersSaisie(cents: number): string {
  return (cents / 100).toFixed(2).replace(".", ",");
}

export const CATEGORIES: Record<string, string> = {
  hebergement: "Hébergement",
  base_de_donnees: "Base de données",
  ia: "IA (abonnement, crédits)",
  email: "E-mails",
  domaine: "Nom de domaine",
  logiciel: "Logiciels",
  materiel: "Matériel",
  juridique: "Juridique, comptabilité",
  marketing: "Marketing",
  banque: "Frais bancaires",
  autre: "Autre",
};

const nombre = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 });

/** 21.2 → « 21,2 ». */
export function nombreFr(n: number): string {
  return nombre.format(n);
}
