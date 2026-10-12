import { FC_PAR_DISCIPLINE, type FcCourses } from "../lib/fcCourses";

/** Les deux fréquences cardiaques de la course de référence d'une discipline. */
export function FcCourseChamps({
  discipline,
  label,
  valeur,
  onChange,
}: {
  discipline: keyof typeof FC_PAR_DISCIPLINE;
  label: string;
  valeur: FcCourses;
  onChange: (fc: FcCourses) => void;
}) {
  const cles = FC_PAR_DISCIPLINE[discipline];
  const champ = (cle: keyof FcCourses, titre: string) => (
    <label className="block text-xs text-doux">
      {titre}
      <input
        type="number"
        inputMode="numeric"
        min={80}
        max={230}
        step={1}
        placeholder="bpm"
        aria-label={`${titre} — ${label}`}
        value={valeur[cle]}
        onChange={(e) => onChange({ ...valeur, [cle]: e.target.value })}
        className="mt-0.5 w-full rounded-md border border-bordure bg-zinc-950 px-2 py-1 text-sm text-white outline-none transition-colors focus:border-rose-500"
      />
    </label>
  );
  return (
    <div className="mt-2 grid grid-cols-2 gap-2">
      {champ(cles.moy, "FC moyenne")}
      {champ(cles.max, "FC max")}
    </div>
  );
}
