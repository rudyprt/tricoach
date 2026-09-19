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
  equivalencesNatation,
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
      expect(zoneDe(velo, "Z4")).toBe("225–263 W");
      expect(zoneDe(velo, "Z2")).toBe("138–188 W");
    });

    it("n'invente aucune zone de puissance sans FTP", () => {
      // Des watts que l'athlète ne peut pas lire seraient inexécutables.
      const { velo } = computeTrainingZones({ tempsVelo: "40km en 1h15" });
      expect(velo).toBeNull();
    });

    it("bascule sur la fréquence cardiaque quand la FTP manque", () => {
      const prompt = formatZonesForPrompt(computeTrainingZones({ tempsCourse: "10km en 45min", fcSeuil: 168 }));
      expect(prompt).toContain("FRÉQUENCE CARDIAQUE");
      // La vitesse reste proposée en repère, mais jamais sans sa réserve.
      expect(prompt).toContain("terrain plat et sans vent");
    });

    it("se rabat sur la vitesse quand ni puissance ni cardio ne sont connus", () => {
      const prompt = formatZonesForPrompt(computeTrainingZones({ tempsVelo: "40km en 1h15" }));
      expect(prompt).toContain("VITESSE en km/h");
      expect(prompt).toContain("N'invente jamais de watts");
    });

    it("assortit toujours la vitesse de sa réserve", () => {
      // À effort égal, la vitesse varie du simple au double selon la pente et
      // le vent : la donner sans le dire serait une fausse précision.
      const { notes } = computeTrainingZones({ tempsVelo: "40km en 1h15" });
      expect(notes.join(" ")).toContain("terrain plat et sans vent");
    });
  });

  describe("fréquence cardiaque", () => {
    it("calcule les zones sur la FC au seuil quand elle est connue", () => {
      // Modèle Joe Friel à cinq zones : Z4 va de 95 à 102 % du seuil, elle
      // contient donc les 170 bpm.
      const { frequenceCardiaque } = computeTrainingZones({ fcSeuil: 170 });
      expect(zoneDe(frequenceCardiaque, "Z4")).toBe("162–173 bpm");
      expect(zoneDe(frequenceCardiaque, "Z2")).toBe("145–153 bpm");
    });

    it("estime le seuil depuis la FC max, en le signalant", () => {
      const { frequenceCardiaque, notes } = computeTrainingZones({ fcMax: 185 });
      expect(frequenceCardiaque).toHaveLength(5);
      expect(notes.join(" ")).toContain("estimée");
      expect(notes.join(" ")).toContain("test de 30 minutes");
    });

    it("préfère un seuil mesuré à une estimation depuis la FC max", () => {
      const avec = computeTrainingZones({ fcSeuil: 160, fcMax: 200 });
      expect(zoneDe(avec.frequenceCardiaque, "Z4")).toBe("152–163 bpm");
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

describe("milieu de nage", () => {
  /** Valeur d'une zone donnée, ou undefined si la discipline n'en a pas. */
  const valeurZone = (ranges: ZoneRange[] | null, zone: string) =>
    ranges?.find((r) => r.zone === zone)?.value;

  it("annonce le milieu dans lequel les zones sont valables", () => {
    const { notes } = computeTrainingZones({ cssSecPer100m: 104, bassin: "50m" });
    expect(notes.join(" ")).toContain("bassin de 50 m");
  });

  it("ne décale pas la valeur mesurée", () => {
    // Une CSS chronométrée en 50 m est déjà une valeur 50 m : la corriger une
    // seconde fois ferait viser une allure que l'athlète a pourtant tenue.
    const en25 = computeTrainingZones({ cssSecPer100m: 104, bassin: "25m" });
    const en50 = computeTrainingZones({ cssSecPer100m: 104, bassin: "50m" });

    expect(valeurZone(en50.natation, "Z4")).toBe(valeurZone(en25.natation, "Z4"));
  });

  it("donne l'équivalence dans les autres milieux", () => {
    const { notes } = computeTrainingZones({ cssSecPer100m: 104, bassin: "25m" });
    const texte = notes.join(" ");

    expect(texte).toContain("Équivalences");
    expect(texte).toContain("eau libre");
    expect(texte).toContain("bassin de 50 m");
  });

  it("allonge le temps en eau libre et le raccourcit en 25 m", () => {
    // 1:44 aux 100 m en bassin de 25 m.
    const depuis25 = equivalencesNatation(104, "25m")!;
    expect(depuis25).toMatch(/1:4[5-7]\/100m en bassin de 50 m/);
    expect(depuis25).toMatch(/1:5[0-2]\/100m en eau libre/);

    // Et la conversion inverse ramène bien vers des temps plus rapides.
    const depuisEauLibre = equivalencesNatation(111, "eau_libre")!;
    expect(depuisEauLibre).toMatch(/1:4[3-5]\/100m en bassin de 25 m/);
  });

  it("ne dit rien quand le milieu n'est pas renseigné", () => {
    const { notes } = computeTrainingZones({ cssSecPer100m: 104 });
    expect(notes.join(" ")).not.toContain("Équivalences");
    expect(equivalencesNatation(104, "")).toBeNull();
  });
});

/**
 * Deux propriétés que toute table de zones doit vérifier, quelle que soit la
 * discipline. Elles ont toutes deux été violées en production : la première
 * laissait des fréquences cardiaques et des puissances sans zone, la seconde
 * plaçait la fréquence cardiaque au seuil dans la zone VO2max.
 */
describe("cohérence des tables de zones", () => {
  const ATHLETE = {
    seuilCourseSecParKm: 248,
    cssSecPer100m: 104,
    ftpWatts: 248,
    fcSeuil: 168,
  };

  /** « 4:01–4:21/km », « 223–260 W », « 158–171 bpm » → [min, max] numériques. */
  function bornes(valeur: string): [number, number] {
    const chronos = valeur.match(/(\d+):(\d{2})/g);
    if (chronos && chronos.length === 2) {
      const enSecondes = chronos.map((c) => {
        const [m, s] = c.split(":").map(Number);
        return m * 60 + s;
      });
      // Une allure se lit à l'envers : le temps le plus grand est le plus lent.
      return [Math.min(...enSecondes), Math.max(...enSecondes)];
    }
    const nombres = valeur.match(/\d+/g)!.map(Number);
    return [Math.min(...nombres), Math.max(...nombres)];
  }

  const tables = () => {
    const z = computeTrainingZones(ATHLETE);
    return [
      { nom: "course", ranges: z.course!, seuil: 248, allure: true },
      { nom: "natation", ranges: z.natation!, seuil: 104, allure: true },
      { nom: "vélo", ranges: z.velo!, seuil: 248, allure: false },
      { nom: "fréquence cardiaque", ranges: z.frequenceCardiaque!, seuil: 168, allure: false },
    ];
  };

  it("ne laisse aucun trou entre deux zones consécutives", () => {
    for (const { nom, ranges, allure } of tables()) {
      const paliers = ranges.map((r) => bornes(r.value));
      for (let i = 0; i < paliers.length - 1; i += 1) {
        // Une allure se lit en décroissant — Z2 est plus rapide, donc un temps
        // plus petit — alors que watts et battements croissent. La borne
        // partagée n'est donc pas du même côté.
        const [finZone, debutSuivante] = allure
          ? [paliers[i][0], paliers[i + 1][1]]
          : [paliers[i][1], paliers[i + 1][0]];
        expect(Math.abs(finZone - debutSuivante), `${nom} entre Z${i + 1} et Z${i + 2}`).toBeLessThanOrEqual(1);
      }
    }
  });

  it("place la valeur au seuil dans la zone qui porte ce nom", () => {
    for (const { nom, ranges, seuil } of tables()) {
      const z4 = ranges.find((r) => r.zone === "Z4")!;
      const [min, max] = bornes(z4.value);
      expect(seuil, `${nom} : Z4 vaut ${z4.value}`).toBeGreaterThanOrEqual(min);
      expect(seuil, `${nom} : Z4 vaut ${z4.value}`).toBeLessThanOrEqual(max);
    }
  });

  it("garde l'endurance fondamentale nettement plus lente que le seuil", () => {
    // Elle recouvrait l'allure marathon : l'athlète courait ses sorties
    // faciles trop vite, le défaut même que ce modèle doit empêcher.
    const { course } = computeTrainingZones(ATHLETE);
    const [rapide] = bornes(course!.find((r) => r.zone === "Z2")!.value);

    expect(rapide).toBeGreaterThanOrEqual(285);
    expect(rapide).toBeLessThanOrEqual(310);
  });
});

describe("modèle Joe Friel à cinq zones", () => {
  const zoneDeFc = (zone: string, inputs: Parameters<typeof computeTrainingZones>[0]) =>
    computeTrainingZones(inputs).frequenceCardiaque!.find((r) => r.zone === zone)!.value;

  it("découpe les zones aux pourcentages du modèle", () => {
    // 65-85, 85-90, 90-95, 95-102 pour une FC au seuil de 160 bpm.
    const seuil = { fcSeuil: 160 };
    expect(zoneDeFc("Z1", seuil)).toBe("104–136 bpm");
    expect(zoneDeFc("Z2", seuil)).toBe("136–144 bpm");
    expect(zoneDeFc("Z3", seuil)).toBe("144–152 bpm");
    expect(zoneDeFc("Z4", seuil)).toBe("152–163 bpm");
  });

  it("fait monter la zone haute jusqu'à la FC maximale connue", () => {
    // Friel ne lui donne pas de plafond : la FC max est la vraie borne, et
    // elle parle davantage à l'athlète qu'un pourcentage arbitraire.
    expect(zoneDeFc("Z5", { fcSeuil: 168, fcMax: 186 })).toBe("171–186 bpm");
  });

  it("se rabat sur une borne prudente sans FC maximale", () => {
    expect(zoneDeFc("Z5", { fcSeuil: 168 })).toBe("171–178 bpm");
  });

  it("ignore une FC maximale incohérente avec le seuil", () => {
    // Une valeur inférieure au bas de la zone ne peut pas en être le plafond.
    expect(zoneDeFc("Z5", { fcSeuil: 168, fcMax: 150 })).toBe("171–178 bpm");
  });
});

describe("lecture d'un temps de référence ambigu", () => {
  it("lit « 1:45 » en heures sur un semi-marathon", () => {
    // Lu en minutes, ce temps donnait 589 km/h — et des zones à sept
    // secondes au kilomètre, affichées sans le moindre avertissement.
    expect(parsePerformance("21km en 1:45")).toEqual({ distanceM: 21000, durationS: 6300 });
  });

  it("le lit en minutes quand c'est la seule lecture plausible", () => {
    expect(parsePerformance("10km en 50:00")).toEqual({ distanceM: 10000, durationS: 3000 });
    expect(parsePerformance("400m en 7:30")).toEqual({ distanceM: 400, durationS: 450 });
  });

  it("comprend une allure saisie à la place d'un temps", () => {
    // « 5:00/km » sur 42,2 km, c'est 3 h 31, pas cinq heures — lecture qui
    // passait pourtant le contrôle de plausibilité.
    expect(parsePerformance("42,2km en 5:00/km")).toEqual({ distanceM: 42200, durationS: 12660 });
    expect(parsePerformance("10km en 5:00/km")).toEqual({ distanceM: 10000, durationS: 3000 });
  });

  it("refuse un temps qu'aucune lecture ne rend humain", () => {
    expect(parsePerformance("10km en 0:02")).toBeNull();
  });
});

describe("garde-fou sur les seuils estimés", () => {
  const base = {
    tempsCourse: "", tempsNatation: "", tempsVelo: "",
    seuilCourseSecParKm: null, ftpWatts: null, cssSecPer100m: null,
    fcSeuil: null, fcMax: null, overrides: {},
  };

  it("estime un seuil cohérent depuis un semi en 1h45", () => {
    const z = computeTrainingZones({ ...base, tempsCourse: "21km en 1:45" });
    expect(z.notes.join(" ")).toContain("seuil estimé à 4:5");
    // Aucune zone ne doit tomber sous la minute au kilomètre.
    for (const r of z.course ?? []) expect(r.value).not.toMatch(/\b0:\d{2}\//);
  });

  it("n'affiche aucune zone plutôt qu'une zone absurde", () => {
    // 10 km en 10 minutes se lit sans peine, mais aucun humain ne le court :
    // le seuil déduit sort du domaine, la zone n'est pas affichée.
    const z = computeTrainingZones({ ...base, tempsCourse: "10km en 0:10" });
    expect(z.course).toBeNull();
    expect(z.notes.join(" ")).toContain("n'a pas pu être interprété");
  });
});

describe("repères de vitesse à vélo", () => {
  const base = {
    tempsCourse: "", tempsNatation: "", tempsVelo: "",
    seuilCourseSecParKm: null, ftpWatts: null, cssSecPer100m: null,
    fcSeuil: null, fcMax: null, overrides: {},
  };

  it("donne des km/h quand ni puissance ni fréquence cardiaque ne sont connues", () => {
    // L'application annonçait des km/h et n'en affichait aucun.
    const z = computeTrainingZones({ ...base, tempsVelo: "40km en 1h15" });
    expect(z.velo).toBeNull();
    expect(z.veloVitesse).toHaveLength(5);
    for (const r of z.veloVitesse ?? []) expect(r.value).toMatch(/^\d{1,2}–\d{1,2} km\/h$/);
  });

  it("classe les vitesses dans l'ordre croissant des zones", () => {
    const z = computeTrainingZones({ ...base, tempsVelo: "40km en 1h15" });
    const bas = (v: string) => Number(v.split("–")[0]);
    const vitesses = (z.veloVitesse ?? []).map((r) => bas(r.value));
    expect([...vitesses].sort((a, b) => a - b)).toEqual(vitesses);
  });

  it("s'efface dès qu'une FTP est connue : la puissance fait foi", () => {
    const z = computeTrainingZones({ ...base, tempsVelo: "40km en 1h15", ftpWatts: 248 });
    expect(z.velo).toHaveLength(5);
    expect(z.veloVitesse).toBeNull();
  });
});

describe("allure et fréquence cardiaque de front", () => {
  const base = {
    tempsCourse: "21km en 1:45", tempsNatation: "400m en 7:30", tempsVelo: "40km en 1h15",
    seuilCourseSecParKm: null, ftpWatts: null, cssSecPer100m: null,
    fcSeuil: 168, fcMax: 188, overrides: {},
  };

  it("joint la fréquence de la même zone à chaque allure", () => {
    const z = computeTrainingZones(base);
    for (const tableau of [z.course, z.natation, z.veloVitesse]) {
      expect(tableau).not.toBeNull();
      for (const r of tableau ?? []) expect(r.fc).toMatch(/^\d{2,3}–\d{2,3} bpm$/);
    }
  });

  it("apparie bien les zones entre elles", () => {
    const z = computeTrainingZones(base);
    const parZone = new Map((z.frequenceCardiaque ?? []).map((r) => [r.zone, r.value]));
    for (const r of z.course ?? []) expect(r.fc).toBe(parZone.get(r.zone));
  });

  it("n'ajoute rien quand aucune fréquence n'est connue", () => {
    // Inventer une fourchette de battements serait pire que ne rien dire.
    const z = computeTrainingZones({ ...base, fcSeuil: null, fcMax: null });
    for (const r of z.course ?? []) expect(r.fc).toBeUndefined();
  });

  it("garde la fréquence sur une zone corrigée à la main", () => {
    const z = computeTrainingZones({ ...base, overrides: { course: { Z4: "4:30–4:50/km" } } });
    const seuil = (z.course ?? []).find((r) => r.zone === "Z4");
    expect(seuil?.value).toBe("4:30–4:50/km");
    expect(seuil?.custom).toBe(true);
    expect(seuil?.fc).toMatch(/bpm$/);
  });
});
