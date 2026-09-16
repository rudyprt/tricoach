import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { FaPrint, FaTriangleExclamation } from "react-icons/fa6";
import { api, apiErrorMessage, type Session } from "../lib/api";
import { formatJourLong } from "../lib/formats";

interface SemainePartageeData {
  athlete: string;
  weekStart: string;
  expiresAt: string;
  sessions: Session[];
}

const SPORTS: Record<string, string> = {
  natation: "Natation",
  velo: "Vélo",
  course: "Course à pied",
  renfo: "Renforcement",
  repos: "Repos",
};

/**
 * Semaine consultée par quelqu'un qui n'a pas de compte : un coach humain, un
 * partenaire d'entraînement, un kiné. La page est volontairement austère et
 * imprimable — c'est ce qu'on glisse dans un sac ou qu'on commente ensemble.
 */
export function SemainePartagee() {
  const { token } = useParams<{ token: string }>();
  const [donnees, setDonnees] = useState<SemainePartageeData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<SemainePartageeData>(`/partage/${token}`)
      .then(({ data }) => setDonnees(data))
      .catch((err) => setError(apiErrorMessage(err, "Ce lien de partage n'existe pas ou a expiré.")));
  }, [token]);

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="max-w-sm rounded-2xl border border-zinc-800 bg-zinc-950/80 p-6 text-center">
          <FaTriangleExclamation className="mx-auto mb-3 text-amber-500" size={22} />
          <p className="text-sm text-zinc-400">{error}</p>
        </div>
      </div>
    );
  }

  if (!donnees) return null;

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 print:max-w-none print:px-0 print:py-0">
      <div className="mb-5 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-white print:text-black">Semaine de {donnees.athlete}</h1>
          <p className="text-sm text-zinc-400 print:text-zinc-700">
            Semaine du {formatJourLong(donnees.weekStart)}
          </p>
        </div>
        <button
          onClick={() => window.print()}
          className="flex shrink-0 items-center gap-1.5 rounded-full border border-zinc-800 px-3 py-1.5 text-xs text-zinc-300 transition-colors hover:border-rose-700 hover:text-white print:hidden"
        >
          <FaPrint size={11} />
          Imprimer
        </button>
      </div>

      <div className="space-y-2.5">
        {donnees.sessions.map((session) => (
          <article
            key={session.id}
            className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3.5 print:border-zinc-300 print:bg-white"
          >
            <div className="mb-1 flex flex-wrap items-baseline gap-x-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-rose-400 print:text-rose-700">
                {formatJourLong(session.date)}
              </span>
              <span className="text-xs text-zinc-500 print:text-zinc-600">
                {SPORTS[session.sport] ?? session.sport}
                {session.dureeMin > 0 && ` · ${session.dureeMin} min`}
                {session.distanceKm ? ` · ${session.distanceKm} km` : ""}
              </span>
            </div>

            <h2 className="text-sm font-bold text-white print:text-black">{session.titre}</h2>
            {session.description && (
              <p className="mt-1 text-sm text-zinc-400 print:text-zinc-700">{session.description}</p>
            )}
            {session.objectif && (
              <p className="mt-1 text-xs italic text-zinc-500 print:text-zinc-600">{session.objectif}</p>
            )}

            {session.structure && (
              <dl className="mt-2 space-y-1.5 border-t border-zinc-800 pt-2 print:border-zinc-300">
                {(["echauffement", "corps", "retourCalme"] as const).map((bloc) => {
                  const contenu = session.structure?.[bloc];
                  if (!contenu) return null;
                  return (
                    <div key={bloc} className="text-xs">
                      <dt className="font-semibold text-zinc-300 print:text-black">
                        {bloc === "echauffement" ? "Échauffement" : bloc === "corps" ? "Corps de séance" : "Retour au calme"}
                        {contenu.dureeMin ? ` — ${contenu.dureeMin} min` : ""}
                      </dt>
                      <dd className="text-zinc-400 print:text-zinc-700">
                        {contenu.cible && <span className="font-mono">{contenu.cible}. </span>}
                        {contenu.description}
                        {contenu.exercices && contenu.exercices.length > 0 && (
                          <ul className="mt-1 space-y-0.5">
                            {contenu.exercices.map((ex, i) => (
                              <li key={i}>
                                · {ex.repetitions} à {ex.allure}
                                {ex.recuperation ? ` (récup. ${ex.recuperation})` : ""}
                              </li>
                            ))}
                          </ul>
                        )}
                      </dd>
                    </div>
                  );
                })}
              </dl>
            )}
          </article>
        ))}
      </div>

      <p className="mt-6 text-center text-[11px] text-zinc-600 print:text-zinc-500">
        Programme établi par TriCoach IA · lien valable jusqu'au{" "}
        {new Date(donnees.expiresAt).toLocaleDateString("fr-FR")}
      </p>
    </div>
  );
}
