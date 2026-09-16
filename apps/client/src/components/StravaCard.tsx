import { useCallback, useEffect, useState } from "react";
import { useConfirmation } from "../ui/Confirmation";
import { api, apiErrorMessage, type StravaStatus } from "../lib/api";
import { Spinner } from "./Spinner";

/**
 * Connexion et import Strava. Le bloc ne s'affiche pas du tout si
 * l'application n'a pas d'identifiants Strava : mieux vaut rien qu'une
 * fonctionnalité qui échoue.
 */
export function StravaCard() {
  const [status, setStatus] = useState<StravaStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { demander } = useConfirmation();

  const charger = useCallback(async () => {
    try {
      const { data } = await api.get<StravaStatus>("/strava/status");
      setStatus(data);
    } catch {
      setStatus(null);
    }
  }, []);

  useEffect(() => {
    charger();
  }, [charger]);

  async function connecter() {
    setBusy("connect");
    setError(null);
    try {
      const { data } = await api.post<{ url: string }>("/strava/connect");
      window.location.href = data.url;
    } catch (err) {
      setError(apiErrorMessage(err, "Impossible de démarrer la connexion Strava."));
      setBusy(null);
    }
  }

  async function importer() {
    setBusy("sync");
    setError(null);
    setMessage(null);
    try {
      const { data } = await api.post<{ importees: number; rapprochees: number }>("/strava/sync");
      setMessage(
        data.importees === 0
          ? "Aucune nouvelle activité à importer."
          : `${data.importees} activité(s) importée(s), dont ${data.rapprochees} rattachée(s) à une séance prévue.`
      );
      await charger();
    } catch (err) {
      setError(apiErrorMessage(err, "L'import a échoué."));
    } finally {
      setBusy(null);
    }
  }

  async function delier() {
    const { confirme } = await demander({
      titre: "Délier votre compte Strava ?",
      description: "Les activités déjà importées sont conservées. Vous pourrez relier le compte à tout moment.",
      confirmer: "Délier",
      variante: "danger",
    });
    if (!confirme) return;
    setBusy("unlink");
    try {
      await api.delete("/strava");
      await charger();
    } catch (err) {
      setError(apiErrorMessage(err, "Impossible de délier le compte."));
    } finally {
      setBusy(null);
    }
  }

  if (!status?.disponible) return null;

  return (
    <div className="rounded-2xl border border-bordure bg-zinc-950/80 p-4">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-sm">🔗</span>
        <h2 className="text-sm font-bold text-white">Strava</h2>
      </div>

      {!status.relie ? (
        <>
          <p className="mb-3 text-sm text-doux">
            Reliez votre montre pour que votre coach travaille sur vos allures réelles, et non sur ce que vous
            déclarez. Vos séances se valident alors toutes seules.
          </p>
          <button
            onClick={connecter}
            disabled={busy !== null}
            className="flex items-center justify-center gap-2 rounded-lg bg-[#fc4c02] px-3 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {busy === "connect" && <Spinner className="border-white/30 border-t-white" />}
            Connecter mon compte Strava
          </button>
        </>
      ) : (
        <>
          <p className="text-sm text-zinc-300">
            Relié{status.athleteName ? ` au compte ${status.athleteName}` : ""}.
          </p>
          <p className="mt-0.5 text-xs text-doux">
            {status.activitesImportees} activité(s) importée(s)
            {status.lastSyncAt && ` · dernier import le ${new Date(status.lastSyncAt).toLocaleDateString("fr-FR")}`}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              onClick={importer}
              disabled={busy !== null}
              className="flex items-center gap-2 rounded-lg bg-rose-500 px-3 py-2 text-sm font-semibold text-black transition-colors hover:bg-rose-400 disabled:opacity-50"
            >
              {busy === "sync" && <Spinner className="border-black/30 border-t-black" />}
              Importer mes activités
            </button>
            <button
              onClick={delier}
              disabled={busy !== null}
              className="rounded-lg border border-bordure px-3 py-2 text-sm text-doux transition-colors hover:border-bordure-forte hover:text-zinc-200 disabled:opacity-50"
            >
              Délier
            </button>
          </div>
        </>
      )}

      {message && (
        <p className="mt-2 rounded-md border border-emerald-900 bg-emerald-950/40 px-2.5 py-1.5 text-xs text-emerald-300">
          {message}
        </p>
      )}
      {error && (
        <p className="mt-2 rounded-md border border-red-900 bg-red-950/40 px-2.5 py-1.5 text-xs text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
