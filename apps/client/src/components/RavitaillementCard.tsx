import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api, apiErrorMessage, type JournalNutrition, type Ravitaillement, type Session } from "../lib/api";
import { useAuth } from "../lib/AuthContext";

const TOLERANCES: { valeur: JournalNutrition["tolerance"]; label: string }[] = [
  { valeur: "bien", label: "Bien passé" },
  { valeur: "gene", label: "Un peu gêné" },
  { valeur: "troubles", label: "Troubles digestifs" },
];

function Liste({ titre, lignes }: { titre: string; lignes: string[] }) {
  if (lignes.length === 0) return null;
  return (
    <div>
      <p className="mb-1 text-xs font-bold uppercase tracking-wide text-doux">{titre}</p>
      <ul className="space-y-1">
        {lignes.map((l) => (
          <li key={l} className="text-xs leading-relaxed text-zinc-300">
            · {l}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Ravitaillement d'une séance (offre Premium) : avant, pendant, après, et le
 * journal de ce que l'athlète a réellement pris — qui dose les séances
 * suivantes.
 */
export function RavitaillementCard({ session }: { session: Session }) {
  const { user } = useAuth();
  const [ravito, setRavito] = useState<Ravitaillement | null>(null);
  const [journal, setJournal] = useState<JournalNutrition | null>(null);
  const [glucides, setGlucides] = useState("");
  const [boisson, setBoisson] = useState("");
  const [tolerance, setTolerance] = useState<JournalNutrition["tolerance"] | null>(null);
  const [note, setNote] = useState("");
  const [enregistre, setEnregistre] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user?.isPremium) return;
    let actif = true;
    api
      .get<{ ravitaillement: Ravitaillement | null; journal: JournalNutrition | null }>(`/nutrition/seance/${session.id}`)
      .then(({ data }) => {
        if (!actif) return;
        setRavito(data.ravitaillement);
        setJournal(data.journal);
        if (data.journal) {
          setGlucides(String(data.journal.glucidesG));
          setBoisson(data.journal.boissonMl ? String(data.journal.boissonMl) : "");
          setTolerance(data.journal.tolerance);
          setNote(data.journal.note);
        }
      })
      .catch(() => undefined);
    return () => {
      actif = false;
    };
  }, [session.id, user?.isPremium]);

  if (!user?.isPremium) {
    return (
      <div className="mb-4 rounded-xl border border-amber-900/40 bg-amber-950/10 p-3">
        <p className="text-sm font-semibold text-amber-200">🍌 Ravitaillement de cette séance</p>
        <p className="mt-0.5 text-xs text-doux">
          Quoi manger et boire avant, pendant et après, dosé selon votre sudation et ce que votre estomac tolère.{" "}
          <Link to="/abonnement" className="font-semibold text-amber-300 hover:underline">
            Offre Premium
          </Link>
        </p>
      </div>
    );
  }
  if (!ravito) return null;

  async function noter(e: FormEvent) {
    e.preventDefault();
    if (!tolerance) return;
    setError(null);
    try {
      const { data } = await api.put<{ journal: JournalNutrition }>(`/nutrition/seance/${session.id}/journal`, {
        glucidesG: Number(glucides || 0),
        boissonMl: Number(boisson || 0),
        tolerance,
        note,
      });
      setJournal(data.journal);
      setEnregistre(true);
    } catch (err) {
      setError(apiErrorMessage(err, "Enregistrement impossible."));
    }
  }

  const p = ravito.pendant;
  const champ =
    "mt-0.5 w-full rounded-md border border-bordure bg-zinc-950 px-2.5 py-1.5 text-sm text-white outline-none focus:border-amber-500";

  return (
    <details className="mb-4 rounded-xl border border-amber-900/40 bg-amber-950/10 p-3" open={Boolean(p)}>
      <summary className="cursor-pointer text-sm font-semibold text-amber-200">
        🍌 Ravitaillement{p && p.glucidesGH > 0 ? ` — ${p.glucidesGH} g de glucides/h` : ""}
      </summary>
      <div className="mt-3 space-y-3">
        {ravito.entrainementDigestif && (
          <p className="rounded-lg border border-amber-800/50 bg-amber-950/30 px-3 py-2 text-xs text-amber-100">
            {ravito.entrainementDigestif}
          </p>
        )}

        <Liste titre="Avant" lignes={ravito.avant} />

        {p && (
          <div>
            <p className="mb-1 text-xs font-bold uppercase tracking-wide text-doux">Pendant</p>
            <div className="mb-1.5 grid grid-cols-3 gap-2 text-center">
              <div className="rounded-lg bg-black/30 px-2 py-1.5">
                <p className="text-base font-bold tabular-nums text-white">{p.glucidesGH}</p>
                <p className="text-[10px] text-doux">g glucides/h</p>
              </div>
              <div className="rounded-lg bg-black/30 px-2 py-1.5">
                <p className="text-base font-bold tabular-nums text-white">{p.boissonMlH}</p>
                <p className="text-[10px] text-doux">ml/h</p>
              </div>
              <div className="rounded-lg bg-black/30 px-2 py-1.5">
                <p className="text-base font-bold tabular-nums text-white">{p.sodiumMgH || "—"}</p>
                <p className="text-[10px] text-doux">mg sodium/h</p>
              </div>
            </div>
            {p.exemple && <p className="mb-1 text-xs font-medium text-amber-100">{p.exemple}</p>}
            <ul className="space-y-1">
              {p.conseils.map((c) => (
                <li key={c} className="text-xs text-zinc-300">
                  · {c}
                </li>
              ))}
            </ul>
          </div>
        )}

        <Liste titre="Après" lignes={ravito.apres} />

        {ravito.sources.length > 0 && (
          <p className="text-[11px] text-tres-doux">{ravito.sources.join(" ")}</p>
        )}
        <Link to="/nutrition" className="inline-block text-xs font-semibold text-amber-300 hover:underline">
          Personnaliser : poids, test de sudation, formats →
        </Link>

        {p && p.glucidesGH > 0 && (
          <form onSubmit={noter} className="space-y-2 border-t border-white/10 pt-3">
            <p className="text-xs font-bold uppercase tracking-wide text-doux">Ce que j'ai pris</p>
            <div className="grid grid-cols-2 gap-2">
              <label className="block text-xs text-doux">
                Glucides au total (g)
                <input type="number" min={0} value={glucides} onChange={(e) => setGlucides(e.target.value)} className={champ} />
              </label>
              <label className="block text-xs text-doux">
                Boisson au total (ml)
                <input type="number" min={0} value={boisson} onChange={(e) => setBoisson(e.target.value)} className={champ} />
              </label>
            </div>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Tolérance digestive">
              {TOLERANCES.map((t) => (
                <button
                  key={t.valeur}
                  type="button"
                  aria-pressed={tolerance === t.valeur}
                  onClick={() => setTolerance(t.valeur)}
                  className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                    tolerance === t.valeur ? "border-amber-500 bg-amber-950/50 text-amber-100" : "border-bordure text-doux"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Produits pris, ce qui a gêné... (facultatif)"
              maxLength={300}
              className={champ}
            />
            {error && <p className="text-xs text-red-400">{error}</p>}
            <button
              type="submit"
              disabled={!tolerance || glucides === ""}
              className="rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-black transition-colors hover:bg-amber-400 disabled:opacity-50"
            >
              {journal ? "Mettre à jour" : "Noter"}
            </button>
            {enregistre && (
              <p className="text-xs text-emerald-300">Noté : les doses de vos prochaines séances en tiennent compte.</p>
            )}
          </form>
        )}
      </div>
    </details>
  );
}
