import { useState } from "react";
import { FaShareNodes, FaCopy, FaCheck, FaPrint } from "react-icons/fa6";
import { api, apiErrorMessage } from "../lib/api";

/**
 * Partage de la semaine en lecture seule, et impression.
 *
 * Un athlète veut montrer sa semaine à un coach humain, à un partenaire
 * d'entraînement ou à son kiné : la seule option jusqu'ici était la capture
 * d'écran. Le lien ne donne accès qu'aux séances de cette semaine, jamais au
 * compte, et expire.
 */
export function PartagerSemaine() {
  const [url, setUrl] = useState<string | null>(null);
  const [copie, setCopie] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function creer() {
    setBusy(true);
    setError(null);
    try {
      const { data } = await api.post<{ url: string; dureeJours: number }>("/partage");
      setUrl(data.url);

      // Le partage natif quand il existe : sur téléphone, c'est le geste
      // attendu, et il évite un copier-coller dans une autre application.
      if (navigator.share) {
        await navigator.share({ title: "Ma semaine d'entraînement", url: data.url }).catch(() => undefined);
      }
    } catch (err) {
      setError(apiErrorMessage(err, "Partage impossible."));
    } finally {
      setBusy(false);
    }
  }

  async function copier() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopie(true);
      setTimeout(() => setCopie(false), 2000);
    } catch {
      setError("Copie impossible. Sélectionnez le lien à la main.");
    }
  }

  async function revoquer() {
    setBusy(true);
    try {
      await api.delete("/partage");
      setUrl(null);
    } catch (err) {
      setError(apiErrorMessage(err, "Révocation impossible."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="print:hidden">
      {error && <p className="mb-2 text-sm text-red-400">{error}</p>}

      {url ? (
        <div className="rounded-2xl border border-bordure bg-zinc-950/80 p-3">
          <p className="mb-2 text-xs text-doux">
            Lien de consultation, valable 30 jours. Il ne donne accès qu'à cette semaine.
          </p>
          <div className="flex gap-2">
            <input
              readOnly
              value={url}
              onFocus={(e) => e.currentTarget.select()}
              className="min-w-0 flex-1 rounded-lg border border-bordure bg-zinc-900 px-2.5 py-2 font-mono text-xs text-zinc-300 outline-none"
            />
            <button
              onClick={() => void copier()}
              aria-label="Copier le lien"
              className="shrink-0 rounded-lg border border-bordure px-3 text-doux transition-colors hover:border-bordure-forte hover:text-zinc-200"
            >
              {copie ? <FaCheck size={12} className="text-emerald-400" /> : <FaCopy size={12} />}
            </button>
          </div>
          <button
            onClick={() => void revoquer()}
            disabled={busy}
            className="mt-2 text-xs text-doux transition-colors hover:text-red-400 disabled:opacity-50"
          >
            Désactiver ce lien
          </button>
        </div>
      ) : (
        <div className="flex gap-2">
          <button
            onClick={() => void creer()}
            disabled={busy}
            className="flex flex-1 items-center justify-center gap-2 rounded-2xl border border-dashed border-bordure px-3 py-2.5 text-sm text-doux transition-colors hover:border-rose-800/70 hover:text-zinc-200 disabled:opacity-50"
          >
            <FaShareNodes size={12} />
            Partager ma semaine
          </button>
          <button
            onClick={() => window.print()}
            aria-label="Imprimer ma semaine"
            className="rounded-2xl border border-dashed border-bordure px-3 py-2.5 text-doux transition-colors hover:border-rose-800/70 hover:text-zinc-200"
          >
            <FaPrint size={12} />
          </button>
        </div>
      )}
    </div>
  );
}
