import { useEffect, useState } from "react";
import { FaArrowsRotate } from "react-icons/fa6";

/**
 * Bascule vers la version déployée.
 *
 * La nouvelle version attendait qu'on la réclame. Sur une application
 * installée, jamais vraiment fermée, elle pouvait attendre des jours : un
 * correctif poussé restait invisible sans que rien ne le dise.
 *
 * Elle s'installe donc d'elle-même dès qu'il n'y a rien à perdre — et rien
 * seulement : remplacer le code sous les pieds de quelqu'un en pleine saisie
 * ou en pleine séance lui ferait perdre ce qu'il fait. Dans ces cas-là, elle
 * patiente et se propose, comme avant.
 */

/** Y a-t-il quelque chose qu'un rechargement ferait perdre ? */
function rechargementRisque(): boolean {
  // Une séance guidée en cours : le chronomètre et le bloc atteint ne
  // survivraient pas au rechargement.
  if (document.querySelector('[data-plein-ecran="seance"]')) return true;
  // Une boîte de dialogue ouverte : l'athlète est au milieu d'une décision.
  if (document.querySelector('[role="dialog"]')) return true;

  const actif = document.activeElement;
  if (!(actif instanceof HTMLElement)) return false;
  if (actif.isContentEditable) return true;
  // Un champ vide n'a rien à perdre ; un champ commencé, si.
  if (actif instanceof HTMLTextAreaElement) return actif.value.trim().length > 0;
  if (actif instanceof HTMLInputElement) {
    const saisissable = ["text", "email", "password", "search", "tel", "url", "number", ""];
    return saisissable.includes(actif.type) && actif.value.trim().length > 0;
  }
  return false;
}
export function NouvelleVersion() {
  const [enAttente, setEnAttente] = useState<ServiceWorker | null>(null);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    let annule = false;

    navigator.serviceWorker.getRegistration().then((registration) => {
      if (!registration || annule) return;

      if (registration.waiting) setEnAttente(registration.waiting);

      registration.addEventListener("updatefound", () => {
        const nouveau = registration.installing;
        if (!nouveau) return;
        nouveau.addEventListener("statechange", () => {
          // « installed » avec un contrôleur déjà en place signifie qu'une
          // version tourne et qu'une autre attend son tour.
          if (nouveau.state === "installed" && navigator.serviceWorker.controller) {
            setEnAttente(nouveau);
          }
        });
      });
    });

    // Une fois la bascule faite, le navigateur change de contrôleur : c'est le
    // moment de recharger, et une seule fois.
    let dejaRecharge = false;
    const surChangement = () => {
      if (dejaRecharge) return;
      dejaRecharge = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", surChangement);

    return () => {
      annule = true;
      navigator.serviceWorker.removeEventListener("controllerchange", surChangement);
    };
  }, []);

  /*
   * Dès qu'une version attend, on bascule sans rien demander — sauf si
   * quelque chose est en cours. On réessaie alors à chaque retour au premier
   * plan : c'est le moment où l'athlète n'est, le plus souvent, en train de
   * rien faire dans l'application.
   */
  useEffect(() => {
    if (!enAttente) return;

    const tenter = () => {
      if (document.visibilityState !== "visible") return;
      if (rechargementRisque()) return;
      enAttente.postMessage("activer-maintenant");
    };

    document.addEventListener("visibilitychange", tenter);
    const minuteur = window.setTimeout(tenter, 0);

    return () => {
      document.removeEventListener("visibilitychange", tenter);
      window.clearTimeout(minuteur);
    };
  }, [enAttente]);

  if (!enAttente) return null;

  return (
    <div
      role="status"
      className="fixed inset-x-0 z-[55] flex justify-center px-4"
      style={{ bottom: "calc(var(--marge-basse) + 4.75rem)" }}
    >
      <div className="flex w-full max-w-sm items-center gap-3 rounded-2xl border border-info/40 bg-surface-haute px-3.5 py-3 shadow-2xl shadow-black/60">
        <FaArrowsRotate className="shrink-0 text-info" size={15} aria-hidden="true" />
        <p className="min-w-0 flex-1 text-sm text-fort">Une nouvelle version est disponible.</p>
        <button
          onClick={() => enAttente.postMessage("activer-maintenant")}
          className="min-h-cible shrink-0 rounded-lg px-2.5 text-sm font-semibold text-info transition-colors hover:bg-white/10"
        >
          Recharger
        </button>
      </div>
    </div>
  );
}
