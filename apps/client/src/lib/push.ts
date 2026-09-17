import { api } from "./api";

/**
 * Activation des notifications côté navigateur.
 *
 * Sur iPhone, rien ne fonctionne tant que l'application n'a pas été ajoutée à
 * l'écran d'accueil : la demande d'autorisation est simplement refusée. Il faut
 * donc le dire à l'athlète plutôt que de le laisser cliquer sans effet.
 */

/** Une clé VAPID circule en base64url ; l'API du navigateur attend des octets. */
function base64UrlVersOctets(base64: string): Uint8Array<ArrayBuffer> {
  const complet = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const binaire = atob(complet);
  // Tampon explicite : le type par défaut de Uint8Array autorise un
  // SharedArrayBuffer, que l'API d'abonnement refuse.
  const octets = new Uint8Array(new ArrayBuffer(binaire.length));
  for (let i = 0; i < binaire.length; i += 1) octets[i] = binaire.charCodeAt(i);
  return octets;
}

export function pushSupporte(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

export type EtatPush = "indisponible" | "installation_requise" | "refuse" | "inactif" | "actif";

/** Détermine où en est cet appareil, sans rien demander à l'athlète. */
export async function etatPush(): Promise<EtatPush> {
  if (!pushSupporte()) {
    // Safari iOS n'expose l'API que dans une application installée : l'absence
    // de support sur un iPhone signifie presque toujours « pas encore ajoutée
    // à l'écran d'accueil ».
    const iOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    return iOS ? "installation_requise" : "indisponible";
  }
  if (Notification.permission === "denied") return "refuse";

  const registration = await navigator.serviceWorker.getRegistration();
  const abonnement = await registration?.pushManager.getSubscription();
  return abonnement ? "actif" : "inactif";
}

export interface CleServeur {
  disponible: boolean;
  clePublique: string;
}

/**
 * Demande l'autorisation, crée l'abonnement et l'enregistre côté serveur.
 * Renvoie l'état obtenu, pour que l'interface dise ce qui s'est passé.
 */
export async function activerPush(): Promise<EtatPush> {
  if (!pushSupporte()) return etatPush();

  const { data } = await api.get<CleServeur>("/push/cle");
  if (!data.disponible || !data.clePublique) return "indisponible";

  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission === "denied" ? "refuse" : "inactif";

  const registration = await navigator.serviceWorker.ready;
  const abonnement =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({
      // Sans cette option, Chrome refuse : il exige que chaque message poussé
      // se traduise par une notification visible.
      userVisibleOnly: true,
      applicationServerKey: base64UrlVersOctets(data.clePublique),
    }));

  const json = abonnement.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
  await api.post("/push/abonnements", { endpoint: json.endpoint, keys: json.keys });
  return "actif";
}

/** Désactive les notifications sur cet appareil uniquement. */
export async function desactiverPush(): Promise<void> {
  const registration = await navigator.serviceWorker.getRegistration();
  const abonnement = await registration?.pushManager.getSubscription();
  if (!abonnement) return;

  const endpoint = abonnement.endpoint;
  await abonnement.unsubscribe();
  await api.delete("/push/abonnements", { data: { endpoint } }).catch(() => undefined);
}
