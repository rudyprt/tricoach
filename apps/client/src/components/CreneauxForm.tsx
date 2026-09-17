import { FaCalendarDay } from "react-icons/fa6";
import { JOURS, type Disponibilites, type Jour, type Moment } from "../lib/api";
import { formatDuree, totalCreneauxMin } from "../lib/formats";

const MOMENTS: { valeur: Moment; label: string }[] = [
  { valeur: "matin", label: "Matin" },
  { valeur: "midi", label: "Midi" },
  { valeur: "soir", label: "Soir" },
  { valeur: "libre", label: "Libre" },
];

const DUREES = [30, 45, 60, 75, 90, 120, 180, 240];

/**
 * Créneaux d'entraînement, jour par jour.
 *
 * C'est l'entrée qui manquait le plus : sans elle, le coach ne connaissait
 * qu'un nombre d'heures hebdomadaire et pouvait placer une sortie longue un
 * mardi soir de travail, ou de la natation un jour de piscine fermée.
 */
export function CreneauxForm({
  valeur,
  onChange,
}: {
  valeur: Disponibilites;
  onChange: (v: Disponibilites) => void;
}) {
  function majJour(jour: Jour, patch: Partial<Disponibilites[Jour]>) {
    const actuel = valeur[jour] ?? { disponible: true, moment: "libre" as Moment };
    onChange({ ...valeur, [jour]: { ...actuel, ...patch } });
  }

  const totalMin = totalCreneauxMin(valeur);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <FaCalendarDay className="text-rose-400" size={13} />
        <label className="text-sm font-semibold text-zinc-200">Mes créneaux d'entraînement</label>
      </div>
      <p className="text-xs text-doux">
        Décochez les jours où vous ne pouvez pas vous entraîner, et indiquez le temps dont vous disposez. Votre
        programme sera construit dans ces limites, pas au-delà.
      </p>

      <div className="space-y-1.5">
        {JOURS.map((jour) => {
          const j = valeur[jour] ?? { disponible: true, moment: "libre" as Moment };
          return (
            <div
              key={jour}
              className={`rounded-lg border px-2.5 py-2 transition-colors ${
                j.disponible ? "border-bordure bg-zinc-900/40" : "border-bordure bg-zinc-950/60"
              }`}
            >
              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => majJour(jour, { disponible: !j.disponible })}
                  aria-pressed={j.disponible}
                  className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
                    j.disponible ? "bg-rose-600" : "bg-zinc-700"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${
                      j.disponible ? "left-[1.125rem]" : "left-0.5"
                    }`}
                  />
                </button>
                <span
                  className={`w-20 shrink-0 text-sm capitalize ${j.disponible ? "text-white" : "text-tres-doux"}`}
                >
                  {jour}
                </span>

                {j.disponible ? (
                  <div className="flex min-w-0 flex-1 gap-1.5">
                    <select
                      value={j.dureeMaxMin ?? ""}
                      onChange={(e) => majJour(jour, { dureeMaxMin: e.target.value ? Number(e.target.value) : null })}
                      className="min-w-0 flex-1 rounded border border-bordure bg-zinc-900 px-2 py-1 text-xs text-white outline-none focus:border-rose-600"
                    >
                      <option value="">Durée libre</option>
                      {DUREES.map((d) => (
                        <option key={d} value={d}>
                          {d >= 60 ? `${Math.floor(d / 60)}h${d % 60 ? String(d % 60).padStart(2, "0") : ""}` : `${d} min`}
                        </option>
                      ))}
                    </select>
                    <select
                      value={j.moment ?? "libre"}
                      onChange={(e) => majJour(jour, { moment: e.target.value as Moment })}
                      className="min-w-0 flex-1 rounded border border-bordure bg-zinc-900 px-2 py-1 text-xs text-white outline-none focus:border-rose-600"
                    >
                      {MOMENTS.map((m) => (
                        <option key={m.valeur} value={m.valeur}>
                          {m.label}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <span className="flex-1 text-xs text-tres-doux">Repos imposé</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {totalMin > 0 && (
        <p className="text-xs text-doux">
          Total déclaré : {formatDuree(totalMin)} par semaine.
          Votre programme ne dépassera pas ce volume.
        </p>
      )}
    </div>
  );
}
