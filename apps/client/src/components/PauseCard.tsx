import { useEffect, useState } from "react";
import { FaBandage, FaPlay, FaArrowTrendUp } from "react-icons/fa6";
import { api, apiErrorMessage, type EtatEntrainement, type RaisonPause } from "../lib/api";

const RAISONS: { valeur: RaisonPause; label: string }[] = [
  { valeur: "blessure", label: "Blessure" },
  { valeur: "maladie", label: "Maladie" },
  { valeur: "indisponibilite", label: "Indisponible" },
];

/**
 * Déclaration d'une interruption, et suivi de la reprise.
 *
 * C'est la situation la plus fréquente en triathlon, et celle que
 * l'application traitait le plus mal : elle continuait de produire des
 * semaines pleines à quelqu'un d'arrêté, puis repartait du volume d'avant.
 */
export function PauseCard({ onChange }: { onChange?: () => void }) {
  const [etat, setEtat] = useState<EtatEntrainement | null>(null);
  const [formulaire, setFormulaire] = useState(false);
  const [raison, setRaison] = useState<RaisonPause>("blessure");
  const [detail, setDetail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const { data } = await api.get<EtatEntrainement>("/pauses");
      setEtat(data);
    } catch {
      setEtat(null);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function declarer() {
    setBusy(true);
    setError(null);
    try {
      await api.post("/pauses", { raison, detail });
      setFormulaire(false);
      setDetail("");
      await load();
      onChange?.();
    } catch (err) {
      setError(apiErrorMessage(err, "Déclaration impossible."));
    } finally {
      setBusy(false);
    }
  }

  async function reprendre() {
    setBusy(true);
    setError(null);
    try {
      await api.post("/pauses/reprendre");
      await load();
      onChange?.();
    } catch (err) {
      setError(apiErrorMessage(err, "Reprise impossible."));
    } finally {
      setBusy(false);
    }
  }

  if (!etat) return null;

  if (etat.etat === "en_pause" && etat.pause) {
    const { pause } = etat;
    return (
      <div className="rounded-2xl border border-amber-900/50 bg-amber-950/20 p-4">
        <div className="flex items-center gap-2">
          <FaBandage className="text-amber-400" size={14} />
          <h2 className="text-sm font-bold text-white">Entraînement en pause — {pause.libelle}</h2>
        </div>
        <p className="mt-1.5 text-sm text-amber-100/80">
          {pause.joursEcoules === 0
            ? "Depuis aujourd'hui."
            : `Depuis ${pause.joursEcoules} jour${pause.joursEcoules > 1 ? "s" : ""}.`}{" "}
          Aucun programme n'est généré tant que vous n'avez pas repris.
        </p>
        {pause.detail && <p className="mt-1 text-xs text-amber-200/60">« {pause.detail} »</p>}

        {error && <p className="mt-2 text-sm text-red-400">{error}</p>}

        <button
          onClick={() => void reprendre()}
          disabled={busy}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-amber-600 px-3 py-2.5 text-sm font-semibold text-black transition-colors hover:bg-amber-500 disabled:opacity-50"
        >
          <FaPlay size={11} />
          Je reprends l'entraînement
        </button>
      </div>
    );
  }

  if (etat.etat === "en_reprise" && etat.reprise) {
    const { reprise } = etat;
    return (
      <div className="rounded-2xl border border-sky-900/50 bg-sky-950/20 p-4">
        <div className="flex items-center gap-2">
          <FaArrowTrendUp className="text-sky-400" size={14} />
          <h2 className="text-sm font-bold text-white">
            Reprise progressive — semaine {reprise.semaine} sur {reprise.total}
          </h2>
        </div>
        <p className="mt-1.5 text-sm text-sky-100/80">
          Après {reprise.joursArret} jours d'arrêt, votre volume repart à {Math.round(reprise.facteurVolume * 100)} %
          et remonte chaque semaine. C'est volontairement prudent : reprendre trop vite est la première cause de
          re-blessure.
        </p>
      </div>
    );
  }

  if (formulaire) {
    return (
      <div className="rounded-2xl border border-bordure bg-zinc-950/80 p-4">
        <h2 className="text-sm font-bold text-white">Mettre mon entraînement en pause</h2>
        <p className="mt-1 mb-3 text-xs text-doux">
          Les séances encore à venir sont retirées. À la reprise, votre volume remontera par paliers au lieu de
          repartir d'où il s'était arrêté.
        </p>

        <div className="mb-2 flex gap-2">
          {RAISONS.map((r) => (
            <button
              key={r.valeur}
              onClick={() => setRaison(r.valeur)}
              className={`flex-1 rounded-lg border px-2 py-2 text-xs font-semibold transition-colors ${
                raison === r.valeur
                  ? "border-amber-700 bg-amber-950/40 text-amber-200"
                  : "border-bordure text-doux hover:border-bordure-forte"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>

        <input
          value={detail}
          onChange={(e) => setDetail(e.target.value)}
          maxLength={500}
          placeholder={raison === "blessure" ? "Où avez-vous mal ? (facultatif)" : "Précision (facultatif)"}
          className="mb-2 w-full rounded-lg border border-bordure bg-zinc-900 px-3 py-2 text-sm text-white outline-none focus:border-amber-700"
        />

        {error && <p className="mb-2 text-sm text-red-400">{error}</p>}

        <div className="flex gap-2">
          <button
            onClick={() => void declarer()}
            disabled={busy}
            className="flex-1 rounded-lg bg-amber-600 px-3 py-2.5 text-sm font-semibold text-black transition-colors hover:bg-amber-500 disabled:opacity-50"
          >
            Confirmer la pause
          </button>
          <button
            onClick={() => setFormulaire(false)}
            className="rounded-lg border border-bordure px-3 py-2.5 text-sm text-doux transition-colors hover:border-bordure-forte hover:text-zinc-200"
          >
            Annuler
          </button>
        </div>
      </div>
    );
  }

  return (
    <button
      onClick={() => setFormulaire(true)}
      className="w-full rounded-2xl border border-dashed border-bordure px-3 py-2.5 text-sm text-doux transition-colors hover:border-amber-800/70 hover:text-zinc-200"
    >
      Blessé, malade ou indisponible — mettre en pause
    </button>
  );
}
