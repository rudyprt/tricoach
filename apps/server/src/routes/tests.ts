import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth, type AuthedRequest } from "../middleware/auth.js";
import { ah, HttpError } from "../lib/http.js";
import { PROTOCOLS, type TestSport } from "../lib/fitnessTests.js";
import { applyTestResult } from "../lib/testScheduling.js";

export const testsRouter = Router();
testsRouter.use(requireAuth);

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
