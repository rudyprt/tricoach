import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { api, apiErrorMessage, type Disponibilites, type Materiel } from "../lib/api";
import { CreneauxForm } from "../components/CreneauxForm";
import { MaterielForm, MATERIEL_PAR_DEFAUT } from "../components/MaterielForm";
import { useAuth } from "../lib/AuthContext";

const DISCIPLINES = [
  { key: "tempsNatation", icon: "🏊", label: "Natation", placeholder: "Ex : 1500m nage libre en 28min" },
  { key: "tempsVelo", icon: "🚴", label: "Vélo", placeholder: "Ex : 40km en 1h10" },
  { key: "tempsCourse", icon: "🏃", label: "Course à pied", placeholder: "Ex : 10km en 45min" },
] as const;

type DisciplineKey = (typeof DISCIPLINES)[number]["key"];

export function Onboarding() {
  const [objectif, setObjectif] = useState("");
  const [objectifDate, setObjectifDate] = useState("");
  const [temps, setTemps] = useState<Record<DisciplineKey, string>>({
    tempsNatation: "",
    tempsVelo: "",
    tempsCourse: "",
  });
  const [heuresSemaine, setHeuresSemaine] = useState(6);
  const [debutant, setDebutant] = useState(false);
  const [disponibilites, setDisponibilites] = useState<Disponibilites>({});
  const [materiel, setMateriel] = useState<Materiel>(MATERIEL_PAR_DEFAUT);
  const [contraintes, setContraintes] = useState("");
  const [ftpWatts, setFtpWatts] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { refresh } = useAuth();
  const navigate = useNavigate();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await api.put("/profile", {
        objectif,
        objectifDate,
        ...temps,
        heuresSemaine,
        // Un débutant complet ne peut pas donner de temps de référence. Le dire
        // explicitement au coach vaut mieux que de le laisser deviner à partir
        // de trois champs vides.
        contraintes: debutant
          ? [contraintes, "Débutant : aucune course ni entraînement structuré à ce jour."].filter(Boolean).join(" — ")
          : contraintes,
        ftpWatts: ftpWatts.trim() === "" ? null : Number(ftpWatts),
        disponibilites: Object.keys(disponibilites).length > 0 ? disponibilites : null,
        materiel,
      });
      await refresh();
      navigate("/dashboard?generate=1");
    } catch (err) {
      setError(apiErrorMessage(err, "Impossible d'enregistrer votre profil."));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="animate-fade-in-up w-full max-w-2xl">
        <h1 className="mb-1 text-2xl font-semibold text-white">Bienvenue !</h1>
        <p className="mb-6 text-doux">
          Répondez à ces quelques questions pour que votre coach IA prépare un programme sur mesure.
        </p>
        <form onSubmit={handleSubmit} className="space-y-6 rounded-2xl border border-bordure bg-zinc-950/80 p-6 shadow-2xl shadow-black/50 backdrop-blur-sm">
          {error && <p className="rounded-md border border-red-900 bg-red-950/50 px-3 py-2 text-sm text-red-400">{error}</p>}

          <div className="space-y-1">
            <label className="text-sm text-zinc-300">Quel est votre objectif à venir ?</label>
            <input
              required
              placeholder="Ex : Half Ironman de Nice, distance M, marathon..."
              value={objectif}
              onChange={(e) => setObjectif(e.target.value)}
              className="w-full rounded-lg border border-bordure bg-zinc-900 px-3 py-2 text-sm text-white outline-none transition-colors focus:border-rose-500"
            />
          </div>

          <div className="space-y-1">
            <label className="text-sm text-zinc-300">Date de cet objectif</label>
            <input
              type="date"
              required
              value={objectifDate}
              onChange={(e) => setObjectifDate(e.target.value)}
              className="w-full rounded-lg border border-bordure bg-zinc-900 px-3 py-2 text-sm text-white outline-none transition-colors focus:border-rose-500"
            />
          </div>

          <button
            type="button"
            onClick={() => setDebutant((v) => !v)}
            aria-pressed={debutant}
            className={`w-full rounded-xl border px-3 py-2.5 text-left text-sm transition-colors ${
              debutant
                ? "border-rose-800 bg-rose-950/30 text-rose-200"
                : "border-bordure text-doux hover:border-bordure-forte"
            }`}
          >
            <span className="font-semibold">Je débute, je n'ai pas de temps de référence</span>
            <span className="mt-0.5 block text-xs opacity-80">
              Votre coach partira d'une base prudente et vous testera dans les premières semaines pour établir vos
              allures.
            </span>
          </button>

          {!debutant && (
          <div className="space-y-2">
            <label className="text-sm text-zinc-300">Temps sur votre dernière course, par discipline (facultatif)</label>
            <div className="grid gap-3 sm:grid-cols-3">
              {DISCIPLINES.map((d) => (
                <div
                  key={d.key}
                  className="rounded-xl border border-bordure bg-zinc-900/60 p-3 transition-colors duration-200 hover:border-rose-800/60 hover:bg-zinc-900"
                >
                  <p className="mb-2 text-sm font-medium text-white">
                    <span className="mr-1">{d.icon}</span>
                    {d.label}
                  </p>
                  <input
                    placeholder={d.placeholder}
                    value={temps[d.key]}
                    onChange={(e) => setTemps((prev) => ({ ...prev, [d.key]: e.target.value }))}
                    className="w-full rounded-md border border-bordure bg-zinc-950 px-2.5 py-1.5 text-sm text-white outline-none transition-colors focus:border-rose-500"
                  />
                </div>
              ))}
            </div>
          </div>
          )}

          {!debutant && (
          <div className="space-y-1">
            <label className="text-sm text-zinc-300">FTP vélo en watts (facultatif)</label>
            <input
              type="number"
              min={50}
              max={600}
              step={1}
              placeholder="Ex : 240"
              value={ftpWatts}
              onChange={(e) => setFtpWatts(e.target.value)}
              className="w-full rounded-lg border border-bordure bg-zinc-900 px-3 py-2 text-sm text-white outline-none transition-colors focus:border-rose-500"
            />
            <p className="text-xs text-doux">
              Renseignée, elle permet des zones vélo en puissance plutôt qu'une estimation par la vitesse.
            </p>
          </div>
          )}

          <div className="space-y-1">
            <label className="text-sm text-zinc-300">Heures disponibles pour vous entraîner cette semaine</label>
            <input
              type="number"
              required
              min={1}
              max={30}
              step={0.5}
              value={heuresSemaine}
              onChange={(e) => setHeuresSemaine(Number(e.target.value))}
              className="w-full rounded-lg border border-bordure bg-zinc-900 px-3 py-2 text-sm text-white outline-none transition-colors focus:border-rose-500"
            />
          </div>

          <div className="rounded-xl border border-bordure bg-zinc-900/40 p-3">
            <CreneauxForm valeur={disponibilites} onChange={setDisponibilites} />
          </div>

          <div className="rounded-xl border border-bordure bg-zinc-900/40 p-3">
            <MaterielForm valeur={materiel} onChange={setMateriel} />
          </div>

          <div className="space-y-1">
            <label className="text-sm text-zinc-300">Blessures ou contraintes particulières (facultatif)</label>
            <textarea
              placeholder="Ex : douleur au genou droit, pas de piscine le week-end, déplacement pro semaine prochaine..."
              value={contraintes}
              onChange={(e) => setContraintes(e.target.value)}
              rows={3}
              className="w-full rounded-lg border border-bordure bg-zinc-900 px-3 py-2 text-sm text-white outline-none transition-colors focus:border-rose-500"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-rose-500 px-3 py-2.5 text-sm font-semibold text-black transition-all duration-150 hover:scale-[1.01] hover:bg-rose-400 active:scale-[0.99] disabled:opacity-50 disabled:hover:scale-100"
          >
            {loading ? "Enregistrement..." : "Générer mon programme"}
          </button>
        </form>
      </div>
    </div>
  );
}
