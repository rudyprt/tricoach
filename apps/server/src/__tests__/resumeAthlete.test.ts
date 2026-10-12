import { describe, expect, it } from "vitest";
import { construireResumeAthlete, type ActiviteResume, type SeanceResume } from "../lib/resumeAthlete.js";
import type { BilanDeCharge } from "../lib/trainingLoad.js";

/**
 * Le résumé remplace la liste brute des séances dans tout ce qui part au
 * modèle. Il doit tenir en peu de place quel que soit l'historique, et dire
 * l'essentiel : volume, tendance, points faibles, fatigue, séances clés.
 */

const MAINTENANT = new Date("2026-10-12T18:00:00.000Z");
const ilYA = (jours: number) => new Date(MAINTENANT.getTime() - jours * 24 * 3600 * 1000);
const REFS = { ftpWatts: 230, fcSeuil: 168, fcMax: 188 };

const PROFIL = {
  objectif: "Half Ironman de Vichy",
  objectifDate: new Date("2027-06-20T00:00:00.000Z"),
  objectifTemps: "5h30",
  objectifFinir: false,
  heuresSemaine: 8,
  contraintes: "Tendinite d'Achille gauche ancienne, à surveiller sur les séances de côtes et le fractionné court en course à pied.",
  tempsNatation: "1:45/100m",
  tempsVelo: "30 km/h sur 90 km",
  tempsCourse: "10 km en 45:00",
};

function activite(jours: number, sport: string, dureeMin: number, extra: Partial<ActiviteResume> = {}): ActiviteResume {
  return {
    sport,
    startedAt: ilYA(jours),
    dureeMin,
    distanceKm: null,
    allureSecParKm: null,
    fcMoyenne: null,
    puissanceMoy: null,
    sessionId: null,
    ...extra,
  };
}

function seance(jours: number, sport: string, status: string, extra: Partial<SeanceResume> = {}): SeanceResume {
  return {
    id: `s-${jours}-${sport}`,
    date: ilYA(jours),
    sport,
    titre: "Séance",
    dureeMin: 60,
    dureeReelleMin: null,
    status,
    ressenti: null,
    ...extra,
  };
}

/** Quatre semaines chargées : une activité par jour, mesurée. */
const MOIS_CHARGE: ActiviteResume[] = Array.from({ length: 28 }, (_, i) => {
  const sport = ["course", "velo", "velo", "course", "natation", "velo", "renfo"][i % 7];
  return activite(i + 0.5, sport, 40 + (i % 5) * 20, {
    distanceKm: sport === "renfo" ? null : 10 + i,
    allureSecParKm: sport === "course" ? 290 : null,
    puissanceMoy: sport === "velo" ? 190 + i : null,
    fcMoyenne: 130 + (i % 20),
  });
});

const CHARGE = {
  fraicheur: -18.4,
  forme: 52,
  fatigue: 70,
  seancesTotal: 40,
  seancesEstimees: 2,
  lecture: { etat: "charge", titre: "Chargé", message: "" },
} as unknown as BilanDeCharge;

describe("résumé de l'athlète", () => {
  it("tient en moins de 300 tokens, même avec un mois chargé et un profil complet", () => {
    const texte = construireResumeAthlete({
      profil: PROFIL,
      activites: MOIS_CHARGE,
      seances: [
        seance(3, "course", "manquee", { ressenti: "Jambes très lourdes depuis la sortie longue de dimanche dernier" }),
        seance(10, "course", "manquee"),
        seance(5, "natation", "faite", { ressenti: "Bien" }),
      ],
      refs: REFS,
      charge: CHARGE,
      maintenant: MAINTENANT,
    });
    // Environ 2,5 caractères par token en français pour les tokenizers récents :
    // 750 caractères laissent la marge sous les 300 tokens.
    expect(texte.length).toBeLessThanOrEqual(750);
    expect(texte).toContain("Half Ironman de Vichy");
    expect(texte).toContain("vise 5h30");
    expect(texte).toMatch(/Chronos : nat 1:45\/100m/);
    expect(texte).toMatch(/Volume 4 sem : nat .* · vélo .* · càp .* · renfo/);
    expect(texte).toContain("2 séances de course à pied manquées");
    expect(texte).toContain("« Jambes très lourdes");
    expect(texte).toContain("charge : chargé (fraîcheur -18)");
    expect(texte.match(/Séances clés : (.*)/)![1].split(" ; ")).toHaveLength(3);
  });

  it("lit la tendance des deux dernières semaines face aux deux précédentes", () => {
    const hausse = [activite(2, "course", 120), activite(9, "course", 120), activite(16, "course", 60), activite(23, "course", 60)];
    expect(construireResumeAthlete({ activites: hausse, seances: [], refs: REFS, maintenant: MAINTENANT })).toContain(
      "en hausse, +100 %"
    );
    const stable = [activite(2, "course", 60), activite(9, "course", 60), activite(16, "course", 60), activite(23, "course", 60)];
    expect(construireResumeAthlete({ activites: stable, seances: [], refs: REFS, maintenant: MAINTENANT })).toContain("(stable)");
  });

  it("signale une discipline délaissée", () => {
    const texte = construireResumeAthlete({
      activites: [activite(2, "course", 300), activite(4, "velo", 300), activite(6, "natation", 30)],
      seances: [],
      refs: REFS,
      maintenant: MAINTENANT,
    });
    expect(texte).toContain("natation peu travaillée (5 %)");
  });

  it("ne compte pas deux fois une séance cochée et importée", () => {
    const texte = construireResumeAthlete({
      activites: [activite(2, "course", 50, { sessionId: "s-2-course" })],
      seances: [seance(2, "course", "faite", { dureeMin: 50 })],
      refs: REFS,
      maintenant: MAINTENANT,
    });
    expect(texte).toContain("Volume 4 sem : càp 50min");
  });

  it("le dit quand rien n'a été fait", () => {
    const texte = construireResumeAthlete({ activites: [], seances: [], refs: REFS, maintenant: MAINTENANT });
    expect(texte).toContain("aucune séance réalisée enregistrée");
    expect(texte).toContain("Fatigue déclarée : rien de signalé");
  });
});
