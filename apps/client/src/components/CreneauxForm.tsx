import { FaCalendarDay } from "react-icons/fa6";
import { JOURS, type Discipline, type Disponibilites, type Jour, type Moment } from "../lib/api";
import { formatDuree, totalCreneauxMin } from "../lib/formats";

const MOMENTS: { valeur: Moment; label: string }[] = [
  { valeur: "matin", label: "Matin" },
  { valeur: "midi", label: "Midi" },
  { valeur: "soir", label: "Soir" },
  { valeur: "libre", label: "Libre" },
];

const DISCIPLINES: { valeur: Discipline; label: string }[] = [
  { valeur: "libre", label: "Au choix" },
  { valeur: "natation", label: "Natation" },
  { valeur: "velo", label: "Vélo" },
  { valeur: "course", label: "Course" },
  { valeur: "renfo", label: "Renfo" },
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
    const actuel = valeur[jour] ?? { disponible: true, moment: "libre" as Moment, discipline: "libre" as Discipline };
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
        programme sera construit dans ces limites, pas au-delà. Imposez une discipline seulement quand c'est un
        accès contraint — une piscine, un home-trainer, un créneau de club.
      </p>

      <div className="space-y-1.5">
        {JOURS.map((jour) => {
          const j = valeur[jour] ?? { disponible: true, moment: "libre" as Moment, discipline: "libre" as Discipline };
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
                <span className={`text-sm capitalize ${j.disponible ? "text-white" : "text-tres-doux"}`}>
                  {jour}
                </span>
                {!j.disponible && <span className="ml-auto text-xs text-tres-doux">Repos imposé</span>}
              </div>

              {/* Les trois réglages passent sous le nom du jour : à trois sur la
                  même ligne qu'un libellé, chacun tombait sous les 100 px et le
                  texte des options était coupé au milieu d'un mot. */}
              {j.disponible && (
                <div className="mt-2 grid grid-cols-3 gap-1.5">
                  <label className="min-w-0">
                    <span className="mb-1 block text-[10px] uppercase tracking-wide text-tres-doux">Durée</span>
                    <select
                      value={j.dureeMaxMin ?? ""}
                      onChange={(e) => majJour(jour, { dureeMaxMin: e.target.value ? Number(e.target.value) : null })}
                      className="w-full min-w-0 rounded border border-bordure bg-zinc-900 px-2 py-1.5 text-xs text-white outline-none focus:border-rose-600"
                    >
                      <option value="">Libre</option>
                      {DUREES.map((d) => (
                        <option key={d} value={d}>
                          {d >= 60 ? `${Math.floor(d / 60)}h${d % 60 ? String(d % 60).padStart(2, "0") : ""}` : `${d} min`}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="min-w-0">
                    <span className="mb-1 block text-[10px] uppercase tracking-wide text-tres-doux">Moment</span>
                    <select
                      value={j.moment ?? "libre"}
                      onChange={(e) => majJour(jour, { moment: e.target.value as Moment })}
                      className="w-full min-w-0 rounded border border-bordure bg-zinc-900 px-2 py-1.5 text-xs text-white outline-none focus:border-rose-600"
                    >
                      {MOMENTS.map((m) => (
                        <option key={m.valeur} value={m.valeur}>
                          {m.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="min-w-0">
                    <span className="mb-1 block text-[10px] uppercase tracking-wide text-tres-doux">Discipline</span>
                    <select
                      value={j.discipline ?? "libre"}
                      onChange={(e) => majJour(jour, { discipline: e.target.value as Discipline })}
                      className={`w-full min-w-0 rounded border bg-zinc-900 px-2 py-1.5 text-xs outline-none focus:border-rose-600 ${
                        (j.discipline ?? "libre") === "libre"
                          ? "border-bordure text-white"
                          : "border-accent-sombre text-accent-clair"
                      }`}
                    >
                      {DISCIPLINES.map((d) => (
                        <option key={d.valeur} value={d.valeur}>
                          {d.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              )}
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
