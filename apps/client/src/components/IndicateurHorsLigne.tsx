import { useEffect, useState } from "react";
import { FaWifi } from "react-icons/fa6";

/**
 * Bandeau affiché quand le réseau manque. Sans lui, l'athlète croirait que
 * l'application est cassée alors qu'elle lui montre simplement la dernière
 * version connue de son programme.
 */
export function IndicateurHorsLigne() {
  const [horsLigne, setHorsLigne] = useState(() => !navigator.onLine);

  useEffect(() => {
    const enLigne = () => setHorsLigne(false);
    const perdu = () => setHorsLigne(true);
    window.addEventListener("online", enLigne);
    window.addEventListener("offline", perdu);
    return () => {
      window.removeEventListener("online", enLigne);
      window.removeEventListener("offline", perdu);
    };
  }, []);

  if (!horsLigne) return null;

  return (
    <div
      role="status"
      className="fixed inset-x-0 top-0 z-50 flex items-center justify-center gap-2 bg-amber-900/90 px-3 py-1.5 text-xs font-medium text-amber-100 backdrop-blur"
      style={{ paddingTop: "calc(0.375rem + env(safe-area-inset-top, 0px))" }}
    >
      <FaWifi size={11} />
      Hors ligne — vous consultez la dernière version enregistrée.
    </div>
  );
}
