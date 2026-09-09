import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api, apiErrorMessage } from "../lib/api";
import { Spinner } from "../components/Spinner";

/** Page de retour après autorisation chez Strava. */
export function StravaReturn() {
  const [searchParams] = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const done = useRef(false);

  useEffect(() => {
    if (done.current) return;
    done.current = true;

    const code = searchParams.get("code");
    const state = searchParams.get("state");

    // L'athlète peut refuser l'autorisation : ce n'est pas une erreur.
    if (searchParams.get("error") || !code || !state) {
      navigate("/compte", { replace: true });
      return;
    }

    api
      .post("/strava/callback", { code, state })
      .then(() => navigate("/compte?strava=ok", { replace: true }))
      .catch((err) => setError(apiErrorMessage(err, "La connexion à Strava a échoué.")));
  }, [searchParams, navigate]);

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-3 rounded-2xl border border-zinc-800 bg-zinc-950/80 p-6 text-center">
        {error ? (
          <>
            <p className="text-3xl">⚠️</p>
            <p className="text-sm text-zinc-400">{error}</p>
            <button
              onClick={() => navigate("/compte", { replace: true })}
              className="w-full rounded-lg bg-rose-500 px-3 py-2.5 text-sm font-semibold text-black hover:bg-rose-400"
            >
              Retour à mon compte
            </button>
          </>
        ) : (
          <>
            <Spinner />
            <p className="text-sm text-zinc-400">Connexion à Strava…</p>
          </>
        )}
      </div>
    </div>
  );
}
