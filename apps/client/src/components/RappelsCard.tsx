import { useState } from "react";
import { FaBell } from "react-icons/fa6";
import { api, apiErrorMessage } from "../lib/api";
import { useAuth } from "../lib/AuthContext";

/**
 * Réglage des rappels. Un athlète qui ne revient pas ne s'entraîne pas : ces
 * messages sont ce qui ramène, mais ils doivent rester coupables d'un geste,
 * sans quoi ils deviennent du courrier indésirable.
 */
export function RappelsCard() {
  const { user, refresh } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!user) return null;
  const actif = user.rappelsEmail;

  async function basculer() {
    setBusy(true);
    setError(null);
    try {
      await api.patch("/privacy/rappels", { rappelsEmail: !actif });
      await refresh();
    } catch (err) {
      setError(apiErrorMessage(err, "Enregistrement impossible."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/80 p-4">
      <div className="mb-2 flex items-center gap-2">
        <FaBell className="text-zinc-400" size={13} />
        <h2 className="text-sm font-bold text-white">Rappels par e-mail</h2>
      </div>
      <p className="mb-3 text-sm text-zinc-400">
        Le dimanche soir quand votre semaine est à générer, et lorsque des séances passées attendent encore votre
        réponse. Jamais plus d'un message par soir.
      </p>

      {error && <p className="mb-2 text-sm text-red-400">{error}</p>}

      <button
        onClick={() => void basculer()}
        disabled={busy}
        aria-pressed={actif}
        className={`flex w-full items-center justify-between rounded-lg border px-3 py-2.5 text-sm transition-colors disabled:opacity-50 ${
          actif
            ? "border-rose-900/50 bg-rose-950/20 text-rose-200 hover:border-rose-700"
            : "border-zinc-800 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200"
        }`}
      >
        <span>{actif ? "Rappels activés" : "Rappels désactivés"}</span>
        <span
          className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${actif ? "bg-rose-600" : "bg-zinc-700"}`}
        >
          <span
            className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${actif ? "left-[1.125rem]" : "left-0.5"}`}
          />
        </span>
      </button>
    </div>
  );
}
