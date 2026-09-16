import webpush from "web-push";
import { prisma } from "./prisma.js";
import { env } from "./env.js";

/**
 * Notifications poussées.
 *
 * L'e-mail dépend d'un prestataire d'envoi, de la délivrabilité, et arrive
 * quand la personne relève sa boîte. Une notification arrive sur l'écran, tout
 * de suite, sans intermédiaire — et depuis iOS 16.4 elle fonctionne aussi sur
 * iPhone, à condition que l'application soit installée sur l'écran d'accueil.
 */

let configure = false;

export function isPushConfigured(): boolean {
  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY } = env();
  return Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);
}

export function publicVapidKey(): string {
  return env().VAPID_PUBLIC_KEY;
}

function prepare(): void {
  if (configure) return;
  const config = env();
  webpush.setVapidDetails(
    // Les spécifications imposent un contact : une adresse à laquelle le
    // service de notification peut écrire si nos envois posent problème.
    config.VAPID_SUBJECT || `mailto:${config.MAIL_FROM.replace(/.*<|>.*/g, "") || "contact@tricoach.app"}`,
    config.VAPID_PUBLIC_KEY,
    config.VAPID_PRIVATE_KEY
  );
  configure = true;
}

export interface NotificationPoussee {
  titre: string;
  corps: string;
  /** Chemin ouvert au clic, relatif à l'application. */
  url?: string;
  /** Regroupe les notifications d'une même nature au lieu de les empiler. */
  tag?: string;
}

export interface BilanPush {
  envoyees: number;
  appareilsRetires: number;
}

/**
 * Envoie une notification à tous les appareils d'un athlète.
 *
 * Un point de terminaison refusé définitivement (404 ou 410) désigne un
 * appareil qui n'existe plus : on le supprime, sans quoi chaque envoi futur
 * échouerait sur lui indéfiniment.
 */
export async function notifier(userId: string, notification: NotificationPoussee): Promise<BilanPush> {
  const bilan: BilanPush = { envoyees: 0, appareilsRetires: 0 };
  if (!isPushConfigured()) return bilan;

  prepare();

  const abonnements = await prisma.pushSubscription.findMany({ where: { userId }, take: 20 });
  if (abonnements.length === 0) return bilan;

  const charge = JSON.stringify({
    titre: notification.titre,
    corps: notification.corps,
    url: notification.url ?? "/",
    tag: notification.tag ?? "tricoach",
  });

  for (const abonnement of abonnements) {
    try {
      await webpush.sendNotification(
        {
          endpoint: abonnement.endpoint,
          keys: { p256dh: abonnement.p256dh, auth: abonnement.auth },
        },
        charge
      );
      bilan.envoyees += 1;
      await prisma.pushSubscription
        .update({ where: { id: abonnement.id }, data: { lastSeenAt: new Date() } })
        .catch(() => undefined);
    } catch (erreur) {
      const statut = (erreur as { statusCode?: number }).statusCode;
      if (statut === 404 || statut === 410) {
        await prisma.pushSubscription.delete({ where: { id: abonnement.id } }).catch(() => undefined);
        bilan.appareilsRetires += 1;
      } else {
        console.error(`[push] envoi impossible vers ${abonnement.id}`, erreur);
      }
    }
  }

  return bilan;
}

/** Un athlète a-t-il au moins un appareil abonné ? */
export async function aUnAppareil(userId: string): Promise<boolean> {
  return (await prisma.pushSubscription.count({ where: { userId } })) > 0;
}
