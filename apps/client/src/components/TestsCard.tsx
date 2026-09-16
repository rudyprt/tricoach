import { useEffect, useState } from "react";
import { FaFlask, FaPersonSwimming, FaPersonBiking, FaPersonRunning, FaCheck } from "react-icons/fa6";
import { api, apiErrorMessage, type FitnessTest, type FitnessTestsResponse } from "../lib/api";
import { formatJourLong, parseChrono } from "../lib/formats";

const SPORT_ICONS = {
  natation: FaPersonSwimming,
  velo: FaPersonBiking,
  course: FaPersonRunning,
} as const;

interface ChampsFormulaire {
  distanceKm: string;
  puissanceMoy: string;
  temps400: string;
  temps200: string;
  fcMoyenne: string;
}

const CHAMPS_VIDES: ChampsFormulaire = {
  distanceKm: "",
  puissanceMoy: "",
  temps400: "",
  temps200: "",
  fcMoyenne: "",
};

function FormulaireResultat({ test, onDone }: { test: FitnessTest; onDone: () => void }) {
  const [champs, setChamps] = useState<ChampsFormulaire>(CHAMPS_VIDES);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (cle: keyof ChampsFormulaire) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setChamps((c) => ({ ...c, [cle]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const km = Number(champs.distanceKm.replace(",", "."));
      await api.post(`/tests/${test.id}/result`, {
        distanceM: Number.isFinite(km) && km > 0 ? Math.round(km * 1000) : null,
        puissanceMoy: champs.puissanceMoy ? Number(champs.puissanceMoy) : null,
        temps400S: parseChrono(champs.temps400),
        temps200S: parseChrono(champs.temps200),
        fcMoyenne: champs.fcMoyenne ? Number(champs.fcMoyenne) : null,
      });
      onDone();
    } catch (err) {
      setError(apiErrorMessage(err, "Enregistrement impossible."));
    } finally {
      setSaving(false);
    }
  }

  const champStyle =
    "w-full rounded-lg border border-bordure bg-zinc-900 px-3 py-2 text-sm text-white outline-none focus:border-rose-700";

  return (
    <form onSubmit={submit} className="mt-3 space-y-2.5 border-t border-bordure pt-3">
      {test.kind === "course_30min" && (
        <label className="block">
          <span className="text-xs text-doux">Distance parcourue en 30 min (km)</span>
          <input className={champStyle} inputMode="decimal" placeholder="7,2" value={champs.distanceKm} onChange={set("distanceKm")} />
        </label>
      )}

      {test.kind === "velo_20min" && (
        <label className="block">
          <span className="text-xs text-doux">Puissance moyenne sur 20 min (watts)</span>
          <input className={champStyle} inputMode="numeric" placeholder="235" value={champs.puissanceMoy} onChange={set("puissanceMoy")} />
        </label>
      )}

      {test.kind === "natation_css" && (
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="text-xs text-doux">Temps 400 m</span>
            <input className={champStyle} placeholder="7:20" value={champs.temps400} onChange={set("temps400")} />
          </label>
          <label className="block">
            <span className="text-xs text-doux">Temps 200 m</span>
            <input className={champStyle} placeholder="3:25" value={champs.temps200} onChange={set("temps200")} />
          </label>
        </div>
      )}

      <label className="block">
        <span className="text-xs text-doux">Fréquence cardiaque moyenne (facultatif)</span>
        <input className={champStyle} inputMode="numeric" placeholder="168" value={champs.fcMoyenne} onChange={set("fcMoyenne")} />
      </label>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <button
        type="submit"
        disabled={saving}
        className="w-full rounded-lg bg-rose-600 px-3 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-rose-500 disabled:opacity-50"
      >
        {saving ? "Enregistrement…" : "Enregistrer et recalculer mes zones"}
      </button>
    </form>
  );
}

/**
 * Le test programmé, sa saisie, et l'historique. Un athlète ne progresse pas
 * sur des zones figées : ce bloc est ce qui les tient à jour.
 */
export function TestsCard() {
  const [data, setData] = useState<FitnessTestsResponse | null>(null);
  const [ouvert, setOuvert] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    try {
      const { data } = await api.get<FitnessTestsResponse>("/tests");
      setData(data);
    } catch {
      setData({ enCours: [], historique: [] });
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function ignorer(id: string) {
    await api.post(`/tests/${id}/skip`);
    setOuvert(null);
    await load();
  }

  if (!data || (data.enCours.length === 0 && data.historique.length === 0)) return null;

  return (
    <div className="rounded-2xl border border-bordure bg-zinc-950/80 p-4">
      <div className="mb-3 flex items-center gap-2">
        <FaFlask className="text-emerald-400" size={14} />
        <h2 className="text-sm font-bold text-white">Tests de terrain</h2>
      </div>

      <p className="mb-3 text-xs text-doux">
        Un coach ne devine pas vos allures : il vous teste, puis il réajuste. Ces tests sont insérés automatiquement
        dans votre semaine, environ toutes les six semaines par discipline.
      </p>

      {message && (
        <p className="mb-3 rounded-lg border border-emerald-900/50 bg-emerald-950/30 px-3 py-2 text-sm text-emerald-200">
          {message}
        </p>
      )}

      {data.enCours.map((test) => {
        const Icon = SPORT_ICONS[test.sport];
        return (
          <div key={test.id} className="mb-2 rounded-xl border border-emerald-900/40 bg-emerald-950/15 p-3">
            <div className="flex items-start gap-2">
              <Icon className="mt-0.5 shrink-0 text-emerald-400" size={14} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-white">{test.titre}</p>
                <p className="text-xs capitalize text-doux">{formatJourLong(test.date)}</p>
                <p className="mt-1.5 text-xs leading-relaxed text-doux">{test.protocole}</p>
                <p className="mt-1.5 text-xs text-emerald-300/80">À relever : {test.mesures}</p>
              </div>
            </div>

            {ouvert === test.id ? (
              <FormulaireResultat
                test={test}
                onDone={() => {
                  setOuvert(null);
                  setMessage("Résultat enregistré. Vos zones sont recalculées.");
                  void load();
                }}
              />
            ) : (
              <div className="mt-3 flex gap-2">
                <button
                  onClick={() => setOuvert(test.id)}
                  className="flex-1 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-500"
                >
                  Saisir mon résultat
                </button>
                <button
                  onClick={() => void ignorer(test.id)}
                  className="rounded-lg border border-bordure px-3 py-2 text-sm text-doux transition-colors hover:border-bordure-forte hover:text-zinc-200"
                >
                  Pas fait
                </button>
              </div>
            )}
          </div>
        );
      })}

      {data.historique.length > 0 && (
        <ul className="mt-3 space-y-1.5 border-t border-bordure pt-3">
          {data.historique.map((test) => (
            <li key={test.id} className="flex items-start gap-2 text-xs">
              <FaCheck className="mt-0.5 shrink-0 text-emerald-500" size={10} />
              <span className="text-doux">
                <span className="text-doux">{new Date(`${test.date}T12:00:00`).toLocaleDateString("fr-FR")}</span>{" "}
                — {test.resume ?? test.titre}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
