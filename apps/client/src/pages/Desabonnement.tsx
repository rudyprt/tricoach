import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { FaBellSlash, FaCircleCheck, FaTriangleExclamation } from "react-icons/fa6";
import { api, apiErrorMessage } from "../lib/api";

/**
 * Désabonnement en un clic depuis un e-mail, sans connexion. C'est une
 * obligation légale, et la meilleure protection contre les signalements en
 * courrier indésirable — qui abîmeraient la délivrabilité de tous les messages
 * du service, y compris la réinitialisation de mot de passe.
 */
export function Desabonnement() {
  const [params] = useSearchParams();
  const [etat, setEtat] = useState<"en_cours" | "fait" | "erreur">("en_cours");
  const [message, setMessage] = useState<string | null>(null);

  const userId = params.get("u");
  const token = params.get("t");

  useEffect(() => {
    if (!userId || !token) {
      setEtat("erreur");
      setMessage("Ce lien de désabonnement est incomplet.");
      return;
    }
    api
      .post("/privacy/rappels/desabonner", { userId, token })
      .then(() => setEtat("fait"))
      .catch((err) => {
        setEtat("erreur");
        setMessage(apiErrorMessage(err, "Ce lien de désabonnement n'est pas valide."));
      });
  }, [userId, token]);

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-2xl border border-zinc-800 bg-zinc-950/80 p-6 text-center">
        {etat === "en_cours" && (
          <>
            <FaBellSlash className="mx-auto mb-3 text-zinc-500" size={22} />
            <p className="text-sm text-zinc-400">Désabonnement en cours…</p>
          </>
        )}

        {etat === "fait" && (
          <>
            <FaCircleCheck className="mx-auto mb-3 text-emerald-500" size={22} />
            <h1 className="text-base font-bold text-white">Rappels désactivés</h1>
            <p className="mt-2 text-sm text-zinc-400">
              Vous ne recevrez plus de rappels d'entraînement. Les messages liés à votre compte — confirmation
              d'adresse, mot de passe oublié — continuent de vous parvenir.
            </p>
            <p className="mt-2 text-xs text-zinc-500">
              Vous pouvez les réactiver à tout moment depuis votre compte.
            </p>
          </>
        )}

        {etat === "erreur" && (
          <>
            <FaTriangleExclamation className="mx-auto mb-3 text-amber-500" size={22} />
            <h1 className="text-base font-bold text-white">Désabonnement impossible</h1>
            <p className="mt-2 text-sm text-zinc-400">{message}</p>
            <p className="mt-2 text-xs text-zinc-500">
              Vous pouvez aussi couper les rappels depuis la page Compte, une fois connecté.
            </p>
          </>
        )}

        <Link
          to="/"
          className="mt-4 inline-block rounded-lg border border-zinc-800 px-4 py-2 text-sm text-zinc-300 transition-colors hover:border-rose-800 hover:text-white"
        >
          Retour à l'application
        </Link>
      </div>
    </div>
  );
}
