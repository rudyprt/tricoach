import { describe, expect, it } from "vitest";
import {
  TAU_FATIGUE,
  TAU_FORME,
  chargeSeance,
  lireLaCharge,
  serieDeCharge,
  type ReferencesAthlete,
} from "../lib/trainingLoad.js";

const SANS_REFERENCE: ReferencesAthlete = { ftpWatts: null, fcSeuil: null, fcMax: null };
const AVEC_REFERENCES: ReferencesAthlete = { ftpWatts: 250, fcSeuil: 170, fcMax: 190 };

const jour = (n: number) => new Date(Date.UTC(2026, 2, n));

describe("charge d'une séance", () => {
  it("vaut 100 pour une heure au seuil, en puissance", () => {
    const charge = chargeSeance(
      { date: jour(1), sport: "velo", dureeMin: 60, puissanceMoy: 250 },
      AVEC_REFERENCES
    );
    expect(charge).toBe(100);
  });

  it("croît avec le carré de l'intensité, pas linéairement", () => {
    // Rouler une heure à 125 % du seuil coûte bien plus que 1,25 fois une
    // heure au seuil : c'est tout l'intérêt du carré.
    const seuil = chargeSeance({ date: jour(1), sport: "velo", dureeMin: 60, puissanceMoy: 250 }, AVEC_REFERENCES);
    const fort = chargeSeance({ date: jour(1), sport: "velo", dureeMin: 60, puissanceMoy: 312 }, AVEC_REFERENCES);
    expect(fort).toBeGreaterThan(seuil * 1.5);
  });

  it("se rabat sur la fréquence cardiaque sans capteur de puissance", () => {
    const charge = chargeSeance(
      { date: jour(1), sport: "course", dureeMin: 60, fcMoyenne: 170 },
      AVEC_REFERENCES
    );
    expect(charge).toBe(100);
  });

  it("borne la fréquence cardiaque, qui dérive avec la chaleur et la fatigue", () => {
    const delirant = chargeSeance(
      { date: jour(1), sport: "course", dureeMin: 60, fcMoyenne: 250 },
      AVEC_REFERENCES
    );
    // Plafonné à 1,25 × seuil, soit 1,25² × 100.
    expect(delirant).toBe(156);
  });

  it("se rabat sur la durée quand rien n'est mesuré", () => {
    const natation = chargeSeance({ date: jour(1), sport: "natation", dureeMin: 60 }, SANS_REFERENCE);
    const velo = chargeSeance({ date: jour(1), sport: "velo", dureeMin: 60 }, SANS_REFERENCE);
    // Une heure de natation coûte plus qu'une heure de vélo, qui se roule en
    // partie en roue libre.
    expect(natation).toBeGreaterThan(velo);
  });

  it("ne compte rien pour une séance de durée nulle", () => {
    expect(chargeSeance({ date: jour(1), sport: "repos", dureeMin: 0 }, AVEC_REFERENCES)).toBe(0);
  });
});

describe("série de charge", () => {
  it("fait monter la fatigue plus vite que la condition", () => {
    const charges = new Map<string, number>();
    for (let i = 1; i <= 14; i += 1) charges.set(`2026-03-${String(i).padStart(2, "0")}`, 100);

    const points = serieDeCharge(charges, jour(1), jour(14));
    const dernier = points[points.length - 1];

    expect(dernier.fatigue).toBeGreaterThan(dernier.forme);
    expect(dernier.fraicheur).toBeLessThan(0);
    expect(TAU_FATIGUE).toBeLessThan(TAU_FORME);
  });

  it("fait remonter la fraîcheur au repos, la condition baissant plus lentement", () => {
    const charges = new Map<string, number>();
    for (let i = 1; i <= 14; i += 1) charges.set(`2026-03-${String(i).padStart(2, "0")}`, 100);

    // Deux semaines de charge, puis dix jours sans rien : l'affûtage.
    const points = serieDeCharge(charges, jour(1), jour(24));
    const finCharge = points.find((p) => p.date === "2026-03-14")!;
    const apresRepos = points[points.length - 1];

    expect(apresRepos.fraicheur).toBeGreaterThan(finCharge.fraicheur);
    expect(apresRepos.forme).toBeGreaterThan(0);
  });

  it("produit un point par jour, jours de repos compris", () => {
    const points = serieDeCharge(new Map(), jour(1), jour(10));
    expect(points).toHaveLength(10);
    expect(points[0].date).toBe("2026-03-01");
    expect(points[9].date).toBe("2026-03-10");
  });
});

describe("lecture de la charge", () => {
  it("alerte quand la fatigue dépasse nettement la condition", () => {
    expect(lireLaCharge(-45, 60).etat).toBe("surcharge");
  });

  it("distingue un bloc de charge assumé d'une surcharge", () => {
    expect(lireLaCharge(-18, 60).etat).toBe("charge");
  });

  it("distingue la fraîcheur d'avant-course de celle d'une reprise", () => {
    expect(lireLaCharge(25, 60).message).toContain("jour de course");
    expect(lireLaCharge(25, 5).message).toContain("reprise");
  });

  it("reconnaît un équilibre", () => {
    expect(lireLaCharge(0, 50).etat).toBe("equilibre");
  });
});
