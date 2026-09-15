import crypto from "node:crypto";
import { prisma } from "./prisma.js";
import { env } from "./env.js";
import { isMailConfigured, sendMail, type Mail } from "./mailer.js";
import { trialEndsAt } from "./subscription.js";
import { addDays, localCalendarDate, safeTimeZone, startOfWeek } from "./week.js";

export const REMINDER_KINDS = ["semaine_a_generer", "seances_oubliees", "fin_essai"] as const;
export type ReminderKind = (typeof REMINDER_KINDS)[number];

/**
 * Heure locale à partir de laquelle les rappels partent. Le soir : un athlète
 * qui lit « tu n'as pas validé tes séances » à 8 h du matin n'a pas encore eu
 * sa journée pour les faire.
 */
export const HEURE_ENVOI = 18;

/** Heure locale de l'athlète, 0-23. */
export function heureLocale(instant: Date, timeZone: string): number {
  const rendu = new Intl.DateTimeFormat("en-GB", {
    timeZone: safeTimeZone(timeZone),
    hour: "2-digit",
    hourCycle: "h23",
  }).format(instant);
  return Number(rendu);
}

/** Jour de la semaine local, 1 = lundi … 7 = dimanche. */
export function jourLocal(instant: Date, timeZone: string): number {
  const iso = localCalendarDate(instant, timeZone);
  const jour = new Date(`${iso}T00:00:00.000Z`).getUTCDay();
  return jour === 0 ? 7 : jour;
}

/**
 * Clé de semaine ISO, utilisée comme période d'idempotence. Deux rappels de la
 * même nature dans la même semaine portent la même clé, et le second est
 * refusé par la contrainte d'unicité.
 */
export function cleSemaine(weekStart: Date): string {
  const jeudi = addDays(weekStart, 3);
  const debutAnnee = new Date(Date.UTC(jeudi.getUTCFullYear(), 0, 1));
  const numero = Math.ceil(((jeudi.getTime() - debutAnnee.getTime()) / 86400000 + 1) / 7);
  return `${jeudi.getUTCFullYear()}-W${String(numero).padStart(2, "0")}`;
}

/* ------------------------------------------------------------------ */
/* Désabonnement                                                       */
/* ------------------------------------------------------------------ */

/**
 * Jeton de désabonnement, dérivé de l'identifiant du compte et du secret du
 * serveur. Il n'est pas stocké : il se recalcule, reste valable indéfiniment et
 * permet de se désabonner sans se connecter — ce que la loi impose et ce qui
 * évite les signalements en indésirable.
 */
export function unsubscribeToken(userId: string): string {
  return crypto.createHmac("sha256", env().JWT_SECRET).update(`rappels:${userId}`).digest("hex").slice(0, 32);
}

export function verifyUnsubscribeToken(userId: string, token: string): boolean {
  const attendu = Buffer.from(unsubscribeToken(userId));
  const recu = Buffer.from(token ?? "");
  return attendu.length === recu.length && crypto.timingSafeEqual(attendu, recu);
}

export function unsubscribeUrl(userId: string): string {
  const base = env().APP_URL.replace(/\/$/, "");
  return `${base}/desabonnement?u=${encodeURIComponent(userId)}&t=${unsubscribeToken(userId)}`;
}

/* ------------------------------------------------------------------ */
/* Messages                                                            */
/* ------------------------------------------------------------------ */

function piedDePage(userId: string): string[] {
  return [
    "",
    "—",
    "Vous recevez ce message parce que les rappels sont activés sur votre compte TriCoach.",
    `Ne plus en recevoir : ${unsubscribeUrl(userId)}`,
  ];
}

function mail(user: { id: string; email: string }, subject: string, corps: string[]): Mail {
  return {
    to: user.email,
    subject,
    text: [...corps, ...piedDePage(user.id)].join("\n"),
    headers: {
      "List-Unsubscribe": `<${unsubscribeUrl(user.id)}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  };
}

interface Destinataire {
  id: string;
  email: string;
  name: string;
}

export function mailSemaineAGenerer(user: Destinataire): Mail {
  const lien = env().APP_URL.replace(/\/$/, "");
  return mail(user, "Votre semaine d'entraînement vous attend", [
    `Bonjour ${user.name},`,
    "",
    "Votre semaine se termine. Votre coach peut construire la suivante à partir de ce que vous avez réellement fait : les séances validées, celles manquées, et votre ressenti.",
    "",
    `Générer ma semaine : ${lien}`,
    "",
    "Bon entraînement.",
  ]);
}

export function mailSeancesOubliees(user: Destinataire, nombre: number): Mail {
  const lien = env().APP_URL.replace(/\/$/, "");
  return mail(user, "Quelques séances attendent votre retour", [
    `Bonjour ${user.name},`,
    "",
    `${nombre} séance${nombre > 1 ? "s" : ""} de cette semaine ${nombre > 1 ? "n'ont" : "n'a"} pas encore de réponse. Dites simplement si vous ${nombre > 1 ? "les" : "l'"}avez faite${nombre > 1 ? "s" : ""} ou non : c'est à partir de là que votre coach ajuste la charge de la semaine suivante.`,
    "",
    "Une séance manquée n'est pas un problème — l'ignorer en est un, car le programme continuerait comme si elle avait été faite.",
    "",
    `Mettre à jour ma semaine : ${lien}`,
  ]);
}

export function mailFinEssai(user: Destinataire, joursRestants: number): Mail {
  const lien = env().APP_URL.replace(/\/$/, "");
  const quand = joursRestants <= 1 ? "demain" : `dans ${joursRestants} jours`;
  return mail(user, `Votre essai TriCoach se termine ${quand}`, [
    `Bonjour ${user.name},`,
    "",
    `Votre période d'essai se termine ${quand}. Vos programmes, vos séances et vos zones restent enregistrés : rien n'est perdu.`,
    "",
    "Pour continuer à recevoir un programme chaque semaine, activez votre abonnement depuis l'application.",
    "",
    `Mon compte : ${lien}/compte`,
  ]);
}

/* ------------------------------------------------------------------ */
/* Sélection et envoi                                                  */
/* ------------------------------------------------------------------ */

export interface RappelDu {
  user: Destinataire;
  kind: ReminderKind;
  periode: string;
  mail: Mail;
}

/**
 * Détermine ce qu'il y a à envoyer à un athlète donné, à cet instant. Un seul
 * rappel à la fois : recevoir trois e-mails le même soir est le meilleur moyen
 * de faire fuir quelqu'un.
 */
export async function rappelPourAthlete(
  user: {
    id: string;
    email: string;
    name: string;
    plan: string;
    timezone: string;
    createdAt: Date;
  },
  now: Date
): Promise<RappelDu | null> {
  const tz = safeTimeZone(user.timezone);
  if (heureLocale(now, tz) < HEURE_ENVOI) return null;

  const destinataire = { id: user.id, email: user.email, name: user.name };

  // L'état de l'essai est calculé sur l'instant reçu, jamais sur l'horloge :
  // le résultat de cette fonction ne doit dépendre que de ses arguments.
  const finEssai = trialEndsAt(user.createdAt);
  const essaiActif = now < finEssai;
  const accesComplet = user.plan !== "free" || essaiActif;

  // 1. Fin d'essai : c'est la seule échéance que l'athlète ne peut pas voir
  // venir, et la seule qui lui coûte quelque chose s'il la manque.
  if (user.plan === "free" && essaiActif) {
    const fin = finEssai;
    const joursRestants = Math.ceil((fin.getTime() - now.getTime()) / 86400000);
    if (joursRestants >= 1 && joursRestants <= 3) {
      return {
        user: destinataire,
        kind: "fin_essai",
        periode: localCalendarDate(fin, tz),
        mail: mailFinEssai(destinataire, joursRestants),
      };
    }
  }

  if (!accesComplet) return null;

  const debutSemaine = startOfWeek(now, tz);

  // 2. Dimanche soir : la semaine se termine, la suivante est à construire.
  if (jourLocal(now, tz) === 7) {
    const semaineSuivante = addDays(debutSemaine, 7);
    const dejaGeneree = await prisma.trainingPlan.findFirst({
      where: { userId: user.id, weekStart: semaineSuivante },
      select: { id: true },
    });
    if (!dejaGeneree) {
      return {
        user: destinataire,
        kind: "semaine_a_generer",
        periode: cleSemaine(semaineSuivante),
        mail: mailSemaineAGenerer(destinataire),
      };
    }
  }

  // 3. Séances passées restées sans réponse. Au plus une fois par semaine.
  const aujourdHui = new Date(`${localCalendarDate(now, tz)}T00:00:00.000Z`);
  const enAttente = await prisma.session.count({
    where: {
      userId: user.id,
      status: "planifiee",
      sport: { not: "repos" },
      date: { gte: debutSemaine, lt: aujourdHui },
    },
  });
  if (enAttente >= 2) {
    return {
      user: destinataire,
      kind: "seances_oubliees",
      periode: cleSemaine(debutSemaine),
      mail: mailSeancesOubliees(destinataire, enAttente),
    };
  }

  return null;
}

export interface BilanRappels {
  examines: number;
  envoyes: number;
  parType: Record<string, number>;
}

/**
 * Passe en revue les comptes éligibles et envoie ce qui est dû.
 *
 * L'enregistrement précède l'envoi : si la contrainte d'unicité refuse
 * l'insertion, c'est qu'un autre passage — ou une autre instance — a déjà
 * traité ce rappel, et rien ne part. Mieux vaut un rappel perdu qu'un doublon.
 */
export async function runReminders(now: Date = new Date()): Promise<BilanRappels> {
  const bilan: BilanRappels = { examines: 0, envoyes: 0, parType: {} };
  if (!isMailConfigured()) return bilan;

  const candidats = await prisma.user.findMany({
    where: {
      rappelsEmail: true,
      // Ne jamais relancer une adresse non confirmée : elle peut appartenir à
      // quelqu'un d'autre, qui n'a rien demandé.
      emailVerifiedAt: { not: null },
      profile: { isNot: null },
    },
    select: { id: true, email: true, name: true, plan: true, timezone: true, createdAt: true },
    take: 2000,
  });

  for (const user of candidats) {
    bilan.examines += 1;
    let rappel: RappelDu | null = null;
    try {
      rappel = await rappelPourAthlete(user, now);
    } catch (erreur) {
      console.error(`[rappels] analyse impossible pour ${user.id}`, erreur);
      continue;
    }
    if (!rappel) continue;

    try {
      await prisma.reminder.create({
        data: { userId: user.id, kind: rappel.kind, periode: rappel.periode },
      });
    } catch {
      continue; // Déjà envoyé.
    }

    try {
      await sendMail(rappel.mail);
      bilan.envoyes += 1;
      bilan.parType[rappel.kind] = (bilan.parType[rappel.kind] ?? 0) + 1;
    } catch (erreur) {
      console.error(`[rappels] envoi échoué pour ${user.id}`, erreur);
      // La trace est retirée pour que le prochain passage retente : un rappel
      // non parti ne doit pas être compté comme envoyé.
      await prisma.reminder
        .deleteMany({ where: { userId: user.id, kind: rappel.kind, periode: rappel.periode } })
        .catch(() => undefined);
    }
  }

  return bilan;
}

/** Intervalle du passage automatique. */
export const INTERVALLE_RAPPELS_MS = 60 * 60 * 1000;

let minuterie: NodeJS.Timeout | null = null;

/**
 * Démarre le passage horaire. Il est lancé depuis le point d'entrée du serveur
 * et non depuis `createApp`, pour qu'aucun test d'intégration ne déclenche
 * d'envoi.
 */
export function startReminderScheduler(): void {
  if (minuterie || !isMailConfigured()) return;
  minuterie = setInterval(() => {
    runReminders().catch((erreur) => console.error("[rappels] passage échoué", erreur));
  }, INTERVALLE_RAPPELS_MS);
  minuterie.unref();
  console.log("[rappels] passage automatique toutes les heures");
}

export function stopReminderScheduler(): void {
  if (minuterie) clearInterval(minuterie);
  minuterie = null;
}
