import { prisma } from "./prisma.js";
import { isMailConfigured, sendMail } from "./mailer.js";
import { ADMIN_ROLE } from "../middleware/admin.js";
import { env } from "./env.js";

/**
 * Suppression des comptes restés inactifs.
 *
 * La politique de confidentialité annonce une suppression après deux ans sans
 * activité. Rien ne l'exécutait : l'engagement était écrit mais pas tenu, ce
 * qui est pire que de ne rien promettre — un athlète qui s'en prévaut a raison,
 * et la preuve du manquement est dans le texte lui-même.
 *
 * Le compte est supprimé, pas anonymisé : tout le reste — profil, séances,
 * activités, tests, abonnements aux notifications — part en cascade avec lui.
 */

/** Deux ans sans ouvrir l'application. */
export const INACTIVITE_AVANT_PURGE_JOURS = 730;

/** L'avertissement part trente jours avant la suppression. */
export const DELAI_AVERTISSEMENT_JOURS = 30;

/** Verrou consultatif propre à la purge, distinct de celui des rappels. */
const VERROU_PURGE = 862_002;

export interface BilanPurge {
  avertis: number;
  supprimes: number;
}

function ilYaJours(now: Date, jours: number): Date {
  return new Date(now.getTime() - jours * 24 * 60 * 60 * 1000);
}

function mailAvertissement(to: string, name: string, jours: number) {
  const url = env().APP_URL;
  return {
    to,
    subject: "Ton compte TriCoach va être supprimé",
    text: [
      `Bonjour ${name},`,
      "",
      `Tu ne t'es pas connecté à TriCoach depuis près de deux ans. Comme l'annonce notre politique de confidentialité, les comptes inactifs sont supprimés : le tien le sera dans ${jours} jours, avec tout son historique d'entraînement.`,
      "",
      "Pour le conserver, il suffit de te reconnecter une fois :",
      url,
      "",
      "Si tu préfères qu'il disparaisse, tu n'as rien à faire.",
    ].join("\n"),
  };
}

/**
 * Un passage. Avertit ceux qui approchent de l'échéance, supprime ceux qui
 * l'ont dépassée.
 *
 * L'inactivité se compte sur la dernière visite, et à défaut sur la création du
 * compte : quelqu'un qui s'inscrit sans jamais revenir est inactif depuis son
 * inscription, pas depuis jamais.
 */
export async function runRetention(now: Date = new Date()): Promise<BilanPurge> {
  const bilan: BilanPurge = { avertis: 0, supprimes: 0 };

  const [{ obtenu }] = await prisma.$queryRaw<{ obtenu: boolean }[]>`
    SELECT pg_try_advisory_lock(${VERROU_PURGE}::bigint) AS obtenu
  `;
  if (!obtenu) return bilan;

  try {
    const seuilSuppression = ilYaJours(now, INACTIVITE_AVANT_PURGE_JOURS);
    const seuilAvertissement = ilYaJours(now, INACTIVITE_AVANT_PURGE_JOURS - DELAI_AVERTISSEMENT_JOURS);

    /*
     * Les administrateurs sont exclus : supprimer le seul compte capable
     * d'administrer le service parce qu'il ne s'entraîne pas serait une panne
     * déguisée en conformité.
     */
    const inactifs = await prisma.user.findMany({
      where: { role: { not: ADMIN_ROLE } },
      select: { id: true, email: true, name: true, createdAt: true, lastSeenAt: true, purgeAvertieLe: true },
    });

    for (const compte of inactifs) {
      const derniereActivite = compte.lastSeenAt ?? compte.createdAt;

      if (derniereActivite < seuilSuppression) {
        await prisma.user.delete({ where: { id: compte.id } });
        bilan.supprimes += 1;
        continue;
      }

      /*
       * L'avertissement n'a de sens que s'il peut partir. Sans SMTP, la
       * suppression a quand même lieu le moment venu : elle est annoncée dans
       * la politique de confidentialité, que l'athlète a acceptée.
       */
      if (derniereActivite < seuilAvertissement && !compte.purgeAvertieLe && isMailConfigured()) {
        const jours = Math.max(
          1,
          Math.ceil((derniereActivite.getTime() - seuilSuppression.getTime()) / (24 * 60 * 60 * 1000))
        );
        await sendMail(mailAvertissement(compte.email, compte.name, jours));
        await prisma.user.update({ where: { id: compte.id }, data: { purgeAvertieLe: now } });
        bilan.avertis += 1;
      }
    }

    if (bilan.supprimes > 0 || bilan.avertis > 0) {
      console.log(`[conservation] ${bilan.avertis} averti(s), ${bilan.supprimes} compte(s) supprimé(s)`);
    }
    return bilan;
  } finally {
    await prisma.$queryRaw`SELECT pg_advisory_unlock(${VERROU_PURGE}::bigint)`;
  }
}

/** Un passage par jour suffit pour une échéance qui se compte en années. */
export const INTERVALLE_PURGE_MS = 24 * 60 * 60 * 1000;

let minuterie: NodeJS.Timeout | null = null;

/**
 * Démarre le passage quotidien. Contrairement aux rappels, il tourne même sans
 * SMTP ni clés de notification : la suppression est une obligation envers
 * l'athlète, pas un service qu'on lui rend.
 */
export function startRetentionScheduler(): void {
  if (minuterie) return;
  minuterie = setInterval(() => {
    runRetention().catch((erreur) => console.error("[conservation] passage échoué", erreur));
  }, INTERVALLE_PURGE_MS);
  minuterie.unref();
  console.log("[conservation] purge des comptes inactifs, passage quotidien");
}

export function stopRetentionScheduler(): void {
  if (minuterie) clearInterval(minuterie);
  minuterie = null;
}
