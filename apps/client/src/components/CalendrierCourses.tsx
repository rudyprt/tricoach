import { useEffect, useState, type FormEvent } from "react";
import { FaFlagCheckered, FaPlus, FaTrash } from "react-icons/fa6";
import { api, apiErrorMessage, type Course, type FormatCourse, type PrioriteCourse } from "../lib/api";
import { PlanCourseCard } from "./PlanCourseCard";

const FORMATS: { valeur: FormatCourse; label: string }[] = [
  { valeur: "sprint", label: "Sprint" },
  { valeur: "olympique", label: "Olympique" },
  { valeur: "half", label: "Half / 70.3" },
  { valeur: "ironman", label: "Ironman" },
  { valeur: "autre", label: "Autre" },
];

const PRIORITES: { valeur: PrioriteCourse; titre: string; explication: string; couleur: string }[] = [
  {
    valeur: "A",
    titre: "A — Objectif principal",
    explication: "Toute la saison est construite pour cette course. Affûtage complet de deux à trois semaines.",
    couleur: "border-rose-700 bg-rose-950/40 text-rose-200",
  },
  {
    valeur: "B",
    titre: "B — Objectif secondaire",
    explication: "Comptée, mais pas au prix de l'objectif principal. Affûtage court de quelques jours.",
    couleur: "border-amber-700 bg-amber-950/40 text-amber-200",
  },
  {
    valeur: "C",
    titre: "C — Course d'entraînement",
    explication: "Courue dans la charge, sans allègement. Elle remplace une séance intensive.",
    couleur: "border-sky-700 bg-sky-950/40 text-sky-200",
  },
];

const COULEURS_PASTILLE: Record<PrioriteCourse, string> = {
  A: "bg-rose-500/15 text-rose-300",
  B: "bg-amber-500/15 text-amber-300",
  C: "bg-sky-500/15 text-sky-300",
};

function formatJour(date: string): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/**
 * Calendrier de la saison.
 *
 * Un triathlète ne prépare presque jamais une seule course. Sans ce calendrier,
 * les courses intermédiaires étaient courues en pleine charge d'entraînement,
 * ou bien l'athlète affûtait pour chacune et n'arrivait jamais en forme à celle
 * qui compte.
 */
export function CalendrierCourses({ onChange }: { onChange?: () => void }) {
  const [courses, setCourses] = useState<Course[]>([]);
  const [ouvert, setOuvert] = useState(false);
  const [planOuvert, setPlanOuvert] = useState<string | null>(null);
  const [nom, setNom] = useState("");
  const [date, setDate] = useState("");
  const [format, setFormat] = useState<FormatCourse>("olympique");
  const [priorite, setPriorite] = useState<PrioriteCourse>("A");
  const [objectifTemps, setObjectifTemps] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const { data } = await api.get<{ courses: Course[] }>("/races");
      setCourses(data.courses);
    } catch {
      setCourses([]);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function ajouter(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post("/races", { nom, date, format, priorite, objectifTemps });
      setNom("");
      setDate("");
      setObjectifTemps("");
      setOuvert(false);
      await load();
      onChange?.();
    } catch (err) {
      setError(apiErrorMessage(err, "Impossible d'ajouter cette course."));
    } finally {
      setBusy(false);
    }
  }

  async function supprimer(id: string) {
    setError(null);
    try {
      await api.delete(`/races/${id}`);
      await load();
      onChange?.();
    } catch (err) {
      setError(apiErrorMessage(err, "Suppression impossible."));
    }
  }

  const champ =
    "w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-white outline-none focus:border-rose-500";

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/80 p-4">
      <div className="mb-1 flex items-center gap-2">
        <FaFlagCheckered className="text-rose-500" size={14} />
        <h2 className="text-sm font-bold text-white">Mes courses de la saison</h2>
      </div>
      <p className="mb-3 text-xs text-zinc-500">
        Votre préparation est construite pour votre course A. Les courses B et C s'y insèrent sans casser la
        progression.
      </p>

      {error && <p className="mb-2 text-sm text-red-400">{error}</p>}

      {courses.length > 0 && (
        <ul className="mb-3 space-y-1.5">
          {courses.map((course) => (
            <li
              key={course.id}
              className="flex items-center gap-2.5 rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2"
            >
              <span
                className={`w-6 shrink-0 rounded px-1 py-0.5 text-center text-xs font-bold ${COULEURS_PASTILLE[course.priorite]}`}
              >
                {course.priorite}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-white">{course.nom}</p>
                <p className="text-xs text-zinc-500">
                  {formatJour(course.date)}
                  {course.format !== "autre" && ` · ${FORMATS.find((f) => f.valeur === course.format)?.label}`}
                  {course.objectifTemps && ` · objectif ${course.objectifTemps}`}
                </p>
              </div>
              {course.priorite !== "C" && (
                <button
                  onClick={() => setPlanOuvert(planOuvert === course.id ? null : course.id)}
                  className="shrink-0 rounded-full border border-emerald-900/50 px-2 py-1 text-[11px] font-semibold text-emerald-300 transition-colors hover:border-emerald-700"
                >
                  Plan
                </button>
              )}
              <button
                onClick={() => void supprimer(course.id)}
                aria-label={`Retirer ${course.nom}`}
                className="shrink-0 rounded p-1.5 text-zinc-600 transition-colors hover:text-red-400"
              >
                <FaTrash size={11} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {planOuvert && courses.some((c) => c.id === planOuvert) && (
        <div className="mb-3">
          <PlanCourseCard course={courses.find((c) => c.id === planOuvert)!} />
        </div>
      )}

      {ouvert ? (
        <form onSubmit={ajouter} className="space-y-2 border-t border-zinc-800 pt-3">
          <input
            required
            value={nom}
            onChange={(e) => setNom(e.target.value)}
            placeholder="Nom de la course"
            className={champ}
          />
          <div className="grid grid-cols-2 gap-2">
            <input required type="date" value={date} onChange={(e) => setDate(e.target.value)} className={champ} />
            <select value={format} onChange={(e) => setFormat(e.target.value as FormatCourse)} className={champ}>
              {FORMATS.map((f) => (
                <option key={f.valeur} value={f.valeur}>
                  {f.label}
                </option>
              ))}
            </select>
          </div>
          <input
            value={objectifTemps}
            onChange={(e) => setObjectifTemps(e.target.value)}
            placeholder="Temps visé (facultatif)"
            className={champ}
          />

          <div className="space-y-1.5">
            {PRIORITES.map((p) => (
              <button
                key={p.valeur}
                type="button"
                onClick={() => setPriorite(p.valeur)}
                className={`w-full rounded-lg border px-3 py-2 text-left transition-colors ${
                  priorite === p.valeur ? p.couleur : "border-zinc-800 text-zinc-400 hover:border-zinc-700"
                }`}
              >
                <span className="block text-xs font-bold">{p.titre}</span>
                <span className="mt-0.5 block text-[11px] leading-snug opacity-80">{p.explication}</span>
              </button>
            ))}
          </div>

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={busy}
              className="flex-1 rounded-lg bg-rose-600 px-3 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-rose-500 disabled:opacity-50"
            >
              Ajouter au calendrier
            </button>
            <button
              type="button"
              onClick={() => setOuvert(false)}
              className="rounded-lg border border-zinc-800 px-3 py-2.5 text-sm text-zinc-400 transition-colors hover:border-zinc-700 hover:text-zinc-200"
            >
              Annuler
            </button>
          </div>
        </form>
      ) : (
        <button
          onClick={() => setOuvert(true)}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-zinc-800 px-3 py-2.5 text-sm text-zinc-400 transition-colors hover:border-rose-800/70 hover:text-zinc-200"
        >
          <FaPlus size={11} />
          Ajouter une course
        </button>
      )}
    </div>
  );
}
