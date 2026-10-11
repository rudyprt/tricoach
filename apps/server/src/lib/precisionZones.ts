import { prisma } from "./prisma.js";
import type { TestSport } from "./fitnessTests.js";
import type { ZoneInputs } from "./training.js";

/**
 * D'où vient chaque jeu de zones, et ce qu'il vaut.
 *
 * Une zone n'est pas plus juste que la valeur dont elle part : une FC au seuil
 * déduite de la FC max peut se tromper de dix battements, une allure tirée
 * d'un chrono ancien aussi. L'athlète doit le savoir, et savoir comment y
 * remédier — un test de terrain dans la discipline concernée.
 */

/** Au-delà, un test a perdu sa valeur : la forme a changé depuis. */
export const VALIDITE_TEST_JOURS = 56;

export type NiveauPrecision = "mesuree" | "saisie" | "estimee" | "absente";

export interface PrecisionZone {
  discipline: "course" | "velo" | "natation" | "frequenceCardiaque";
  niveau: NiveauPrecision;
  /** D'où vient la valeur, en clair. */
  source: string;
  /** Le test qui la recalerait, quand il en faut un. */
  test: TestSport | null;
  aRefaire: boolean;
}

interface ProfilZones {
  tempsCourse: string;
  tempsVelo: string;
  tempsNatation: string;
  seuilCourseSecParKm: number | null;
  ftpWatts: number | null;
  cssSecPer100m: number | null;
  fcSeuil: number | null;
  fcMax: number | null;
}

const jourFr = (d: Date) => d.toLocaleDateString("fr-FR", { day: "numeric", month: "long", timeZone: "UTC" });

export async function precisionDesZones(
  userId: string,
  profil: ProfilZones,
  inputs: ZoneInputs,
  maintenant = new Date()
): Promise<PrecisionZone[]> {
  const tests = await prisma.fitnessTest.findMany({
    where: { userId, status: "realise", appliedAt: { not: null } },
    orderBy: { scheduledFor: "desc" },
    select: { sport: true, scheduledFor: true, fcMoyenne: true },
  });
  const dernier = (sport: TestSport) => tests.find((t) => t.sport === sport) ?? null;
  const perime = (d: Date) => maintenant.getTime() - d.getTime() > VALIDITE_TEST_JOURS * 24 * 3600 * 1000;
  const corrigees = (sport: "course" | "velo" | "natation") =>
    Object.values(inputs.overrides?.[sport] ?? {}).some((v) => typeof v === "string" && v.trim() !== "");

  const discipline = (
    sport: "course" | "velo" | "natation",
    seuil: number | null,
    chrono: string,
    libelleTest: string
  ): PrecisionZone => {
    const test = dernier(sport);
    if (corrigees(sport)) {
      return { discipline: sport, niveau: "saisie", source: "Zones corrigées à la main.", test: sport, aRefaire: false };
    }
    if (test && seuil != null) {
      return {
        discipline: sport,
        niveau: "mesuree",
        source: `${libelleTest} du ${jourFr(test.scheduledFor)}.`,
        test: sport,
        aRefaire: perime(test.scheduledFor),
      };
    }
    if (seuil != null) {
      return { discipline: sport, niveau: "saisie", source: "Valeur de seuil que vous avez saisie.", test: sport, aRefaire: false };
    }
    if (chrono.trim()) {
      return { discipline: sport, niveau: "estimee", source: `Estimées depuis votre chrono « ${chrono.trim()} ».`, test: sport, aRefaire: false };
    }
    return { discipline: sport, niveau: "absente", source: "Aucune référence pour cette discipline.", test: sport, aRefaire: false };
  };

  const testCourse = dernier("course");
  let fc: PrecisionZone;
  if (testCourse?.fcMoyenne && profil.fcSeuil) {
    fc = {
      discipline: "frequenceCardiaque",
      niveau: "mesuree",
      source: `FC au seuil mesurée pendant votre test de course du ${jourFr(testCourse.scheduledFor)}.`,
      test: "course",
      aRefaire: perime(testCourse.scheduledFor),
    };
  } else if (profil.fcSeuil) {
    fc = { discipline: "frequenceCardiaque", niveau: "saisie", source: "FC au seuil que vous avez saisie.", test: "course", aRefaire: false };
  } else if (inputs.fcMax) {
    fc = {
      discipline: "frequenceCardiaque",
      niveau: "estimee",
      source: profil.fcMax
        ? `FC au seuil estimée à 92 % de votre FC max (${inputs.fcMax} bpm) : l'écart réel peut atteindre 10 battements.`
        : `FC au seuil estimée depuis la FC max relevée sur vos séances (${inputs.fcMax} bpm).`,
      test: "course",
      aRefaire: false,
    };
  } else {
    fc = { discipline: "frequenceCardiaque", niveau: "absente", source: "Ni FC au seuil ni FC max renseignée.", test: "course", aRefaire: false };
  }

  return [
    discipline("course", profil.seuilCourseSecParKm, profil.tempsCourse, "Mesurées par votre test de 30 min"),
    discipline("velo", profil.ftpWatts, profil.tempsVelo, "Mesurées par votre test FTP"),
    discipline("natation", profil.cssSecPer100m, profil.tempsNatation, "Mesurées par votre test CSS"),
    fc,
  ];
}

