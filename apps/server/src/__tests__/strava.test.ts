import { describe, expect, it } from "vitest";
import { normalize, toSport, type StravaActivity } from "../lib/strava.js";
import { describeActivity, findMatchingSession, formatAllure } from "../lib/activityMatching.js";

const brut = (extra: Partial<StravaActivity> = {}): StravaActivity => ({
  id: 1001,
  name: "Footing matinal",
  type: "Run",
  start_date: "2026-09-09T06:30:00Z",
  elapsed_time: 3000,
  moving_time: 2700,
  distance: 10000,
  ...extra,
});

describe("correspondance des disciplines", () => {
  it("reconnaît les types Strava usuels", () => {
    expect(toSport("Run")).toBe("course");
    expect(toSport("TrailRun")).toBe("course");
    expect(toSport("Ride")).toBe("velo");
    expect(toSport("VirtualRide")).toBe("velo");
    expect(toSport("Swim")).toBe("natation");
    expect(toSport("WeightTraining")).toBe("renfo");
  });

  it("range l'inconnu dans « autre » plutôt que de deviner", () => {
    expect(toSport("Kitesurf")).toBe("autre");
    expect(toSport("")).toBe("autre");
  });
});

describe("normalisation d'une activité", () => {
  it("retient le temps en mouvement, pas le temps écoulé", () => {
    // Le temps écoulé inclut les arrêts : il surestime l'effort.
    expect(normalize(brut()).dureeMin).toBe(45);
  });

  it("calcule l'allure au kilomètre", () => {
    // 10 km en 2700 s = 270 s/km = 4:30/km
    const a = normalize(brut());
    expect(a.allureSecParKm).toBe(270);
    expect(formatAllure(a.allureSecParKm!)).toBe("4:30/km");
  });

  it("n'invente pas d'allure sans distance exploitable", () => {
    expect(normalize(brut({ distance: undefined })).allureSecParKm).toBeNull();
    expect(normalize(brut({ distance: 50 })).allureSecParKm).toBeNull();
  });

  it("conserve les mesures de la montre quand elles existent", () => {
    const a = normalize(brut({ average_heartrate: 152.4, max_heartrate: 178, average_watts: 231.6 }));
    expect(a.fcMoyenne).toBe(152);
    expect(a.fcMax).toBe(178);
    expect(a.puissanceMoy).toBe(232);
  });

  it("laisse les mesures absentes à null plutôt qu'à zéro", () => {
    const a = normalize(brut());
    expect(a.fcMoyenne).toBeNull();
    expect(a.puissanceMoy).toBeNull();
  });

  it("ne descend jamais sous une minute", () => {
    expect(normalize(brut({ moving_time: 20 })).dureeMin).toBe(1);
  });
});

describe("rapprochement avec une séance planifiée", () => {
  const seance = (id: string, jour: string, sport: string, dureeMin: number, status = "planifiee") => ({
    id,
    date: new Date(`${jour}T00:00:00.000Z`),
    sport,
    dureeMin,
    status,
  });

  it("rapproche même jour et même discipline", () => {
    const activite = normalize(brut());
    const trouvee = findMatchingSession(activite, [
      seance("s1", "2026-09-09", "course", 45),
      seance("s2", "2026-09-10", "course", 45),
    ]);
    expect(trouvee?.id).toBe("s1");
  });

  it("ne rapproche pas une discipline différente", () => {
    const activite = normalize(brut({ type: "Ride" }));
    expect(findMatchingSession(activite, [seance("s1", "2026-09-09", "course", 45)])).toBeNull();
  });

  it("ne rapproche pas un autre jour", () => {
    const activite = normalize(brut());
    expect(findMatchingSession(activite, [seance("s1", "2026-09-11", "course", 45)])).toBeNull();
  });

  it("ne rapproche jamais un jour de repos", () => {
    const activite = normalize(brut({ type: "Workout" }));
    expect(findMatchingSession(activite, [seance("s1", "2026-09-09", "repos", 0)])).toBeNull();
  });

  it("choisit la séance dont la durée prévue est la plus proche", () => {
    const activite = normalize(brut()); // 45 min
    const trouvee = findMatchingSession(activite, [
      seance("courte", "2026-09-09", "course", 20),
      seance("proche", "2026-09-09", "course", 50),
      seance("longue", "2026-09-09", "course", 120),
    ]);
    expect(trouvee?.id).toBe("proche");
  });

  it("ne rapproche rien quand aucune séance ne correspond", () => {
    expect(findMatchingSession(normalize(brut()), [])).toBeNull();
  });
});

describe("description transmise au coach", () => {
  it("résume les chiffres mesurés", () => {
    const texte = describeActivity({
      sport: "course",
      startedAt: new Date("2026-09-09T06:30:00Z"),
      dureeMin: 45,
      distanceKm: 10,
      allureSecParKm: 270,
      fcMoyenne: 152,
      puissanceMoy: null,
      denivelePosM: 120,
    });
    expect(texte).toContain("2026-09-09");
    expect(texte).toContain("course");
    expect(texte).toContain("45min");
    expect(texte).toContain("10km");
    expect(texte).toContain("4:30/km");
    expect(texte).toContain("FC moy 152");
    expect(texte).toContain("D+ 120m");
  });

  it("omet ce qui n'a pas été mesuré, sans laisser de trou", () => {
    const texte = describeActivity({
      sport: "natation",
      startedAt: new Date("2026-09-09T06:30:00Z"),
      dureeMin: 30,
      distanceKm: null,
      allureSecParKm: null,
      fcMoyenne: null,
      puissanceMoy: null,
      denivelePosM: 10,
    });
    expect(texte).toBe("2026-09-09 natation 30min");
  });
});
