import { useRef, useState } from "react";
import { api, apiErrorMessage } from "../lib/api";
import { Spinner } from "./Spinner";

interface ResultatFichier {
  fichier: string;
  statut: "importe" | "importe_et_rattache" | "deja_importe" | "ignore" | "erreur";
  detail?: string;
}

const LIBELLES: Record<ResultatFichier["statut"], string> = {
  importe: "Importée",
  importe_et_rattache: "Importée et séance validée",
  deja_importe: "Déjà importée",
  ignore: "Ignorée",
  erreur: "Erreur",
};

const COULEURS: Record<ResultatFichier["statut"], string> = {
  importe: "text-emerald-300",
  importe_et_rattache: "text-emerald-300",
  deja_importe: "text-doux",
  ignore: "text-amber-400",
  erreur: "text-red-400",
};

/**
 * Dépôt de fichiers exportés d'une montre. Voie sans service tiers : elle
 * fonctionne avec toutes les marques, sans abonnement ni autorisation.
 */
export function ImportSeances({ onImport }: { onImport?: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [envoi, setEnvoi] = useState(false);
  const [resultats, setResultats] = useState<ResultatFichier[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function envoyer(fichiers: FileList | null) {
    if (!fichiers || fichiers.length === 0) return;

    setEnvoi(true);
    setError(null);
    setResultats(null);
    try {
      const data = new FormData();
      for (const fichier of Array.from(fichiers)) data.append("fichiers", fichier);

      const { data: reponse } = await api.post<{ resultats: ResultatFichier[] }>("/activities/import", data);
      setResultats(reponse.resultats);
      onImport?.();
    } catch (err) {
      setError(apiErrorMessage(err, "L'import a échoué."));
    } finally {
      setEnvoi(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="rounded-2xl border border-bordure bg-zinc-950/80 p-4">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-sm">⌚</span>
        <h2 className="text-sm font-bold text-white">Importer mes séances</h2>
      </div>
      <p className="mb-3 text-sm text-doux">
        Déposez le fichier exporté de votre montre. Votre coach travaille alors sur vos allures réelles, et vos
        séances se valident toutes seules.
      </p>

      <input
        ref={inputRef}
        type="file"
        multiple
        accept=".fit,.gpx,.tcx"
        onChange={(e) => envoyer(e.target.files)}
        className="hidden"
      />
      <button
        onClick={() => inputRef.current?.click()}
        disabled={envoi}
        className="flex items-center justify-center gap-2 rounded-lg bg-rose-500 px-3 py-2 text-sm font-semibold text-black transition-colors hover:bg-rose-400 disabled:opacity-50"
      >
        {envoi && <Spinner className="border-black/30 border-t-black" />}
        {envoi ? "Analyse en cours…" : "Choisir un fichier"}
      </button>

      <p className="mt-2 text-xs text-tres-doux">
        Formats acceptés : .fit, .gpx, .tcx — Garmin, Polar, Coros, Suunto, Wahoo, Apple Watch. Vous pouvez en
        déposer plusieurs à la fois.
      </p>

      {resultats && (
        <ul className="mt-3 space-y-1">
          {resultats.map((r, i) => (
            <li key={`${r.fichier}-${i}`} className="flex flex-wrap items-baseline gap-x-2 text-xs">
              <span className="truncate text-doux">{r.fichier}</span>
              <span className={COULEURS[r.statut]}>{LIBELLES[r.statut]}</span>
              {r.detail && <span className="text-tres-doux">{r.detail}</span>}
            </li>
          ))}
        </ul>
      )}

      {error && (
        <p className="mt-2 rounded-md border border-red-900 bg-red-950/40 px-2.5 py-1.5 text-xs text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
