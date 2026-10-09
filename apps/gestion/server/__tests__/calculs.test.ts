import { describe, expect, it } from "vitest";
import {
  bilanMois,
  chargeDuMois,
  coutIaCents,
  decalerMois,
  dernierJour,
  echeances,
  finAcre,
  prelevements,
  premierMois,
  totaliser,
  type Charge,
  type DonneesGestion,
} from "../calculs.js";
import { lireParametres, PARAMETRES_PAR_DEFAUT, type Parametres } from "../parametres.js";

const p = (partiel: Partial<Parametres> = {}): Parametres => ({ ...PARAMETRES_PAR_DEFAUT, ...partiel });

const charge = (partiel: Partial<Charge>): Charge => ({
  id: "c",
  libelle: "Charge",
  categorie: "hebergement",
  montantCents: 700,
  frequence: "mensuelle",
  debut: "2026-03-15",
  fin: null,
  ...partiel,
});

describe("dates", () => {
  it("décale les mois à travers les années", () => {
    expect(decalerMois("2026-11", 3)).toBe("2027-02");
    expect(decalerMois("2026-01", -1)).toBe("2025-12");
  });

  it("connaît le dernier jour du mois, années bissextiles comprises", () => {
    expect(dernierJour("2028-02")).toBe("2028-02-29");
    expect(dernierJour("2026-04")).toBe("2026-04-30");
  });
});

describe("charges", () => {
  it("compte une charge mensuelle de son premier mois à sa résiliation", () => {
    const c = charge({ fin: "2026-06-10" });
    expect(chargeDuMois(c, "2026-02")).toBe(0);
    expect(chargeDuMois(c, "2026-03")).toBe(700);
    expect(chargeDuMois(c, "2026-06")).toBe(700);
    expect(chargeDuMois(c, "2026-07")).toBe(0);
  });

  it("compte une charge annuelle au seul mois anniversaire", () => {
    const c = charge({ frequence: "annuelle", montantCents: 1200 });
    expect(chargeDuMois(c, "2026-03")).toBe(1200);
    expect(chargeDuMois(c, "2026-04")).toBe(0);
    expect(chargeDuMois(c, "2027-03")).toBe(1200);
  });

  it("compte une charge ponctuelle une seule fois", () => {
    const c = charge({ frequence: "ponctuelle" });
    expect(chargeDuMois(c, "2026-03")).toBe(700);
    expect(chargeDuMois(c, "2027-03")).toBe(0);
  });
});

describe("IA", () => {
  it("convertit les micro-dollars en centimes d'euro, TVA comprise", () => {
    // 10 $ à 0,86 €/$ = 8,60 €, plus 20 % de TVA = 10,32 €.
    expect(coutIaCents(10_000_000, p())).toBe(1032);
    expect(coutIaCents(10_000_000, p({ tvaSurIa: 0 }))).toBe(860);
  });
});

describe("URSSAF", () => {
  it("applique cotisations, CFP et versement libératoire sur le CA", () => {
    const r = prelevements(100_000, "2026-10", p({ dateDebutActivite: "2026-01-01", versementLiberatoire: true }));
    expect(r.social).toBe(21_200);
    expect(r.cfp).toBe(100);
    expect(r.vl).toBe(1_700);
    expect(r.total).toBe(23_000);
  });

  it("ne prélève rien avant le début d'activité", () => {
    expect(prelevements(100_000, "2026-05", p({ dateDebutActivite: "2026-06-01" })).total).toBe(0);
  });

  it("couvre l'ACRE jusqu'à la fin du troisième trimestre suivant la création", () => {
    expect(finAcre("2026-11-15")).toBe("2027-09");
    expect(finAcre("2026-01-02")).toBe("2026-12");
    expect(finAcre("2026-07-01")).toBe("2027-06");
  });

  it("réduit les seules cotisations sociales pendant l'ACRE", () => {
    const params = p({ dateDebutActivite: "2026-11-15", acre: true, reductionAcre: 25 });
    const pendant = prelevements(100_000, "2027-09", params);
    expect(pendant.acre).toBe(true);
    expect(pendant.social).toBe(15_900);
    expect(pendant.cfp).toBe(100);
    const apres = prelevements(100_000, "2027-10", params);
    expect(apres.acre).toBe(false);
    expect(apres.social).toBe(21_200);
  });

  it("place les échéances trimestrielles à la fin du mois qui suit le trimestre", () => {
    const liste = echeances(2026, new Map(), p(), "2026-10-09");
    expect(liste.map((e) => e.dateLimite)).toEqual(["2026-04-30", "2026-07-31", "2026-10-31", "2027-01-31"]);
    expect(liste.map((e) => e.statut)).toEqual(["echue", "echue", "a_declarer", "en_cours"]);
  });

  it("produit douze échéances en déclaration mensuelle", () => {
    const liste = echeances(2026, new Map(), p({ periodicite: "mensuelle" }), "2026-10-09");
    expect(liste).toHaveLength(12);
    expect(liste[8]).toMatchObject({ premierMois: "2026-09", dateLimite: "2026-10-31", statut: "a_declarer" });
  });
});

describe("bilan", () => {
  const donnees: DonneesGestion = {
    parametres: p({ dateDebutActivite: "2026-01-01", tvaSurIa: 0, tauxUsdEur: 1 }),
    charges: [charge({ montantCents: 1_000, debut: "2026-01-01" })],
    encaissements: [
      { date: "2026-10-03", montantCents: 10_000, fraisCents: 200 },
      { date: "2026-10-20", montantCents: -2_000, fraisCents: 0 },
    ],
    coutIaMicroUsd: { "2026-10": 5_000_000 },
    inscriptions: { "2026-10": 4, "2025-12": 1 },
    instantanes: { "2026-10": { inscrits: 5, standard: 2, premium: 1, essais: 1, actifs30j: 4 } },
  };

  it("déduit frais, charges, IA et URSSAF du CA, remboursements compris", () => {
    const b = bilanMois("2026-10", donnees);
    expect(b.caCents).toBe(8_000);
    expect(b.fraisPaiementCents).toBe(200);
    expect(b.chargesCents).toBe(1_000);
    expect(b.coutIaCents).toBe(500);
    expect(b.prelevementsCents).toBe(1_696 + 8);
    expect(b.resultatCents).toBe(8_000 - 200 - 1_000 - 500 - 1_704);
    expect(b.payants).toBe(3);
    expect(b.inscriptions).toBe(4);
  });

  it("totalise les mois et part de la première trace d'activité", () => {
    expect(premierMois(donnees, "2026-10")).toBe("2025-12");
    const t = totaliser(["2026-09", "2026-10"].map((m) => bilanMois(m, donnees)));
    expect(t.chargesCents).toBe(2_000);
    expect(t.chargesParCategorie).toEqual({ hebergement: 2_000 });
  });
});

describe("paramètres", () => {
  it("complète une ligne enregistrée avant l'ajout d'un champ", () => {
    expect(lireParametres({ tauxCotisations: 25.6 })).toEqual({ ...PARAMETRES_PAR_DEFAUT, tauxCotisations: 25.6 });
  });

  it("retombe sur les valeurs par défaut si la ligne est invalide", () => {
    expect(lireParametres({ tauxCotisations: "beaucoup" })).toEqual(PARAMETRES_PAR_DEFAUT);
    expect(lireParametres(null)).toEqual(PARAMETRES_PAR_DEFAUT);
  });
});
