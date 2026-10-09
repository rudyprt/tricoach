import type { PrismaClient } from "@prisma/client";
import {
  aujourdhuiParis,
  bilanMois,
  coutMensuelLisse,
  decalerMois,
  echeances,
  finAcre,
  listeMois,
  moisDe,
  premierMois,
  totaliser,
  type BilanMois,
  type Charge,
  type DonneesGestion,
  type Frequence,
  type Instantane,
} from "./calculs.js";
import { lireParametres, type Parametres } from "./parametres.js";

const ESSAI_JOURS = 14;
const JOUR_MS = 24 * 60 * 60 * 1000;

function dateIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function chargerParametres(prisma: PrismaClient): Promise<Parametres> {
  const ligne = await prisma.gestionParametres.findUnique({ where: { id: "unique" } });
  return lireParametres(ligne?.valeurs);
}

export function chargeDepuisBase(c: {
  id: string;
  libelle: string;
  categorie: string;
  montantCents: number;
  frequence: string;
  debut: Date;
  fin: Date | null;
}): Charge {
  return {
    id: c.id,
    libelle: c.libelle,
    categorie: c.categorie,
    montantCents: c.montantCents,
    frequence: c.frequence as Frequence,
    debut: dateIso(c.debut),
    fin: c.fin ? dateIso(c.fin) : null,
  };
}

/**
 * Utilisateurs à l'instant présent. Les administrateurs sont exclus : ton
 * propre compte n'est pas un client.
 */
async function utilisateurs(prisma: PrismaClient, now: Date) {
  const clients = { role: { not: "admin" } };
  const [inscrits, standard, premium, essais, actifs7j, actifs30j, actifsJour, verifies, profils] = await Promise.all([
    prisma.user.count({ where: clients }),
    prisma.user.count({ where: { ...clients, plan: "standard" } }),
    prisma.user.count({ where: { ...clients, plan: "premium" } }),
    prisma.user.count({ where: { ...clients, plan: "free", createdAt: { gt: new Date(now.getTime() - ESSAI_JOURS * JOUR_MS) } } }),
    prisma.user.count({ where: { ...clients, lastSeenAt: { gt: new Date(now.getTime() - 7 * JOUR_MS) } } }),
    prisma.user.count({ where: { ...clients, lastSeenAt: { gt: new Date(now.getTime() - 30 * JOUR_MS) } } }),
    prisma.user.count({ where: { ...clients, lastSeenAt: { gt: new Date(now.getTime() - JOUR_MS) } } }),
    prisma.user.count({ where: { ...clients, emailVerifiedAt: { not: null } } }),
    prisma.athleteProfile.count({ where: { user: clients } }),
  ]);
  return {
    inscrits,
    standard,
    premium,
    payants: standard + premium,
    essais,
    gratuits: inscrits - standard - premium - essais,
    actifsJour,
    actifs7j,
    actifs30j,
    verifies,
    profilsCompletes: profils,
  };
}

async function inscriptionsParMois(prisma: PrismaClient): Promise<Record<string, number>> {
  const lignes = await prisma.$queryRaw<{ mois: string; n: bigint }[]>`
    SELECT to_char(("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Paris', 'YYYY-MM') AS mois,
           COUNT(*) AS n
    FROM "User"
    WHERE role <> 'admin'
    GROUP BY 1`;
  return Object.fromEntries(lignes.map((l) => [l.mois, Number(l.n)]));
}

export async function chargerDonnees(prisma: PrismaClient): Promise<DonneesGestion> {
  const [parametres, charges, encaissements, couts, inscriptions, instantanes] = await Promise.all([
    chargerParametres(prisma),
    prisma.gestionCharge.findMany(),
    prisma.gestionEncaissement.findMany(),
    prisma.coutIaMensuel.findMany(),
    inscriptionsParMois(prisma),
    prisma.gestionInstantane.findMany(),
  ]);
  return {
    parametres,
    charges: charges.map(chargeDepuisBase),
    encaissements: encaissements.map((e) => ({
      date: dateIso(e.date),
      montantCents: e.montantCents,
      fraisCents: e.fraisCents,
    })),
    coutIaMicroUsd: Object.fromEntries(couts.map((c) => [c.mois, Number(c.coutMicroUsd)])),
    inscriptions,
    instantanes: Object.fromEntries(
      instantanes.map((i): [string, Instantane] => [
        i.mois,
        { inscrits: i.inscrits, standard: i.standard, premium: i.premium, essais: i.essais, actifs30j: i.actifs30j },
      ])
    ),
  };
}

export async function construireTableau(prisma: PrismaClient, annee: number, now: Date = new Date()) {
  const aujourdhui = aujourdhuiParis(now);
  const moisCourant = moisDe(aujourdhui);
  const users = await utilisateurs(prisma, now);

  // Photographie du mois en cours : c'est elle qui conservera, plus tard, le
  // nombre de payants de ce mois.
  const photo = {
    inscrits: users.inscrits,
    standard: users.standard,
    premium: users.premium,
    essais: users.essais,
    actifs30j: users.actifs30j,
  };
  await prisma.gestionInstantane.upsert({
    where: { mois: moisCourant },
    create: { mois: moisCourant, ...photo },
    update: photo,
  });

  const d = await chargerDonnees(prisma);
  const p = d.parametres;

  const moisAnnee = listeMois(`${annee}-01`, `${annee}-12`);
  const bilansAnnee = moisAnnee.map((m) => bilanMois(m, d));
  const parMois = new Map(bilansAnnee.map((b) => [b.mois, b]));
  const jusquIci = bilansAnnee.filter((b) => b.mois <= moisCourant);

  const depuis = premierMois(d, moisCourant);
  const bilansCumul = listeMois(depuis, moisCourant).map((m) => bilanMois(m, d));
  const ceMois: BilanMois = bilanMois(moisCourant, d);

  // Point mort : combien d'abonnés Standard couvrent les dépenses courantes.
  const chargesFixes = d.charges.reduce((s, c) => s + coutMensuelLisse(c, moisCourant), 0);
  const troisDerniers = [1, 2, 3].map((n) => bilanMois(decalerMois(moisCourant, -n), d).coutIaCents);
  const iaMoyen = Math.round(troisDerniers.reduce((a, b) => a + b, 0) / 3);
  const tauxPrelevement =
    (p.tauxCotisations * (p.acre ? 1 - p.reductionAcre / 100 : 1) +
      p.tauxCfp +
      (p.versementLiberatoire ? p.tauxVersementLiberatoire : 0)) /
    100;
  const netParAbonne = p.prixStandardCents * (1 - tauxPrelevement);
  const depensesMensuelles = chargesFixes + iaMoyen;
  const abonnesNecessaires = netParAbonne > 0 ? Math.ceil(depensesMensuelles / netParAbonne) : null;

  const mrrPotentielCents = users.standard * p.prixStandardCents + users.premium * p.prixPremiumCents;
  const caAnnee = jusquIci.reduce((s, b) => s + b.caCents, 0);
  const listeEcheances = echeances(annee, parMois, p, aujourdhui);
  const prochaine =
    listeEcheances.find((e) => e.statut === "a_declarer") ?? listeEcheances.find((e) => e.statut === "en_cours") ?? null;

  const alertes: { niveau: "info" | "attention" | "critique"; message: string }[] = [];
  if (!p.dateDebutActivite) {
    alertes.push({
      niveau: "info",
      message:
        "Micro-entreprise pas encore créée : les prélèvements URSSAF affichés sont une simulation. Renseigne la date de début d'activité dans Paramètres dès l'immatriculation.",
    });
  }
  if (mrrPotentielCents > 0 && ceMois.caCents === 0) {
    alertes.push({
      niveau: "attention",
      message: `${users.payants} compte(s) sur une offre payante, mais aucun encaissement saisi ce mois-ci. Aucun paiement n'est branché : ces comptes ont été passés à la main, vérifie qu'ils paient vraiment.`,
    });
  }
  if (caAnnee >= p.seuilTvaCents * 0.8) {
    alertes.push({
      niveau: caAnnee >= p.seuilTvaCents ? "critique" : "attention",
      message: `CA de l'année à ${Math.round((caAnnee / p.seuilTvaCents) * 100)} % du seuil de franchise de TVA : au-delà du seuil majoré, la TVA est due immédiatement.`,
    });
  }
  if (caAnnee >= p.plafondCaCents * 0.8) {
    alertes.push({
      niveau: "critique",
      message: `CA de l'année à ${Math.round((caAnnee / p.plafondCaCents) * 100)} % du plafond du régime micro.`,
    });
  }
  if (ceMois.coutIaCents > ceMois.caCents && ceMois.coutIaCents > 0) {
    alertes.push({ niveau: "attention", message: "Ce mois-ci, l'IA coûte plus que ce que l'application rapporte." });
  }
  if (prochaine?.statut === "a_declarer" && p.dateDebutActivite) {
    alertes.push({
      niveau: "attention",
      message: `Déclaration URSSAF ${prochaine.libelle} à faire avant le ${prochaine.dateLimite}, même à 0 € de CA.`,
    });
  }
  if (d.charges.length === 0) {
    alertes.push({
      niveau: "info",
      message: "Aucune charge saisie : le coût réel de l'application est sous-estimé. Ajoute hébergement, base, domaine, e-mails...",
    });
  }

  return {
    genereLe: now.toISOString(),
    aujourdhui,
    moisCourant,
    annee,
    parametres: p,
    utilisateurs: {
      ...users,
      nouveauxCeMois: d.inscriptions[moisCourant] ?? 0,
      historique: listeMois(decalerMois(moisCourant, -11), moisCourant).map((m) => ({
        mois: m,
        inscriptions: d.inscriptions[m] ?? 0,
        payants: d.instantanes[m] ? d.instantanes[m].standard + d.instantanes[m].premium : null,
        actifs30j: d.instantanes[m]?.actifs30j ?? null,
      })),
    },
    revenus: {
      mrrPotentielCents,
      arrPotentielCents: mrrPotentielCents * 12,
      coutIaParActifCents: users.actifs30j > 0 ? Math.round(ceMois.coutIaCents / users.actifs30j) : null,
    },
    ceMois,
    exercice: { mois: bilansAnnee, totaux: totaliser(jusquIci) },
    cumul: { depuis, totaux: totaliser(bilansCumul) },
    pointMort: {
      chargesFixesMensuellesCents: chargesFixes,
      coutIaMoyenCents: iaMoyen,
      depensesMensuellesCents: depensesMensuelles,
      netParAbonneStandardCents: Math.round(netParAbonne),
      abonnesNecessaires,
    },
    urssaf: {
      simulation: !p.dateDebutActivite,
      echeances: listeEcheances,
      prochaine,
      caAnneeCents: caAnnee,
      plafondCaCents: p.plafondCaCents,
      seuilTvaCents: p.seuilTvaCents,
      seuilTvaMajoreCents: p.seuilTvaMajoreCents,
      acreJusquau: p.acre && p.dateDebutActivite ? finAcre(p.dateDebutActivite) : null,
    },
    alertes,
  };
}

export type Tableau = Awaited<ReturnType<typeof construireTableau>>;
