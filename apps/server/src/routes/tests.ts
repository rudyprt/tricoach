import { Router } from "express";
import { athleteWriteRateLimit } from "../lib/rateLimit.js";
import { prisma } from "../lib/prisma.js";
import { requireAuth, type AuthedRequest } from "../middleware/auth.js";
import { ah, HttpError } from "../lib/http.js";
import { PROTOCOLS, TEST_SPORTS, deriveThresholds, type TestSport } from "../lib/fitnessTests.js";
import { localCalendarDate, startOfWeek } from "../lib/week.js";
import { applyTestResult } from "../lib/testScheduling.js";

export const testsRouter = Router();
testsRouter.use(requireAuth);
testsRouter.use(athleteWriteRateLimit);

function serialize(test: {
  id: string;
  sport: string;
  kind: string;
  scheduledFor: Date;
  status: string;
  distanceM: number | null;
  puissanceMoy: number | null;
  temps400S: number | null;
  temps200S: number | null;
  fcMoyenne: number | null;
  resume: string | null;
}) {
  const protocol = PROTOCOLS[test.sport as TestSport];
  return {
    id: test.id,
    sport: test.sport,
    kind: test.kind,
    date: test.scheduledFor.toISOString().slice(0, 10),
    status: test.status,
    titre: protocol?.titre ?? test.kind,
    protocole: protocol?.protocole ?? "",
    mesures: protocol?.mesures ?? "",
    resultat: {
      distanceM: test.distanceM,
      puissanceMoy: test.puissanceMoy,
      temps400S: test.temps400S,
      temps200S: test.temps200S,
      fcMoyenne: test.fcMoyenne,
    },
    resume: test.resume,
  };
}

/**
 * Les tests de l'athlète : celui qui est programmé, et l'historique de ceux
 * réalisés. C'est cet historique qui montre la progression, valeur après valeur.
 */
testsRouter.get(
  "/",
  ah(async (req: AuthedRequest, res) => {
    const tests = await prisma.fitnessTest.findMany({
      where: { userId: req.userId! },
      orderBy: { scheduledFor: "desc" },
      take: 30,
    });

    res.json({
      enCours: tests.filter((t) => t.status === "planifie").map(serialize),
      historique: tests.filter((t) => t.status === "realise").map(serialize),
    });
  })
);

/**
 * L'athlète lance lui-même un test, sans attendre que le coach le programme.
 *
 * Les tests arrivent d'eux-mêmes toutes les dix semaines par discipline ; mais
 * l'athlète qui découvre que ses zones sont estimées veut les mesurer
 * maintenant. Le test est posé à aujourd'hui, et son résultat se saisit comme
 * celui d'un test programmé.
 */
testsRouter.post(
  "/demander",
  ah(async (req: AuthedRequest, res) => {
    const sport = (req.body as { sport?: unknown })?.sport;
    if (typeof sport !== "string" || !(TEST_SPORTS as readonly string[]).includes(sport)) {
      throw new HttpError(400, "Discipline inconnue.");
    }
    const deja = await prisma.fitnessTest.findFirst({
      where: { userId: req.userId!, sport, status: "planifie" },
    });
    if (deja) {
      res.json(serialize(deja));
      return;
    }
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.userId! }, select: { timezone: true } });
    const protocole = PROTOCOLS[sport as TestSport];
    const cree = await prisma.fitnessTest.create({
      data: {
        userId: req.userId!,
        sport,
        kind: protocole.kind,
        scheduledFor: new Date(`${localCalendarDate(new Date(), user.timezone)}T00:00:00.000Z`),
        weekStart: startOfWeek(new Date(), user.timezone),
      },
    });
    res.status(201).json(serialize(cree));
  })
);

function nombreOuNull(valeur: unknown): number | null {
  if (valeur === null || valeur === undefined || valeur === "") return null;
  const n = Number(valeur);
  return Number.isFinite(n) ? n : null;
}

/**
 * Saisie du résultat. Le calcul des nouvelles valeurs de seuil, et leur refus
 * si le résultat est invraisemblable, sont faits côté serveur : un client ne
 * doit jamais pouvoir écrire directement des zones.
 */
testsRouter.post(
  "/:id/result",
  ah(async (req: AuthedRequest, res) => {
    const body = req.body as Record<string, unknown>;

    try {
      const { resume, progression } = await applyTestResult(req.userId!, req.params.id, {
        distanceM: nombreOuNull(body.distanceM),
        puissanceMoy: nombreOuNull(body.puissanceMoy),
        temps400S: nombreOuNull(body.temps400S),
        temps200S: nombreOuNull(body.temps200S),
        fcMoyenne: nombreOuNull(body.fcMoyenne),
      });
      res.json({ resume, progression });
    } catch (error) {
      throw new HttpError(400, error instanceof Error ? error.message : "Résultat inexploitable.");
    }
  })
);

/**
 * L'athlète n'a pas pu faire le test. On l'abandonne plutôt que de le laisser
 * en attente indéfiniment : il sera reproposé à la prochaine échéance.
 */
testsRouter.post(
  "/:id/skip",
  ah(async (req: AuthedRequest, res) => {
    const test = await prisma.fitnessTest.findFirst({
      where: { id: req.params.id, userId: req.userId!, status: "planifie" },
    });
    if (!test) throw new HttpError(404, "Test introuvable.");

    await prisma.fitnessTest.update({ where: { id: test.id }, data: { status: "abandonne" } });
    res.json({ ok: true });
  })
);

/**
 * Progression des valeurs de seuil, test après test.
 *
 * L'historique existait, mais sous forme de phrases. Voir sa FTP monter sur
 * douze mois est précisément ce qui donne envie de refaire un test dans six
 * semaines — et c'est la seule preuve tangible que l'entraînement paie.
 */
testsRouter.get(
  "/progression",
  ah(async (req: AuthedRequest, res) => {
    const tests = await prisma.fitnessTest.findMany({
      where: { userId: req.userId!, status: "realise", appliedAt: { not: null } },
      orderBy: { scheduledFor: "asc" },
      take: 60,
    });

    const series: Record<string, { date: string; valeur: number; libelle: string }[]> = {
      course: [],
      velo: [],
      natation: [],
    };

    for (const test of tests) {
      const derive = deriveThresholds(test.kind, {
        distanceM: test.distanceM,
        puissanceMoy: test.puissanceMoy,
        temps400S: test.temps400S,
        temps200S: test.temps200S,
        fcMoyenne: test.fcMoyenne,
      });
      if (!derive) continue;

      const date = test.scheduledFor.toISOString().slice(0, 10);
      if (derive.seuilCourseSecParKm) {
        series.course.push({
          date,
          valeur: derive.seuilCourseSecParKm,
          libelle: `${formatMinSec(derive.seuilCourseSecParKm)}/km`,
        });
      }
      if (derive.ftpWatts) {
        series.velo.push({ date, valeur: derive.ftpWatts, libelle: `${derive.ftpWatts} W` });
      }
      if (derive.cssSecPer100m) {
        series.natation.push({
          date,
          valeur: derive.cssSecPer100m,
          libelle: `${formatMinSec(derive.cssSecPer100m)}/100 m`,
        });
      }
    }

    res.json({
      // Pour une allure, plus bas vaut mieux ; pour une puissance, l'inverse.
      // Le client en a besoin pour orienter la lecture du graphique.
      sens: { course: "plus_bas_mieux", natation: "plus_bas_mieux", velo: "plus_haut_mieux" },
      series,
    });
  })
);

/** Reprise du format lisible du calcul des seuils, pour l'affichage. */
function formatMinSec(secondes: number): string {
  const m = Math.floor(secondes / 60);
  const s = Math.round(secondes % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
