import { describe, expect, it } from "vitest";
import {
  computeTrainingZones,
  formatZonesForPrompt,
  formatPacePerKm,
  thresholdSpeed,
  type ZoneRange,
  parsePerformance,
  periodization,
  riegelEquivalent,
  weeksToGoal,
} from "../lib/training.js";

describe("parsePerformance", () => {
  it("lit les formats saisis dans l'onboarding", () => {
    expect(parsePerformance("1500m en 28min")).toEqual({ distanceM: 1500, durationS: 1680 });
    expect(parsePerformance("40km en 1h15")).toEqual({ distanceM: 40000, durationS: 4500 });
    expect(parsePerformance("10km en 45:30")).toEqual({ distanceM: 10000, durationS: 2730 });
    expect(parsePerformance("21,1 km en 1h35")).toEqual({ distanceM: 21100, durationS: 5700 });
  });

  it("renvoie null quand la saisie n'est pas exploitable", () => {
    expect(parsePerformance("")).toBeNull();
    expect(parsePerformance(null)).toBeNull();
    expect(parsePerformance("je cours vite")).toBeNull();
    expect(parsePerformance("10km")).toBeNull();
    expect(parsePerformance("en 45min")).toBeNull();
  });
});

describe("riegelEquivalent", () => {
  it("ramène un semi-marathon à un 10 km plus rapide au kilomètre", () => {
    const semi = { distanceM: 21100, durationS: 5700 }; // 1h35, soit 4:30/km
    const tenK = riegelEquivalent(semi, 10_000, 1.06);
    const pace = tenK / 10;
    expect(pace).toBeLessThan(5700 / 21.1);
    expect(formatPacePerKm(pace)).toBe("4:18/km");
  });
});

describe("computeTrainingZones", () => {
  /** Secondes par km depuis "4:30" (les plages sont "rapide–lent/km"). */
  const sec = (mmss: string) => {
    const [m, s] = mmss.split(":").map(Number);
    return m * 60 + s;
  };
  const bornes = (plage: string, unite: "/km" | "/100m") => {
    const [rapide, lent] = plage.replace(unite, "").split("–");
    return { rapide: sec(rapide), lent: sec(lent) };
  };
  const zoneDe = (zones: ZoneRange[] | null, nom: string) => zones?.find((z) => z.zone === nom)?.value ?? "";

  describe("course à pied", () => {
    it("produit cinq zones sous forme de plages, pas de valeurs uniques", () => {
      const { course } = computeTrainingZones({ tempsCourse: "10km en 45min" });
      expect(course).toHaveLength(5);
      expect(course?.map((z) => z.zone)).toEqual(["Z1", "Z2", "Z3", "Z4", "Z5"]);
      for (const z of course!) expect(z.value).toMatch(/^\d+:\d{2}–\d+:\d{2}\/km$/);
    });

    it("ordonne chaque plage du plus rapide au plus lent", () => {
      const { course } = computeTrainingZones({ tempsCourse: "10km en 45min" });
      for (const z of course!) {
        const { rapide, lent } = bornes(z.value, "/km");
        expect(rapide).toBeLessThan(lent);
      }
    });

    it("ordonne les zones de la plus lente à la plus rapide", () => {
      const { course } = computeTrainingZones({ tempsCourse: "10km en 45min" });
      const allures = course!.map((z) => bornes(z.value, "/km").rapide);
      for (let i = 1; i < allures.length; i++) {
        expect(allures[i]).toBeLessThan(allures[i - 1]);
      }
    });

    it("place le seuil autour de l'allure 10 km, jamais très au-delà", () => {
      // Physiologiquement, le seuil d'un amateur est proche de son allure 10 km.
      const { course } = computeTrainingZones({ tempsCourse: "10km en 50min" });
      const { rapide, lent } = bornes(zoneDe(course, "Z4"), "/km");
      expect(rapide).toBeLessThan(300); // plus rapide que 5:00/km
      expect(lent).toBeLessThan(330); // et pas au-delà de 5:30/km
    });

    it("garde un écart proportionnel au niveau, du débutant à l'élite", () => {
      // C'est le défaut du modèle précédent : avec des écarts fixes en
      // secondes, la Z2 valait 119 % de l'allure 10 km pour un débutant contre
      // 140 % pour un élite. La Z2 du débutant était donc bien trop rapide.
      const rapport = (temps: string, allure10k: number) => {
        const { course } = computeTrainingZones({ tempsCourse: temps });
        return bornes(zoneDe(course, "Z2"), "/km").rapide / allure10k;
      };

      const debutant = rapport("10km en 65min", 390);
      const elite = rapport("10km en 31min", 186);

      expect(Math.abs(debutant - elite)).toBeLessThan(0.08);
      for (const r of [debutant, elite]) {
        expect(r).toBeGreaterThan(1.08);
        expect(r).toBeLessThan(1.35);
      }
    });

    it("donne au débutant une endurance réellement facile", () => {
      // Un coureur à 6:30/km au 10 km ne doit pas voir 7:45/km en endurance.
      const { course } = computeTrainingZones({ tempsCourse: "10km en 65min" });
      expect(bornes(zoneDe(course, "Z2"), "/km").rapide).toBeGreaterThan(420); // > 7:00/km
    });

    it("préfère une allure au seuil saisie à une estimation", () => {
      const { course, notes } = computeTrainingZones({
        tempsCourse: "10km en 60min",
        seuilCourseSecParKm: 250, // 4:10/km
      });
      // La valeur saisie l'emporte : les zones ne reflètent plus le 10 km.
      expect(bornes(zoneDe(course, "Z4"), "/km").lent).toBeLessThan(270);
      expect(notes.join(" ")).toContain("renseignée");
    });
  });

  describe("natation", () => {
    it("resserre les zones autour de la CSS", () => {
      const { natation } = computeTrainingZones({ tempsNatation: "1500m en 30min" });
      // CSS = 2:00/100m ; le seuil doit l'encadrer de près.
      const seuil = bornes(zoneDe(natation, "Z4"), "/100m");
      expect(seuil.rapide).toBeGreaterThan(110);
      expect(seuil.lent).toBeLessThan(130);
    });

    it("garde un écart entre zones plus faible qu'en course", () => {
      // L'eau oppose une résistance qui croît avec le carré de la vitesse :
      // quelques secondes aux 100 m changent radicalement l'effort.
      const { natation } = computeTrainingZones({ tempsNatation: "1500m en 30min" });
      const z2 = bornes(zoneDe(natation, "Z2"), "/100m");
      const z4 = bornes(zoneDe(natation, "Z4"), "/100m");
      expect(z2.lent - z4.rapide).toBeLessThan(40);
    });

    it("préfère une CSS saisie à une estimation", () => {
      const { natation, notes } = computeTrainingZones({
        tempsNatation: "1500m en 30min",
        cssSecPer100m: 90,
      });
      expect(bornes(zoneDe(natation, "Z4"), "/100m").rapide).toBeLessThan(95);
      expect(notes.join(" ")).toContain("CSS renseignée");
    });
  });

  describe("vélo", () => {
    it("calcule des zones de puissance sur la FTP", () => {
      const { velo } = computeTrainingZones({ ftpWatts: 250 });
      expect(zoneDe(velo, "Z4")).toBe("228–263 W");
      expect(zoneDe(velo, "Z2")).toBe("140–188 W");
    });

    it("refuse d'inventer des zones en km/h sans FTP", () => {
      // À effort égal, la vitesse varie du simple au triple selon la pente et
      // le vent : une zone en km/h serait une fausse précision.
      const { velo, notes } = computeTrainingZones({ tempsVelo: "40km en 1h15" });
      expect(velo).toBeNull();
      expect(notes.join(" ")).toContain("aucune zone chiffrée");
      expect(notes.join(" ")).not.toMatch(/km\/h/);
    });

    it("dit au coach de ne jamais prescrire le vélo en km/h", () => {
      const prompt = formatZonesForPrompt(computeTrainingZones({ tempsCourse: "10km en 45min" }));
      expect(prompt).toContain("jamais par une vitesse en km/h");
    });
  });

  describe("fréquence cardiaque", () => {
    it("calcule les zones sur la FC au seuil quand elle est connue", () => {
      const { frequenceCardiaque } = computeTrainingZones({ fcSeuil: 170 });
      expect(zoneDe(frequenceCardiaque, "Z4")).toBe("160–168 bpm");
      expect(zoneDe(frequenceCardiaque, "Z2")).toBe("138–151 bpm");
    });

    it("estime le seuil depuis la FC max, en le signalant", () => {
      const { frequenceCardiaque, notes } = computeTrainingZones({ fcMax: 185 });
      expect(frequenceCardiaque).toHaveLength(5);
      expect(notes.join(" ")).toContain("estimée");
      expect(notes.join(" ")).toContain("test de 30 minutes");
    });

    it("préfère un seuil mesuré à une estimation depuis la FC max", () => {
      const avec = computeTrainingZones({ fcSeuil: 160, fcMax: 200 });
      expect(zoneDe(avec.frequenceCardiaque, "Z4")).toBe("150–158 bpm");
    });

    it("ne propose rien sans donnée cardiaque", () => {
      expect(computeTrainingZones({ tempsCourse: "10km en 45min" }).frequenceCardiaque).toBeNull();
    });
  });

  it("laisse une correction manuelle remplacer la valeur calculée", () => {
    const zones = computeTrainingZones({
      tempsCourse: "10km en 45min",
      overrides: { course: { Z2: "5:30/km" } },
    });
    const z2 = zones.course?.find((z) => z.zone === "Z2");
    expect(z2?.value).toBe("5:30/km");
    expect(z2?.custom).toBe(true);
    expect(zones.course?.find((z) => z.zone === "Z4")?.custom).toBeUndefined();
  });

  it("accepte des zones saisies pour un sport sans temps de référence", () => {
    const zones = computeTrainingZones({
      overrides: { natation: { Z4: "1:45/100m", Z2: "2:00/100m" } },
    });
    expect(zones.natation).toHaveLength(2);
    expect(zones.natation?.every((z) => z.custom)).toBe(true);
    expect(zones.course).toBeNull();
  });

  it("permet de saisir des zones vélo à la main malgré l'absence de FTP", () => {
    const zones = computeTrainingZones({ overrides: { velo: { Z4: "230-260 W" } } });
    expect(zones.velo).toHaveLength(1);
    expect(zones.velo?.[0].custom).toBe(true);
  });

  it("signale dans les notes les sports corrigés à la main", () => {
    const zones = computeTrainingZones({
      tempsCourse: "10km en 45min",
      overrides: { course: { Z3: "5:00/km" } },
    });
    expect(zones.notes.join(" ")).toContain("corrigées à la main");
  });

  it("ignore une correction vide plutôt que d'effacer la zone", () => {
    const zones = computeTrainingZones({
      tempsCourse: "10km en 45min",
      overrides: { course: { Z2: "   " } },
    });
    expect(zones.course?.find((z) => z.zone === "Z2")?.custom).toBeUndefined();
  });

  it("marque les valeurs fixées par l'athlète dans le texte envoyé au modèle", () => {
    const zones = computeTrainingZones({
      tempsCourse: "10km en 45min",
      overrides: { course: { Z4: "4:38/km" } },
    });
    expect(formatZonesForPrompt(zones)).toContain("4:38/km (valeur fixée par l'athlète)");
  });

  it("signale l'absence de données plutôt que d'inventer des zones", () => {
    const zones = computeTrainingZones({});
    expect(zones.course).toBeNull();
    expect(zones.natation).toBeNull();
    expect(zones.velo).toBeNull();
    expect(zones.frequenceCardiaque).toBeNull();
    expect(zones.notes.join(" ")).toContain("Aucune donnée exploitable");
  });
});

describe("vitesse au seuil", () => {
  it("place le seuil légèrement en deçà de l'allure 10 km", () => {
    // Le seuil est l'effort tenable une heure : plus lent qu'un 10 km couru
    // en 50 minutes, mais de peu.
    const perf = { distanceM: 10000, durationS: 3000 };
    const allureSeuil = 1000 / thresholdSpeed(perf, 3600, 1.06);
    expect(allureSeuil).toBeGreaterThan(300); // plus lent que 5:00/km
    expect(allureSeuil).toBeLessThan(315);
  });

  it("place le seuil au-delà de l'allure sur une distance déjà longue", () => {
    // Un semi couru en 1h35 se tient plus d'une heure : le seuil est plus rapide.
    const semi = { distanceM: 21100, durationS: 5700 };
    const allureSeuil = 1000 / thresholdSpeed(semi, 3600, 1.06);
    expect(allureSeuil).toBeLessThan(5700 / 21.1);
  });
});

describe("weeksToGoal", () => {
  it("compte les semaines pleines jusqu'à la semaine de l'objectif", () => {
    const weekStart = new Date("2026-09-07T00:00:00Z");
    expect(weeksToGoal(weekStart, new Date("2026-09-12T00:00:00Z"))).toBe(0);
    expect(weeksToGoal(weekStart, new Date("2026-09-19T00:00:00Z"))).toBe(1);
    expect(weeksToGoal(weekStart, new Date("2026-12-05T00:00:00Z"))).toBe(12);
    expect(weeksToGoal(weekStart, new Date("2026-08-29T00:00:00Z"))).toBe(-2);
  });
});

describe("periodization", () => {
  const weekStart = new Date("2026-09-07T00:00:00Z");
  const goalIn = (weeks: number) => new Date(weekStart.getTime() + weeks * 7 * 24 * 3600 * 1000);

  it("enchaîne base → développement → spécifique → affûtage → course", () => {
    expect(periodization(weekStart, goalIn(20)).phase).toBe("base");
    expect(periodization(weekStart, goalIn(10)).phase).toBe("developpement");
    expect(periodization(weekStart, goalIn(4)).phase).toBe("specifique");
    expect(periodization(weekStart, goalIn(2)).phase).toBe("affutage");
    expect(periodization(weekStart, goalIn(0)).phase).toBe("course");
  });

  it("bascule en transition une fois l'objectif passé", () => {
    expect(periodization(weekStart, goalIn(-2)).phase).toBe("transition");
  });

  it("réduit le volume à l'approche de la course", () => {
    expect(periodization(weekStart, goalIn(10)).volumeFactor).toBe(1);
    expect(periodization(weekStart, goalIn(2)).volumeFactor).toBeLessThan(1);
    expect(periodization(weekStart, goalIn(0)).volumeFactor).toBeLessThan(
      periodization(weekStart, goalIn(2)).volumeFactor
    );
  });
});
