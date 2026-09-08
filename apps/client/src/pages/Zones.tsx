import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { FaPersonSwimming, FaPersonBiking, FaPersonRunning, FaFlagCheckered } from "react-icons/fa6";
import { api, apiErrorMessage, type TrainingPhase, type ZoneRange, type ZonesResponse } from "../lib/api";
import { Spinner } from "../components/Spinner";

const PHASE_HINTS: Record<TrainingPhase, string> = {
  base: "Priorité au volume en endurance fondamentale et à la technique.",
  developpement: "Montée en charge : seuil et VMA/PMA entrent dans la semaine.",
  specifique: "Les séances clés reproduisent les conditions de course.",
  affutage: "Le volume baisse, l'intensité reste : on arrive frais le jour J.",
  course: "Semaine de course : repos, rappels courts, et le jour J.",
  transition: "Récupération après l'objectif — pensez à fixer le prochain.",
};

const SPORTS = [
  { key: "natation", label: "Natation", Icon: FaPersonSwimming, color: "text-sky-400" },
  { key: "velo", label: "Vélo", Icon: FaPersonBiking, color: "text-amber-400" },
  { key: "course", label: "Course à pied", Icon: FaPersonRunning, color: "text-rose-400" },
] as const;

const ZONE_COLORS: Record<string, string> = {
  Z1: "bg-sky-500/15 text-sky-300",
  Z2: "bg-emerald-500/15 text-emerald-300",
  Z3: "bg-amber-500/15 text-amber-300",
  Z4: "bg-orange-500/15 text-orange-300",
  Z5: "bg-rose-500/15 text-rose-300",
};

function ZoneTable({ ranges }: { ranges: ZoneRange[] }) {
  return (
    <ul className="space-y-1.5">
      {ranges.map((z) => (
        <li key={z.zone} className="flex items-center gap-3 text-sm">
          <span className={`w-8 shrink-0 rounded px-1.5 py-0.5 text-center text-xs font-bold ${ZONE_COLORS[z.zone] ?? "bg-zinc-800 text-zinc-300"}`}>
            {z.zone}
          </span>
          <span className="flex-1 text-zinc-400">{z.label}</span>
          <span className="font-mono text-white">{z.value}</span>
        </li>
      ))}
    </ul>
  );
}

export function Zones() {
  const [data, setData] = useState<ZonesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get<ZonesResponse>("/profile/zones")
      .then(({ data }) => setData(data))
      .catch((err) => setError(apiErrorMessage(err, "Impossible de charger vos zones.")))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex justify-center py-10">
        <Spinner />
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-3">
        <p className="rounded-md border border-red-900 bg-red-950/50 px-3 py-2 text-sm text-red-400">{error}</p>
        <Link to="/objectif" className="text-sm text-rose-400 hover:underline">
          Compléter mon profil
        </Link>
      </div>
    );
  }

  if (!data) return null;

  const { zones, periodization } = data;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-white">Mes zones d'entraînement</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Calculées à partir de vos temps de référence. Votre programme est construit sur ces allures.
        </p>
      </div>

      <div className="rounded-2xl border border-rose-900/40 bg-gradient-to-b from-rose-950/30 to-zinc-950/80 p-4">
        <div className="flex items-center gap-2">
          <FaFlagCheckered className="text-rose-500" size={14} />
          <h2 className="text-sm font-bold uppercase tracking-wide text-white">{periodization.label}</h2>
        </div>
        <p className="mt-1.5 text-sm text-zinc-300">{PHASE_HINTS[periodization.phase]}</p>
        <p className="mt-1 text-xs text-zinc-500">
          {periodization.weeksToGoal > 0
            ? `Objectif dans ${periodization.weeksToGoal} semaine${periodization.weeksToGoal > 1 ? "s" : ""}.`
            : periodization.weeksToGoal === 0
              ? "Votre objectif a lieu cette semaine."
              : "Votre objectif est passé."}
        </p>
      </div>

      {SPORTS.map(({ key, label, Icon, color }) => {
        const ranges = zones[key];
        return (
          <div key={key} className="rounded-2xl border border-zinc-800 bg-zinc-950/80 p-4">
            <div className="mb-3 flex items-center gap-2">
              <Icon className={color} size={15} />
              <h2 className="text-sm font-bold text-white">{label}</h2>
            </div>
            {ranges ? (
              <ZoneTable ranges={ranges} />
            ) : (
              <p className="text-sm text-zinc-500">
                Renseignez un temps de référence en {label.toLowerCase()} pour obtenir vos zones.
              </p>
            )}
          </div>
        );
      })}

      {zones.notes.length > 0 && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-3">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">Méthode de calcul</p>
          <ul className="space-y-1">
            {zones.notes.map((note) => (
              <li key={note} className="text-xs text-zinc-400">
                {note}
              </li>
            ))}
          </ul>
        </div>
      )}

      <Link
        to="/objectif"
        className="block rounded-lg border border-zinc-800 px-3 py-2.5 text-center text-sm text-zinc-300 transition-colors hover:border-rose-800 hover:text-white"
      >
        Mettre à jour mes temps de référence
      </Link>
    </div>
  );
}
