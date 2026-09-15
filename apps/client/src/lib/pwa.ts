/**
 * Installation et fonctionnement hors ligne.
 *
 * Le service worker n'est enregistré qu'en production : en développement, Vite
 * sert des modules non hachés que le cache figerait, et l'on passerait ses
 * journées à vider le cache du navigateur.
 */

export function registerServiceWorker(): void {
  if (!("serviceWorker" in navigator)) return;
  if (!import.meta.env.PROD) return;

  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((erreur) => {
      // Un échec d'enregistrement ne doit jamais empêcher l'application de
      // fonctionner : elle marche simplement sans mode hors ligne.
      console.warn("[pwa] service worker non enregistré", erreur);
    });
  });
}

/** Efface les données mises en cache. Appelé à la déconnexion. */
export function purgerCacheHorsLigne(): void {
  navigator.serviceWorker?.controller?.postMessage("purge-donnees");
}

/** iOS n'expose pas d'invite d'installation : il faut décrire le geste. */
export function estIOS(): boolean {
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(ua));
}

export function estDejaInstallee(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    // Safari iOS expose son propre indicateur, hors standard.
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/** Événement Chromium, absent des types du DOM. */
export interface InvitePromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}
