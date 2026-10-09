import type { Parametres } from "./parametres.js";

/**
 * Calculs de gestion, sans accès à la base : tout ce qui décide d'un montant
 * passe par ici et se teste sans serveur.
 *
 * Conventions : montants en centimes d'euro (entiers), mois au format
 * "2026-10", dates au format "2026-10-09". Comptabilité de trésorerie, comme
 * l'exige le régime micro : une dépense compte le mois où elle est payée, une
 * recette le mois où elle est encaissée.
 */

export type Frequence = "ponctuelle" | "mensuelle" | "annuelle";

export interface Charge {
  id: string;
  libelle: string;
  categorie: string;
  montantCents: number;
  frequence: Frequence;
  debut: string;
  fin: string | null;
}

export interface Encaissement {
  date: string;
  montantCents: number;
  fraisCents: number;
}

export interface Instantane {
  inscrits: number;
  standard: number;
  premium: number;
  essais: number;
  actifs30j: number;
}

export interface DonneesGestion {
  parametres: Parametres;
  charges: Charge[];
  encaissements: Encaissement[];
  /** Coût IA brut, en micro-dollars, par mois. */
  coutIaMicroUsd: Record<string, number>;
  /** Nouveaux comptes par mois (comptes encore existants). */
  inscriptions: Record<string, number>;
  instantanes: Record<string, Instantane>;
}

export interface BilanMois {
  mois: string;
  caCents: number;
  fraisPaiementCents: number;
  chargesCents: number;
  chargesParCategorie: Record<string, number>;
  coutIaCents: number;
  cotisationsSocialesCents: number;
  cfpCents: number;
  versementLiberatoireCents: number;
  /** Total dû à l'URSSAF au titre de ce mois. */
  prelevementsCents: number;
  /** Ce qui reste réellement : CA − frais − charges − IA − URSSAF. */
  resultatCents: number;
  inscriptions: number;
  payants: number | null;
  /** ACRE appliquée à ce mois. */
  acre: boolean;
}

// ─── Dates ────────────────────────────────────────────────────────────────

export function moisDe(date: string): string {
  return date.slice(0, 7);
}

export function decalerMois(mois: string, n: number): string {
  const [a, m] = mois.split("-").map(Number);
  const total = a * 12 + (m - 1) + n;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}

/** Mois de `debut` à `fin` inclus, dans l'ordre. */
export function listeMois(debut: string, fin: string): string[] {
  const out: string[] = [];
  for (let m = debut; m <= fin; m = decalerMois(m, 1)) out.push(m);
  return out;
}

export function dernierJour(mois: string): string {
  const [a, m] = mois.split("-").map(Number);
  const jour = new Date(Date.UTC(a, m, 0)).getUTCDate();
  return `${mois}-${String(jour).padStart(2, "0")}`;
}

/** "2026-10-09" dans le fuseau de Paris. */
export function aujourdhuiParis(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("fr-CA", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

// ─── Charges ──────────────────────────────────────────────────────────────

/** Ce que la charge coûte ce mois-là, en trésorerie. */
export function chargeDuMois(charge: Charge, mois: string): number {
  const premier = moisDe(charge.debut);
  if (charge.frequence === "ponctuelle") return mois === premier ? charge.montantCents : 0;
  if (mois < premier) return 0;
  if (charge.fin && mois > moisDe(charge.fin)) return 0;
  if (charge.frequence === "mensuelle") return charge.montantCents;
  // Annuelle : prélevée chaque année au mois anniversaire.
  return mois.slice(5) === premier.slice(5) ? charge.montantCents : 0;
}

/** Coût mensuel lissé d'une charge récurrente encore active : sert au « point mort ». */
export function coutMensuelLisse(charge: Charge, mois: string): number {
  if (charge.frequence === "ponctuelle") return 0;
  if (mois < moisDe(charge.debut)) return 0;
  if (charge.fin && mois > moisDe(charge.fin)) return 0;
  return charge.frequence === "mensuelle" ? charge.montantCents : Math.round(charge.montantCents / 12);
}

// ─── IA ───────────────────────────────────────────────────────────────────

export function coutIaCents(microUsd: number, p: Parametres): number {
  return Math.round((microUsd * p.tauxUsdEur * (1 + p.tvaSurIa / 100)) / 10_000);
}

// ─── URSSAF ───────────────────────────────────────────────────────────────

/**
 * Dernier mois couvert par l'ACRE : fin du troisième trimestre civil qui suit
 * celui du début d'activité (soit quatre trimestres en comptant le premier).
 */
export function finAcre(dateDebut: string): string {
  const [a, m] = dateDebut.split("-").map(Number);
  const trimestre = Math.floor((m - 1) / 3) + 3;
  const annee = a + Math.floor(trimestre / 4);
  const dernierMois = (trimestre % 4) * 3 + 3;
  return `${annee}-${String(dernierMois).padStart(2, "0")}`;
}

export function acreActive(mois: string, p: Parametres): boolean {
  if (!p.acre) return false;
  // Pas encore créée : on simule l'ACRE telle qu'elle s'appliquerait.
  if (!p.dateDebutActivite) return true;
  return mois >= moisDe(p.dateDebutActivite) && mois <= finAcre(p.dateDebutActivite);
}

export function prelevements(caCents: number, mois: string, p: Parametres) {
  const avantCreation = p.dateDebutActivite !== null && mois < moisDe(p.dateDebutActivite);
  if (avantCreation || caCents <= 0) {
    return { social: 0, cfp: 0, vl: 0, total: 0, acre: false };
  }
  const acre = acreActive(mois, p);
  const tauxSocial = p.tauxCotisations * (acre ? 1 - p.reductionAcre / 100 : 1);
  const social = Math.round((caCents * tauxSocial) / 100);
  const cfp = Math.round((caCents * p.tauxCfp) / 100);
  const vl = p.versementLiberatoire ? Math.round((caCents * p.tauxVersementLiberatoire) / 100) : 0;
  return { social, cfp, vl, total: social + cfp + vl, acre };
}

// ─── Bilans ───────────────────────────────────────────────────────────────

export function bilanMois(mois: string, d: DonneesGestion): BilanMois {
  let caCents = 0;
  let fraisPaiementCents = 0;
  for (const e of d.encaissements) {
    if (moisDe(e.date) !== mois) continue;
    caCents += e.montantCents;
    fraisPaiementCents += e.fraisCents;
  }

  const chargesParCategorie: Record<string, number> = {};
  let chargesCents = 0;
  for (const c of d.charges) {
    const montant = chargeDuMois(c, mois);
    if (!montant) continue;
    chargesCents += montant;
    chargesParCategorie[c.categorie] = (chargesParCategorie[c.categorie] ?? 0) + montant;
  }

  const ia = coutIaCents(d.coutIaMicroUsd[mois] ?? 0, d.parametres);
  const urssaf = prelevements(caCents, mois, d.parametres);
  const instantane = d.instantanes[mois];

  return {
    mois,
    caCents,
    fraisPaiementCents,
    chargesCents,
    chargesParCategorie,
    coutIaCents: ia,
    cotisationsSocialesCents: urssaf.social,
    cfpCents: urssaf.cfp,
    versementLiberatoireCents: urssaf.vl,
    prelevementsCents: urssaf.total,
    resultatCents: caCents - fraisPaiementCents - chargesCents - ia - urssaf.total,
    inscriptions: d.inscriptions[mois] ?? 0,
    payants: instantane ? instantane.standard + instantane.premium : null,
    acre: urssaf.acre,
  };
}

export type Totaux = Omit<BilanMois, "mois" | "payants" | "acre" | "chargesParCategorie"> & {
  chargesParCategorie: Record<string, number>;
};

export function totaliser(bilans: BilanMois[]): Totaux {
  const t: Totaux = {
    caCents: 0,
    fraisPaiementCents: 0,
    chargesCents: 0,
    chargesParCategorie: {},
    coutIaCents: 0,
    cotisationsSocialesCents: 0,
    cfpCents: 0,
    versementLiberatoireCents: 0,
    prelevementsCents: 0,
    resultatCents: 0,
    inscriptions: 0,
  };
  for (const b of bilans) {
    t.caCents += b.caCents;
    t.fraisPaiementCents += b.fraisPaiementCents;
    t.chargesCents += b.chargesCents;
    t.coutIaCents += b.coutIaCents;
    t.cotisationsSocialesCents += b.cotisationsSocialesCents;
    t.cfpCents += b.cfpCents;
    t.versementLiberatoireCents += b.versementLiberatoireCents;
    t.prelevementsCents += b.prelevementsCents;
    t.resultatCents += b.resultatCents;
    t.inscriptions += b.inscriptions;
    for (const [cat, v] of Object.entries(b.chargesParCategorie)) {
      t.chargesParCategorie[cat] = (t.chargesParCategorie[cat] ?? 0) + v;
    }
  }
  return t;
}

/** Premier mois où l'activité a laissé une trace : le point de départ du cumul. */
export function premierMois(d: DonneesGestion, moisCourant: string): string {
  const candidats = [
    ...d.charges.map((c) => moisDe(c.debut)),
    ...d.encaissements.map((e) => moisDe(e.date)),
    ...Object.keys(d.coutIaMicroUsd),
    ...Object.keys(d.inscriptions),
  ].filter((m) => m <= moisCourant);
  return candidats.length ? candidats.sort()[0] : moisCourant;
}

// ─── Échéances URSSAF ─────────────────────────────────────────────────────

export type StatutEcheance = "a_venir" | "en_cours" | "a_declarer" | "echue";

export interface Echeance {
  libelle: string;
  premierMois: string;
  dernierMois: string;
  /** Dernier jour pour déclarer et payer. */
  dateLimite: string;
  caCents: number;
  montantCents: number;
  statut: StatutEcheance;
}

const NOMS_MOIS = [
  "janvier", "février", "mars", "avril", "mai", "juin",
  "juillet", "août", "septembre", "octobre", "novembre", "décembre",
];

export function nomMois(mois: string): string {
  return `${NOMS_MOIS[Number(mois.slice(5)) - 1]} ${mois.slice(0, 4)}`;
}

/**
 * Périodes de déclaration de l'année. La date limite est le dernier jour du
 * mois qui suit la période (30 avril, 31 juillet, 31 octobre, 31 janvier en
 * trimestriel).
 */
export function echeances(annee: number, bilans: Map<string, BilanMois>, p: Parametres, aujourdhui: string): Echeance[] {
  const pas = p.periodicite === "mensuelle" ? 1 : 3;
  const out: Echeance[] = [];
  for (let i = 0; i < 12; i += pas) {
    const premier = `${annee}-${String(i + 1).padStart(2, "0")}`;
    const dernier = decalerMois(premier, pas - 1);
    const mois = listeMois(premier, dernier);
    const dateLimite = dernierJour(decalerMois(dernier, 1));
    let caCents = 0;
    let montantCents = 0;
    for (const m of mois) {
      caCents += bilans.get(m)?.caCents ?? 0;
      montantCents += bilans.get(m)?.prelevementsCents ?? 0;
    }
    const moisCourant = moisDe(aujourdhui);
    let statut: StatutEcheance;
    if (moisCourant < premier) statut = "a_venir";
    else if (moisCourant <= dernier) statut = "en_cours";
    else if (aujourdhui <= dateLimite) statut = "a_declarer";
    else statut = "echue";

    const libelle = pas === 1 ? nomMois(premier) : `T${i / 3 + 1} ${annee}`;
    out.push({ libelle, premierMois: premier, dernierMois: dernier, dateLimite, caCents, montantCents, statut });
  }
  return out;
}
