import { prisma } from "./prisma.js";
import {
  PROTOCOLS,
  TEST_SPORTS,
  chooseWeeklyTest,
  deriveThresholds,
  describeProgress,
  type TestProtocol,
  type TestResult,
  type TestSport,
} from "./fitnessTests.js";
import { addDays } from "./week.js";
import type { Periodization } from "./training.js";
import type { ProfileZoneFields } from "./zoneInputs.js";

/**
 * Le seuil d'une discipline est « connu » dès qu'une valeur mesurée existe.
 * Un temps de référence déclaré à l'inscription n'en est pas un : c'est ce
 * qu'on cherche justement à remplacer par un test.
 */
function seuilsConnus(profile: ProfileZoneFields): Record<TestSport, boolean> {
  return {
    course: profile.seuilCourseSecParKm != null,
    velo: profile.ftpWatts != null,
    natation: profile.cssSecPer100m != null,
  };
}

/**
 * Jour retenu pour le test dans la semaine. On vise l'avant-dernier jour
 * ENTRAÎNABLE : l'athlète arrive reposé après une semaine allégée, et il lui
 * reste un jour pour récupérer avant la semaine suivante.
 *
 * Les jours que l'athlète a déclarés indisponibles sont écartés d'abord. Sans
 * cela, le test tombait mécaniquement sur l'avant-dernier jour de la semaine —
 * le samedi — y compris quand ce jour était déclaré sans créneau. Le prompt
 * ordonnait alors deux choses contradictoires pour la même date : un jour de
 * repos imposé, et un effort maximal.
 */
function chooseTestDay(
  allowedDates: string[],
  datesRepos: ReadonlySet<string>,
  datesImposees: ReadonlySet<string>
): string | null {
  const entrainables = allowedDates.filter((d) => !datesRepos.has(d));
  if (entrainables.length < 2) return null;

  /*
   * La discipline du test n'est choisie qu'après le jour. Poser le test sur une
   * date dont l'athlète a réservé la discipline reviendrait donc, une fois sur
   * trois, à lui demander un test de course un jour de piscine.
   *
   * On préfère les dates laissées libres. S'il n'en reste pas assez — un
   * athlète qui impose une discipline tous les jours — on retombe sur le choix
   * ordinaire : un test au mauvais endroit vaut mieux que pas de test du tout,
   * et c'est lui qui a contraint sa semaine.
   */
  const libres = entrainables.filter((d) => !datesImposees.has(d));
  const candidats = libres.length >= 2 ? libres : entrainables;
  return candidats[candidats.length - 2];
}

export interface ScheduledTest {
  id: string;
  protocol: TestProtocol;
  /** Jour du test au format YYYY-MM-DD. */
  date: string;
}

/**
 * Programme au plus un test par semaine, et le persiste pour que l'athlète
 * puisse en saisir le résultat. Si un test est déjà prévu cette semaine, il
 * est conservé tel quel : un réajustement de milieu de semaine ne doit pas
 * déplacer ni dupliquer le test.
 */
export async function planWeeklyTest(
  userId: string,
  weekStart: Date,
  phase: Periodization,
  profile: ProfileZoneFields,
  allowedDates: string[],
  /** Jours sans créneau déclaré : aucun test ne peut y être posé. */
  datesRepos: ReadonlySet<string> = new Set(),
  /** Jours dont l'athlète a réservé la discipline : évités si possible. */
  datesImposees: ReadonlySet<string> = new Set()
): Promise<ScheduledTest | null> {
  // Un test resté en attente depuis plus de deux semaines ne sera plus fait :
  // le laisser ouvert encombrerait l'écran de l'athlète et fausserait le
  // décompte des tests à venir.
  await prisma.fitnessTest.updateMany({
    where: { userId, status: "planifie", scheduledFor: { lt: new Date(weekStart.getTime() - 14 * 24 * 3600 * 1000) } },
    data: { status: "abandonne" },
  });

  const existant = await prisma.fitnessTest.findFirst({
    where: { userId, weekStart, status: { in: ["planifie", "realise"] } },
  });
  if (existant) {
    if (existant.status !== "planifie") return null;
    const date = existant.scheduledFor.toISOString().slice(0, 10);
    // Le test prévu tombe sur un jour que cette génération ne produit plus, ou
    // que l'athlète a depuis déclaré indisponible : il ne servirait à rien de
    // le décrire dans le prompt.
    if (!allowedDates.includes(date) || datesRepos.has(date)) return null;
    return { id: existant.id, protocol: PROTOCOLS[existant.sport as TestSport], date };
  }

  const jour = chooseTestDay(allowedDates, datesRepos, datesImposees);
  if (!jour) return null;

  /*
   * Deux semaines de répit entre deux tests, toutes disciplines confondues.
   *
   * L'intervalle de dix semaines vaut par discipline. Un athlète qui débute
   * n'a aucun seuil connu dans les trois : sans cette garde, il enchaînerait
   * trois efforts maximaux en trois semaines, ce qu'aucun coach ne demande
   * pour établir des valeurs de départ.
   */
  const recent = await prisma.fitnessTest.findFirst({
    where: {
      userId,
      status: { in: ["planifie", "realise"] },
      scheduledFor: { gte: addDays(weekStart, -14), lt: weekStart },
    },
    select: { id: true },
  });
  if (recent) return null;

  const derniers = await prisma.fitnessTest.findMany({
    where: { userId, status: "realise" },
    orderBy: { scheduledFor: "desc" },
    select: { sport: true, scheduledFor: true },
  });
  const dernierTest: Partial<Record<TestSport, Date>> = {};
  for (const t of derniers) {
    const sport = t.sport as TestSport;
    if (TEST_SPORTS.includes(sport) && !dernierTest[sport]) dernierTest[sport] = t.scheduledFor;
  }

  const protocol = chooseWeeklyTest({
    phase: phase.phase,
    weeksToGoal: phase.weeksToGoal,
    dernierTest,
    seuilConnu: seuilsConnus(profile),
    dejaProgrammeCetteSemaine: false,
    weekStart,
  });
  if (!protocol) return null;

  const cree = await prisma.fitnessTest.create({
    data: {
      userId,
      sport: protocol.sport,
      kind: protocol.kind,
      scheduledFor: new Date(`${jour}T00:00:00.000Z`),
      weekStart,
    },
  });

  return { id: cree.id, protocol, date: jour };
}

/**
 * Consigne insérée dans le prompt : la séance du jour retenu doit être le test
 * lui-même. Sans cette précision, le modèle programmerait une séance ordinaire
 * et le test resterait lettre morte.
 */
export function testPromptLines(test: ScheduledTest): string[] {
  return [
    "",
    `TEST DE TERRAIN À PROGRAMMER — le ${test.date}, la séance de ${test.protocol.sport} DOIT être ce test, et non une séance ordinaire :`,
    `Titre exact : "${test.protocol.titre}" (dureeMin ≈ ${test.protocol.dureeMin}).`,
    `Protocole à reprendre dans la structure de la séance : ${test.protocol.protocole}`,
    `À relever par l'athlète : ${test.protocol.mesures}`,
    "Dans \"objectif\", explique que ce test sert à recaler ses zones d'entraînement sur son niveau réel du moment.",
    "Allège la veille et le lendemain (repos ou endurance courte) : un test se court à fond.",
  ];
}

/**
 * Applique un résultat de test : met à jour les valeurs de seuil du profil, ce
 * qui recalcule mécaniquement toutes les zones à la prochaine génération.
 *
 * Un résultat invraisemblable est refusé plutôt qu'appliqué : une faute de
 * frappe fausserait l'entraînement pendant des semaines.
 */
export async function applyTestResult(
  userId: string,
  testId: string,
  result: TestResult
): Promise<{ resume: string; progression: string | null }> {
  const test = await prisma.fitnessTest.findFirst({ where: { id: testId, userId } });
  if (!test) throw new Error("Test introuvable.");
  if (test.appliedAt) throw new Error("Le résultat de ce test a déjà été enregistré.");

  const derive = deriveThresholds(test.kind, result);
  if (!derive) throw new Error("Ce résultat ne paraît pas exploitable. Vérifie les valeurs saisies.");

  const profile = await prisma.athleteProfile.findUnique({ where: { userId } });
  if (!profile) throw new Error("Profil introuvable.");

  const avant =
    derive.seuilCourseSecParKm != null
      ? profile.seuilCourseSecParKm
      : derive.ftpWatts != null
        ? profile.ftpWatts
        : derive.cssSecPer100m != null
          ? profile.cssSecPer100m
          : null;
  const apres = derive.seuilCourseSecParKm ?? derive.ftpWatts ?? derive.cssSecPer100m ?? 0;
  const progression = describeProgress(test.kind, avant, apres);

  await prisma.$transaction([
    prisma.athleteProfile.update({
      where: { userId },
      data: {
        ...(derive.seuilCourseSecParKm != null ? { seuilCourseSecParKm: derive.seuilCourseSecParKm } : {}),
        ...(derive.ftpWatts != null ? { ftpWatts: derive.ftpWatts } : {}),
        ...(derive.cssSecPer100m != null ? { cssSecPer100m: derive.cssSecPer100m } : {}),
        ...(derive.fcSeuil != null ? { fcSeuil: derive.fcSeuil } : {}),
        ...(derive.fcSeuilVelo != null ? { fcSeuilVelo: derive.fcSeuilVelo } : {}),
      },
    }),
    prisma.fitnessTest.update({
      where: { id: testId },
      data: {
        status: "realise",
        distanceM: result.distanceM ?? null,
        puissanceMoy: result.puissanceMoy ?? null,
        temps400S: result.temps400S ?? null,
        temps200S: result.temps200S ?? null,
        fcMoyenne: result.fcMoyenne ?? null,
        resume: derive.resume,
        appliedAt: new Date(),
      },
    }),
  ]);

  return { resume: derive.resume, progression };
}
