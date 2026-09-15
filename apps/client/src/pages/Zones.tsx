import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { FaPersonSwimming, FaPersonBiking, FaPersonRunning, FaFlagCheckered, FaPen, FaHeartPulse } from "react-icons/fa6";
import {
  api,
  apiErrorMessage,
  type TrainingPhase,
  type ZoneOverrides,
  type ZoneRange,
  type ZoneSport,
  type ZonesResponse,
} from "../lib/api";
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

function ZoneBadge({ zone }: { zone: string }) {
  return (
    <span
      className={`w-8 shrink-0 rounded px-1.5 py-0.5 text-center text-xs font-bold ${
        ZONE_COLORS[zone] ?? "bg-zinc-800 text-zinc-300"
      }`}
    >
      {zone}
    </span>
  );
}

function ZoneTable({ ranges }: { ranges: ZoneRange[] }) {
  return (
    <ul className="space-y-1.5">
      {ranges.map((z) => (
        <li key={z.zone} className="flex items-center gap-3 text-sm">
          <ZoneBadge zone={z.zone} />
          <span className="flex-1 text-zinc-400">{z.label}</span>
          <span className={`font-mono ${z.custom ? "text-amber-300" : "text-white"}`}>{z.value}</span>
          {z.custom && (
            <span className="shrink-0 text-[10px] uppercase tracking-wide text-amber-500/70" title="Valeur que vous avez saisie">
              perso
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Les 5 zones sont toujours proposées à la saisie, même sans valeur calculée. */
const ZONE_KEYS = ["Z1", "Z2", "Z3", "Z4", "Z5"] as const;

const ZONE_LABELS: Record<string, string> = {
  Z1: "récupération",
  Z2: "endurance fondamentale",
  Z3: "tempo",
  Z4: "seuil",
  Z5: "intensité maximale",
};

function ZoneEditor({
  sport,
  computed,
  draft,
  onChange,
}: {
  sport: ZoneSport;
  computed: ZoneRange[] | null;
  draft: Record<string, string>;
  onChange: (zone: string, value: string) => void;
}) {
  const computedByZone = new Map((computed ?? []).map((z) => [z.zone, z]));

  return (
    <ul className="space-y-2">
      {ZONE_KEYS.map((zone) => {
        const auto = computedByZone.get(zone);
        return (
          <li key={zone} className="flex items-center gap-2">
            <ZoneBadge zone={zone} />
            <span className="hidden flex-1 text-xs text-zinc-500 sm:block">{auto?.label ?? ZONE_LABELS[zone]}</span>
            <input
              value={draft[zone] ?? ""}
              onChange={(e) => onChange(zone, e.target.value)}
              placeholder={auto?.value ?? "non calculée"}
              maxLength={40}
              aria-label={`Zone ${zone} ${sport}`}
              className="w-36 rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1 text-right font-mono text-sm text-white outline-none transition-colors focus:border-rose-500 sm:w-40"
            />
          </li>
        );
      })}
    </ul>
  );
}

export function Zones() {
  const [data, setData] = useState<ZonesResponse | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<ZoneOverrides>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get<ZonesResponse>("/profile/zones")
      .then(({ data }) => setData(data))
      .catch((err) => setError(apiErrorMessage(err, "Impossible de charger vos zones.")))
      .finally(() => setLoading(false));
  }, []);

  function startEditing() {
    if (!data) return;
    setError(null);
    setDraft({
      course: { ...(data.overrides.course ?? {}) },
      natation: { ...(data.overrides.natation ?? {}) },
      velo: { ...(data.overrides.velo ?? {}) },
    });
    setEditing(true);
  }

  function updateDraft(sport: ZoneSport, zone: string, value: string) {
    setDraft((prev) => ({ ...prev, [sport]: { ...(prev[sport] ?? {}), [zone]: value } }));
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const { data: saved } = await api.put<{ zones: ZonesResponse["zones"]; overrides: ZoneOverrides }>(
        "/profile/zones",
        draft
      );
      setData((prev) => (prev ? { ...prev, zones: saved.zones, overrides: saved.overrides } : prev));
      setEditing(false);
    } catch (err) {
      setError(apiErrorMessage(err, "Impossible d'enregistrer vos zones."));
    } finally {
      setSaving(false);
    }
  }

  async function resetAll() {
    if (!window.confirm("Revenir aux zones calculées à partir de vos temps de référence ?")) return;
    setSaving(true);
    setError(null);
    try {
      const { data: saved } = await api.delete<{ zones: ZonesResponse["zones"]; overrides: ZoneOverrides }>(
        "/profile/zones"
      );
      setData((prev) => (prev ? { ...prev, zones: saved.zones, overrides: saved.overrides } : prev));
      setEditing(false);
    } catch (err) {
      setError(apiErrorMessage(err, "Impossible de réinitialiser vos zones."));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-10">
        <Spinner />
      </div>
    );
  }

  if (error && !data) {
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

  const { zones, computedZones, periodization } = data;
  const hasOverrides = Object.values(data.overrides).some((sport) => Object.keys(sport ?? {}).length > 0);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-white">Mes zones d'entraînement</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Calculées à partir de vos temps de référence. Votre programme est construit sur ces allures.
          </p>
        </div>
        {!editing && (
          <button
            onClick={startEditing}
            className="flex shrink-0 items-center gap-1.5 rounded-full border border-zinc-800 px-3 py-1.5 text-xs font-semibold text-zinc-300 transition-colors hover:border-rose-700 hover:text-white"
          >
            <FaPen size={10} />
            Modifier
          </button>
        )}
      </div>

      {error && (
        <p className="rounded-md border border-red-900 bg-red-950/50 px-3 py-2 text-sm text-red-400">{error}</p>
      )}

      {!editing && (
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
      )}

      {editing && (
        <p className="rounded-xl border border-amber-900/50 bg-amber-950/20 px-3 py-2.5 text-sm text-amber-200">
          Saisissez vos propres valeurs si vous connaissez vos allures. Une zone laissée vide reprend la valeur
          calculée, affichée en gris. Vos valeurs sont ensuite utilisées telles quelles dans vos programmes.
        </p>
      )}

      {SPORTS.map(({ key, label, Icon, color }) => {
        const ranges = zones[key];
        return (
          <div key={key} className="rounded-2xl border border-zinc-800 bg-zinc-950/80 p-4">
            <div className="mb-3 flex items-center gap-2">
              <Icon className={color} size={15} />
              <h2 className="text-sm font-bold text-white">{label}</h2>
            </div>
            {editing ? (
              <ZoneEditor
                sport={key}
                computed={computedZones[key]}
                draft={draft[key] ?? {}}
                onChange={(zone, value) => updateDraft(key, zone, value)}
              />
            ) : ranges ? (
              <ZoneTable ranges={ranges} />
            ) : (
              <p className="text-sm text-zinc-500">
                {key === "velo"
                  ? "Sans FTP, aucune zone chiffrée : à effort égal, la vitesse varie trop selon la pente et le vent. Renseignez votre FTP dans « Mon objectif », ou saisissez vos zones à la main."
                  : `Renseignez un temps de référence en ${label.toLowerCase()}, ou saisissez vos zones à la main avec « Modifier ».`}
              </p>
            )}
          </div>
        );
      })}

      {!editing && zones.frequenceCardiaque && (
        <div className="rounded-2xl border border-zinc-800 bg-zinc-950/80 p-4">
          <div className="mb-3 flex items-center gap-2">
            <FaHeartPulse className="text-red-400" size={15} />
            <h2 className="text-sm font-bold text-white">Fréquence cardiaque</h2>
          </div>
          <ZoneTable ranges={zones.frequenceCardiaque} />
          <p className="mt-2 text-xs text-zinc-500">
            Utile surtout à vélo, où la puissance n'est pas toujours disponible.
          </p>
        </div>
      )}

      {!editing && data.ftpSuggere && (
        <div className="rounded-xl border border-sky-900/50 bg-sky-950/20 p-3">
          <p className="text-sm text-sky-200">
            Vos séances importées montrent une moyenne de {data.ftpSuggere.puissanceMoy} W sur une sortie
            d'entraînement. Votre FTP est probablement proche de{" "}
            <strong>{data.ftpSuggere.ftpSuggere} W</strong>.
          </p>
          <Link to="/objectif" className="mt-1.5 inline-block text-xs font-semibold text-sky-300 hover:underline">
            Renseigner ma FTP →
          </Link>
        </div>
      )}

      {editing ? (
        <div className="flex flex-wrap gap-2">
          <button
            onClick={save}
            disabled={saving}
            className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-rose-500 px-3 py-2.5 text-sm font-semibold text-black transition-all duration-150 hover:bg-rose-400 disabled:opacity-50"
          >
            {saving && <Spinner className="border-black/30 border-t-black" />}
            Enregistrer
          </button>
          <button
            onClick={() => {
              setEditing(false);
              setError(null);
            }}
            disabled={saving}
            className="rounded-lg border border-zinc-800 px-4 py-2.5 text-sm text-zinc-300 transition-colors hover:border-zinc-700 hover:text-white disabled:opacity-50"
          >
            Annuler
          </button>
        </div>
      ) : (
        <>
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

          {hasOverrides && (
            <button
              onClick={resetAll}
              disabled={saving}
              className="w-full rounded-lg border border-zinc-800 px-3 py-2.5 text-sm text-zinc-400 transition-colors hover:border-zinc-700 hover:text-zinc-200 disabled:opacity-50"
            >
              Revenir aux zones calculées automatiquement
            </button>
          )}

          <Link
            to="/objectif"
            className="block rounded-lg border border-zinc-800 px-3 py-2.5 text-center text-sm text-zinc-300 transition-colors hover:border-rose-800 hover:text-white"
          >
            Mettre à jour mes temps de référence
          </Link>
        </>
      )}
    </div>
  );
}
