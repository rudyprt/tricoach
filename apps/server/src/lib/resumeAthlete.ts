import { prisma } from "./prisma.js";
import { chargeSeance, type BilanDeCharge, type ReferencesAthlete } from "./trainingLoad.js";
import { formatAllure } from "./activityMatching.js";
import { fcCourseTexte } from "./fcCourses.js";

/**
 * Ce que le coach doit savoir de l'entraînement de l'athlète, en quelques lignes.
 *
 * Le chat envoyait jusqu'ici quinze activités et dix séances brutes à chaque
 * message, et la génération jusqu'à trente activités : des centaines de tokens
 * que le modèle devait relire pour en tirer toujours les mêmes conclusions —
 * combien il s'entraîne, dans quel sens ça évolue, ce qui coince, comment il se
 * sent. Ces conclusions sont désormais calculées ici, une fois, et le modèle ne
 * reçoit qu'elles : moins de 300 tokens, quel que soit l'historique.
 */

const JOUR_MS = 24 * 3600 * 1000;
const SEMAINES = 4;
const DISCIPLINES = ["natation", "velo", "course"] as const;
const ABREGE: Record<string, string> = { natation: "nat", velo: "vélo", course: "càp", renfo: "renfo", autre: "autre" };
const NOM: Record<string, string> = { natation: "natation", velo: "vélo", course: "course à pied" };

export interface ProfilResume {
  objectif: string;
  objectifDate: Date;
  objectifTemps: string;
  objectifFinir: boolean;
  heuresSemaine: number;
  contraintes: string;
  tempsNatation: string;
  tempsVelo: string;
  tempsCourse: string;
  fcMoyNatation?: number | null;
  fcMaxNatation?: number | null;
  fcMoyVelo?: number | null;
  fcMaxVelo?: number | null;
  fcMoyCourse?: number | null;
  fcMaxCourse?: number | null;
}

export interface ActiviteResume {
  sport: string;
  startedAt: Date;
  dureeMin: number;
  distanceKm: number | null;
  allureSecParKm: number | null;
  fcMoyenne: number | null;
  puissanceMoy: number | null;
  sessionId: string | null;
}

export interface SeanceResume {
  id: string;
  date: Date;
  sport: string;
  titre: string;
  dureeMin: number;
  dureeReelleMin: number | null;
  status: string;
  ressenti: string | null;
}

/** Une séance faite, d'où qu'elle vienne : montre ou case cochée. */
interface Realisee {
  date: Date;
  sport: string;
  dureeMin: number;
  charge: number;
  texte: string;
}

const couper = (texte: string, max: number) => (texte.length > max ? `${texte.slice(0, max - 1).trimEnd()}…` : texte);

function heures(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${m}min`;
  return m ? `${h}h${String(m).padStart(2, "0")}` : `${h}h`;
}

const jourMois = (date: Date) => date.toISOString().slice(5, 10).split("-").reverse().join("/");

function decrireActivite(a: ActiviteResume): string {
  const morceaux = [jourMois(a.startedAt), ABREGE[a.sport] ?? a.sport, `${a.dureeMin}min`];
  if (a.distanceKm) morceaux.push(`${Math.round(a.distanceKm * 10) / 10}km`);
  if (a.puissanceMoy) morceaux.push(`${a.puissanceMoy}W`);
  else if (a.allureSecParKm && a.sport === "course") morceaux.push(formatAllure(a.allureSecParKm));
  if (a.fcMoyenne) morceaux.push(`FC${a.fcMoyenne}`);
  return morceaux.join(" ");
}

export function construireResumeAthlete(donnees: {
  profil?: ProfilResume | null;
  activites: ActiviteResume[];
  seances: SeanceResume[];
  refs: ReferencesAthlete;
  charge?: BilanDeCharge;
  maintenant?: Date;
}): string {
  const maintenant = donnees.maintenant ?? new Date();
  const debut = maintenant.getTime() - SEMAINES * 7 * JOUR_MS;
  const lignes: string[] = [];

  const p = donnees.profil;
  if (p) {
    const semaines = Math.max(0, Math.ceil((p.objectifDate.getTime() - maintenant.getTime()) / (7 * JOUR_MS)));
    const intention = p.objectifFinir ? "vise à finir, sans chrono" : p.objectifTemps ? `vise ${couper(p.objectifTemps, 20)}` : "pas de temps visé";
    lignes.push(
      `Athlète : ${couper(p.objectif, 40)} le ${p.objectifDate.toISOString().slice(0, 10)} (${semaines} sem), ${intention} ; ${p.heuresSemaine} h/sem ; contraintes : ${couper(p.contraintes, 80) || "aucune"}`,
      `Chronos : nat ${couper(p.tempsNatation, 25) || "n/r"}${fcCourseTexte(p.fcMoyNatation, p.fcMaxNatation)} · vélo ${couper(p.tempsVelo, 25) || "n/r"}${fcCourseTexte(p.fcMoyVelo, p.fcMaxVelo)} · càp ${couper(p.tempsCourse, 25) || "n/r"}${fcCourseTexte(p.fcMoyCourse, p.fcMaxCourse)}`
    );
  }

  // Ce qui a été fait. La montre prime : une séance cochée « faite » ne compte
  // que si aucune activité importée ne la recouvre déjà.
  const activites = donnees.activites.filter((a) => a.startedAt.getTime() >= debut);
  const seances = donnees.seances.filter((s) => s.date.getTime() >= debut && s.sport !== "repos");
  const couvertes = new Set(activites.map((a) => a.sessionId).filter(Boolean));
  const realisees: Realisee[] = [
    ...activites.map((a) => ({
      date: a.startedAt,
      sport: a.sport,
      dureeMin: a.dureeMin,
      charge: chargeSeance({ date: a.startedAt, sport: a.sport, dureeMin: a.dureeMin, fcMoyenne: a.fcMoyenne, puissanceMoy: a.puissanceMoy }, donnees.refs),
      texte: decrireActivite(a),
    })),
    ...seances
      .filter((s) => s.status === "faite" && !couvertes.has(s.id))
      .map((s) => {
        const duree = s.dureeReelleMin ?? s.dureeMin;
        return {
          date: s.date,
          sport: s.sport,
          dureeMin: duree,
          charge: chargeSeance({ date: s.date, sport: s.sport, dureeMin: duree }, donnees.refs),
          texte: `${jourMois(s.date)} ${ABREGE[s.sport] ?? s.sport} ${duree}min « ${couper(s.titre, 30)} »`,
        };
      }),
  ];

  // Volume : par discipline sur quatre semaines, puis semaine par semaine.
  const parSport = new Map<string, number>();
  const parSemaine = Array.from({ length: SEMAINES }, () => 0);
  for (const r of realisees) {
    parSport.set(r.sport, (parSport.get(r.sport) ?? 0) + r.dureeMin);
    const index = Math.min(SEMAINES - 1, Math.floor((maintenant.getTime() - r.date.getTime()) / (7 * JOUR_MS)));
    parSemaine[SEMAINES - 1 - index] += r.dureeMin;
  }
  if (realisees.length === 0) {
    lignes.push("Volume 4 sem : aucune séance réalisée enregistrée.");
  } else {
    const detail = ["natation", "velo", "course", "renfo", "autre"]
      .filter((s) => parSport.get(s))
      .map((s) => `${ABREGE[s]} ${heures(parSport.get(s)!)}`)
      .join(" · ");
    const recent = parSemaine[2] + parSemaine[3];
    const avant = parSemaine[0] + parSemaine[1];
    const variation = avant > 0 ? Math.round(((recent - avant) / avant) * 100) : null;
    const tendance =
      variation === null ? "reprise récente" : Math.abs(variation) < 10 ? "stable" : variation > 0 ? `en hausse, +${variation} %` : `en baisse, ${variation} %`;
    lignes.push(`Volume 4 sem : ${detail} ; par sem ${parSemaine.map(heures).join(" › ")} (${tendance})`);
  }

  // Points faibles : une discipline délaissée, des séances qui sautent.
  const faibles: string[] = [];
  const triathlon = DISCIPLINES.reduce((somme, s) => somme + (parSport.get(s) ?? 0), 0);
  if (triathlon > 0) {
    for (const s of DISCIPLINES) {
      const part = Math.round(((parSport.get(s) ?? 0) / triathlon) * 100);
      if (part < 15) faibles.push(`${NOM[s]} peu travaillée (${part} %)`);
    }
  }
  const manquees = new Map<string, number>();
  for (const s of seances.filter((x) => x.status === "manquee")) manquees.set(s.sport, (manquees.get(s.sport) ?? 0) + 1);
  for (const [sport, n] of manquees) if (n >= 2) faibles.push(`${n} séances de ${NOM[sport] ?? sport} manquées`);
  const prevues = seances.filter((s) => s.status === "faite" || s.status === "manquee").length;
  const faites = seances.filter((s) => s.status === "faite").length;
  if (prevues >= 4 && faites / prevues < 0.7) faibles.push(`${Math.round((faites / prevues) * 100)} % du programme réalisé`);
  if (faibles.length) lignes.push(`Points faibles : ${faibles.slice(0, 3).join(" ; ")}`);

  // Fatigue : ce que l'athlète a dit, puis ce que la charge mesure.
  const ressentis = [...seances]
    .filter((s) => s.ressenti?.trim())
    .sort((a, b) => b.date.getTime() - a.date.getTime())
    .slice(0, 3)
    .map((s) => `« ${couper(s.ressenti!.trim(), 40)} »`);
  const charge =
    donnees.charge && donnees.charge.seancesTotal >= 6
      ? `charge : ${donnees.charge.lecture.titre.toLowerCase()} (fraîcheur ${Math.round(donnees.charge.fraicheur)})`
      : "";
  const fatigue = [ressentis.join(" ; "), charge].filter(Boolean).join(" ; ");
  lignes.push(`Fatigue déclarée : ${fatigue || "rien de signalé"}`);

  // Séances clés : les plus exigeantes du mois, les trois plus récentes d'entre elles.
  const exigeantes = [...realisees]
    .sort((a, b) => b.charge - a.charge)
    .slice(0, Math.max(3, Math.ceil(realisees.length / 3)))
    .sort((a, b) => b.date.getTime() - a.date.getTime())
    .slice(0, 3);
  if (exigeantes.length) lignes.push(`Séances clés : ${exigeantes.map((r) => r.texte).join(" ; ")}`);

  return lignes.join("\n");
}

/** Charge les données et construit le résumé. */
export async function resumeAthlete(
  userId: string,
  options: {
    profil?: (ProfilResume & { ftpWatts: number | null; fcSeuil: number | null; fcMax: number | null }) | null;
    /** Sans profil, les références de charge doivent être fournies. */
    refs?: ReferencesAthlete;
    charge?: BilanDeCharge;
    /** Le profil figure-t-il dans le résumé ? La génération le reçoit déjà en détail. */
    avecProfil?: boolean;
    maintenant?: Date;
  } = {}
): Promise<string> {
  const maintenant = options.maintenant ?? new Date();
  const depuis = new Date(maintenant.getTime() - SEMAINES * 7 * JOUR_MS);
  const [activites, seances] = await Promise.all([
    prisma.activity.findMany({
      where: { userId, startedAt: { gte: depuis, lte: maintenant } },
      select: {
        sport: true,
        startedAt: true,
        dureeMin: true,
        distanceKm: true,
        allureSecParKm: true,
        fcMoyenne: true,
        puissanceMoy: true,
        sessionId: true,
      },
      take: 200,
    }),
    prisma.session.findMany({
      where: { userId, date: { gte: depuis, lte: maintenant } },
      select: { id: true, date: true, sport: true, titre: true, dureeMin: true, dureeReelleMin: true, status: true, ressenti: true },
      take: 200,
    }),
  ]);
  const p = options.profil;
  return construireResumeAthlete({
    profil: options.avecProfil === false ? null : p,
    activites,
    seances,
    refs: options.refs ?? { ftpWatts: p?.ftpWatts ?? null, fcSeuil: p?.fcSeuil ?? null, fcMax: p?.fcMax ?? null },
    charge: options.charge,
    maintenant,
  });
}
