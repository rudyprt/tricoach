import { useEffect, useState } from "react";
import { FaArrowsRotate } from "react-icons/fa6";

/**
 * Invitation à recharger après un déploiement.
 *
 * Le service worker basculait tout seul : l'onglet ouvert gardait pourtant
 * l'ancien code, sans que rien ne le dise. Et remplacer le code sous les pieds
 * de quelqu'un en pleine saisie lui ferait perdre ce qu'il écrit. La nouvelle
 * version attend donc, et c'est l'athlète qui décide quand basculer.
 */
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
