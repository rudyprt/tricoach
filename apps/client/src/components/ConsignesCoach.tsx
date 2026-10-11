import { useEffect, useState } from "react";
import { FaThumbtack, FaXmark } from "react-icons/fa6";
import { api, apiErrorMessage, type ConsigneCoach } from "../lib/api";

/**
 * Ce que le coach a retenu de la conversation pour construire les semaines.
 *
 * Une demande comprise de travers serait appliquée chaque semaine : l'athlète
 * doit la voir, et pouvoir l'effacer d'un geste.
 */
export function ConsignesCoach({ version }: { version: number }) {
  const [consignes, setConsignes] = useState<ConsigneCoach[]>([]);
  const [ouvert, setOuvert] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<{ consignes: ConsigneCoach[] }>("/consignes")
      .then(({ data }) => setConsignes(data.consignes))
      .catch(() => undefined);
  }, [version]);

  if (consignes.length === 0) return null;

  async function retirer(id: string) {
    setErreur(null);
    try {
      await api.delete(`/consignes/${id}`);
      setConsignes((avant) => avant.filter((c) => c.id !== id));
    } catch (err) {
      setErreur(apiErrorMessage(err, "Impossible de retirer cette consigne."));
    }
  }

  return (
    <div className="mb-3 rounded-2xl border border-bordure bg-surface px-3.5 py-2.5">
      <button
        onClick={() => setOuvert((v) => !v)}
        aria-expanded={ouvert}
        className="flex w-full items-center justify-between gap-2 text-left text-sm font-semibold text-fort"
      >
        <span className="flex items-center gap-2">
          <FaThumbtack className="text-accent" size={12} aria-hidden="true" />
          Ce que votre coach a retenu ({consignes.length})
        </span>
        <span className="text-xs text-doux">{ouvert ? "Masquer" : "Voir"}</span>
      </button>
      {ouvert && (
        <>
          <p className="mt-1.5 text-xs text-doux">Appliqué à chaque nouvelle semaine générée.</p>
          <ul className="mt-2 space-y-1.5">
            {consignes.map((c) => (
              <li key={c.id} className="flex items-start justify-between gap-2 rounded-lg bg-zinc-900 px-2.5 py-2 text-sm text-zinc-200">
                <span>
                  {c.texte}
                  {c.jusquAu && (
                    <span className="block text-xs text-doux">
                      jusqu'au {new Date(`${c.jusquAu}T12:00:00`).toLocaleDateString("fr-FR", { day: "numeric", month: "long" })}
                    </span>
                  )}
                </span>
                <button
                  onClick={() => retirer(c.id)}
                  aria-label={`Retirer la consigne : ${c.texte}`}
                  className="shrink-0 rounded-full p-1 text-doux hover:text-fort"
                >
                  <FaXmark size={13} />
                </button>
              </li>
            ))}
          </ul>
          {erreur && <p className="mt-1.5 text-xs text-red-400">{erreur}</p>}
        </>
      )}
    </div>
  );
}
