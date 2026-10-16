import { Prisma } from "@prisma/client";
import { prisma } from "./prisma.js";
import { HttpError } from "./http.js";

/**
 * Consentement aux données de santé : blessures, douleurs, contraintes
 * physiques, ressentis après séance ou course, et motif médical d'une
 * interruption.
 *
 * Il est distinct de l'acceptation des conditions : sans lui, ces données ne
 * sont pas enregistrées et le service reste utilisable. Il se retire depuis
 * « Mon compte », et le retrait efface ce qui avait déjà été enregistré : un
 * consentement retiré qui laisserait les données en place ne serait qu'un
 * mot.
 */

/** Version du texte affiché sous les champs de santé (composant ConsentementSante du client). */
export const CONSENT_SANTE_VERSION = "2026-10";

/** Les textes successifs, pour savoir à quoi chaque entrée du journal renvoie. */
export const TEXTES_CONSENTEMENT_SANTE: Record<string, string> = {
  "2026-09":
    "J'accepte que TriCoach utilise les informations sur mes blessures ou douleurs pour adapter mon programme. Je peux retirer mon consentement à tout moment en vidant ce champ.",
  "2026-10":
    "J'accepte que TriCoach enregistre mes blessures, douleurs et ressentis après séance, et les transmette à son prestataire d'IA, pour adapter mes programmes. Je peux retirer ce consentement à tout moment depuis Mon compte.",
};

type Client = Prisma.TransactionClient | typeof prisma;

/** Une ligne du journal : la preuve qu'un consentement a été donné ou retiré, et quand. */
export function journaliserConsentement(
  client: Client,
  userId: string,
  objet: "sante" | "conditions",
  action: "donne" | "retire",
  version: string
) {
  return client.consentementJournal.create({ data: { userId, objet, action, version } });
}

export async function consentementSante(userId: string): Promise<Date | null> {
  const profil = await prisma.athleteProfile.findUnique({ where: { userId }, select: { consentSanteAt: true } });
  return profil?.consentSanteAt ?? null;
}

/** Enregistre le consentement ; la date du premier accord est conservée. */
export async function donnerConsentementSante(userId: string): Promise<Date | null> {
  const actuel = await consentementSante(userId);
  if (actuel) return actuel;
  const maintenant = new Date();
  const { count } = await prisma.athleteProfile.updateMany({
    where: { userId, consentSanteAt: null },
    data: { consentSanteAt: maintenant },
  });
  if (count === 0) return consentementSante(userId);
  await journaliserConsentement(prisma, userId, "sante", "donne", CONSENT_SANTE_VERSION);
  return maintenant;
}

/**
 * Les données de santé de cette requête peuvent-elles être gardées ? Oui si le
 * consentement existe, ou s'il vient d'être donné par la case cochée avec.
 */
export async function santeAutorisee(userId: string, caseCochee: unknown): Promise<boolean> {
  if (await consentementSante(userId)) return true;
  return caseCochee === true && Boolean(await donnerConsentementSante(userId));
}

/** Historique des accords et retraits, du plus récent au plus ancien. */
export function historiqueConsentements(userId: string) {
  return prisma.consentementJournal.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: { objet: true, action: true, version: true, createdAt: true },
  });
}

/**
 * Retire le consentement et efface, en une transaction, toutes les données de
 * santé du compte, et tout ce qui pourrait en contenir et repartir vers le
 * modèle :
 * - blessures et contraintes du profil, ressentis des séances ;
 * - ressenti des courses, et l'analyse qui en a été tirée ;
 * - précision et motif médical des interruptions (elles restent : leurs dates
 *   règlent la reprise) ;
 * - l'historique du chat, son résumé et les consignes que le coach en a
 *   retenues : « j'ai mal au genou » écrit au coach est aussi une donnée de
 *   santé, et ces trois-là sont renvoyés au modèle à chaque échange ou
 *   génération.
 *
 * Refusé pendant la génération d'une semaine : le modèle travaille alors sur
 * des données lues avant le retrait, et la semaine produite en porterait la
 * trace.
 */
export async function retirerConsentementSante(userId: string): Promise<{ ressentis: number; messages: number }> {
  const enCours = await prisma.generationJob.count({ where: { userId, status: { in: ["en_attente", "en_cours"] } } });
  if (enCours > 0) {
    throw new HttpError(409, "Une semaine est en cours de génération : réessayez dans une minute, une fois qu'elle est prête.");
  }

  // Le ressenti d'une course est rangé dans son résultat, un objet JSON.
  const courses = await prisma.race.findMany({ where: { userId, resultat: { not: Prisma.DbNull } }, select: { id: true, resultat: true } });
  const coursesAvecRessenti = courses.filter((c) => {
    const r = c.resultat as { ressenti?: unknown } | null;
    return typeof r?.ressenti === "string" && r.ressenti.trim() !== "";
  });
  const avaitConsenti = Boolean(await consentementSante(userId));

  const [, ressentis, , , messages] = await prisma.$transaction([
    prisma.athleteProfile.updateMany({ where: { userId }, data: { consentSanteAt: null, contraintes: "" } }),
    prisma.session.updateMany({ where: { userId, ressenti: { not: null } }, data: { ressenti: null } }),
    prisma.trainingPause.updateMany({ where: { userId, detail: { not: "" } }, data: { detail: "" } }),
    prisma.trainingPause.updateMany({
      where: { userId, raison: { in: ["blessure", "maladie"] } },
      data: { raison: "indisponibilite" },
    }),
    prisma.chatMessage.deleteMany({ where: { userId } }),
    prisma.resumeChat.deleteMany({ where: { userId } }),
    prisma.consigneCoach.deleteMany({ where: { userId } }),
    ...coursesAvecRessenti.map((c) =>
      prisma.race.update({
        where: { id: c.id },
        data: {
          resultat: { ...(c.resultat as Prisma.JsonObject), ressenti: "" },
          analyse: Prisma.DbNull,
          analyseLe: null,
        },
      })
    ),
    ...(avaitConsenti ? [journaliserConsentement(prisma, userId, "sante", "retire", CONSENT_SANTE_VERSION)] : []),
  ]);
  return { ressentis: ressentis.count + coursesAvecRessenti.length, messages: messages.count };
}
