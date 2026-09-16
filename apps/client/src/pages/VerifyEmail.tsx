import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, apiErrorMessage } from "../lib/api";
import { useAuth } from "../lib/AuthContext";
import { Spinner } from "../components/Spinner";

export function VerifyEmail() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const [state, setState] = useState<"encours" | "ok" | "erreur">("encours");
  const [error, setError] = useState<string | null>(null);
  const { refresh } = useAuth();
  const done = useRef(false);

  useEffect(() => {
    if (done.current) return;
    done.current = true;

    if (!token) {
      setState("erreur");
      setError("Ce lien de confirmation est incomplet.");
      return;
    }

    api
      .post("/privacy/verify-email", { token })
      .then(async () => {
        setState("ok");
        await refresh();
      })
      .catch((err) => {
        setState("erreur");
        setError(apiErrorMessage(err, "Ce lien de confirmation est invalide ou expiré."));
      });
  }, [token, refresh]);

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="animate-fade-in-up w-full max-w-sm space-y-4 rounded-2xl border border-bordure bg-zinc-950/80 p-6 text-center shadow-2xl shadow-black/50">
        {state === "encours" && (
          <>
            <Spinner />
            <p className="text-sm text-doux">Confirmation en cours…</p>
          </>
        )}

        {state === "ok" && (
          <>
            <p className="text-3xl">✅</p>
            <h1 className="text-lg font-bold text-white">Adresse confirmée</h1>
            <p className="text-sm text-doux">Votre compte est sécurisé, vous pouvez récupérer votre mot de passe.</p>
            <Link
              to="/dashboard"
              className="block rounded-lg bg-rose-500 px-3 py-2.5 text-sm font-semibold text-black transition-colors hover:bg-rose-400"
            >
              Aller à mon programme
            </Link>
          </>
        )}

        {state === "erreur" && (
          <>
            <p className="text-3xl">⚠️</p>
            <h1 className="text-lg font-bold text-white">Confirmation impossible</h1>
            <p className="text-sm text-doux">{error}</p>
            <Link
              to="/compte"
              className="block rounded-lg bg-rose-500 px-3 py-2.5 text-sm font-semibold text-black transition-colors hover:bg-rose-400"
            >
              Demander un nouveau lien
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
