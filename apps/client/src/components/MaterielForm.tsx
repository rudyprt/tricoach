import { FaBicycle } from "react-icons/fa6";
import type { Materiel } from "../lib/api";

export const MATERIEL_PAR_DEFAUT: Materiel = {
  homeTrainer: false,
  capteurPuissance: false,
  montreGps: true,
  cardiofrequencemetre: false,
  tapisCourse: false,
  piscine: "25m",
  velo: "route",
};

const PISCINES = [
  { valeur: "25m", label: "Bassin de 25 m" },
  { valeur: "50m", label: "Bassin de 50 m" },
  { valeur: "eau_libre", label: "Eau libre" },
  { valeur: "aucune", label: "Aucun accès" },
] as const;

const VELOS = [
  { valeur: "route", label: "Vélo de route" },
  { valeur: "contre_la_montre", label: "Vélo de contre-la-montre" },
  { valeur: "vtt", label: "VTT / gravel" },
  { valeur: "aucun", label: "Pas de vélo" },
] as const;

const EQUIPEMENTS: { cle: keyof Materiel; label: string }[] = [
  { cle: "homeTrainer", label: "Home-trainer" },
  { cle: "capteurPuissance", label: "Capteur de puissance" },
  { cle: "cardiofrequencemetre", label: "Ceinture cardio" },
  { cle: "montreGps", label: "Montre GPS" },
  { cle: "tapisCourse", label: "Tapis de course" },
];

/**
 * Matériel et accès. Une séance que l'athlète ne peut pas réaliser ne sert à
 * rien : sans bassin, la natation doit disparaître du programme plutôt que d'y
 * figurer et d'être manquée chaque semaine.
 */
export function MaterielForm({ valeur, onChange }: { valeur: Materiel; onChange: (v: Materiel) => void }) {
  const champ =
    "w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-white outline-none focus:border-rose-500";

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <FaBicycle className="text-rose-400" size={13} />
        <label className="text-sm font-semibold text-zinc-200">Mon matériel</label>
      </div>
      <p className="text-xs text-zinc-500">
        Votre coach n'écrira que des séances que vous pouvez réellement faire.
      </p>

      <div className="grid grid-cols-2 gap-2">
        <select
          value={valeur.piscine}
          onChange={(e) => onChange({ ...valeur, piscine: e.target.value as Materiel["piscine"] })}
          className={champ}
        >
          {PISCINES.map((p) => (
            <option key={p.valeur} value={p.valeur}>
              {p.label}
            </option>
          ))}
        </select>
        <select
          value={valeur.velo}
          onChange={(e) => onChange({ ...valeur, velo: e.target.value as Materiel["velo"] })}
          className={champ}
        >
          {VELOS.map((v) => (
            <option key={v.valeur} value={v.valeur}>
              {v.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {EQUIPEMENTS.map(({ cle, label }) => {
          const actif = Boolean(valeur[cle]);
          return (
            <button
              key={cle}
              type="button"
              onClick={() => onChange({ ...valeur, [cle]: !actif })}
              aria-pressed={actif}
              className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                actif
                  ? "border-rose-800 bg-rose-950/40 text-rose-200"
                  : "border-zinc-800 text-zinc-500 hover:border-zinc-700"
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
