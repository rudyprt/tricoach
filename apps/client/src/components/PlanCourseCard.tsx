import { useEffect, useState } from "react";
import { FaUtensils, FaPersonSwimming, FaPersonBiking, FaPersonRunning, FaArrowsRotate } from "react-icons/fa6";
import { api, apiErrorMessage, type BlocCourse, type Course, type PlanCourse } from "../lib/api";

function Bloc({
  titre,
  Icon,
  couleur,
  bloc,
}: {
  titre: string;
  Icon: typeof FaPersonSwimming;
  couleur: string;
  bloc: BlocCourse;
}) {
  return (
    <div className="rounded-xl border border-bordure bg-zinc-900/40 p-3">
      <div className="mb-2 flex items-center gap-2">
        <Icon className={couleur} size={13} />
        <h4 className="text-sm font-bold text-white">
          {titre} — {bloc.titre}
        </h4>
      </div>
      <dl className="space-y-1.5 text-xs">
        <div>
          <dt className="font-semibold text-zinc-300">Allure</dt>
          <dd className="text-doux">{bloc.allure}</dd>
        </div>
        <div>
          <dt className="font-semibold text-zinc-300">Nutrition</dt>
          <dd className="text-doux">{bloc.nutrition}</dd>
        </div>
        <div>
          <dt className="font-semibold text-zinc-300">Hydratation</dt>
          <dd className="text-doux">{bloc.hydratation}</dd>
        </div>
        <div>
          <dt className="font-semibold text-amber-300/90">Erreur à éviter</dt>
          <dd className="text-amber-200/70">{bloc.erreurs}</dd>
        </div>
      </dl>
    </div>
  );
}

/**
 * Plan de course : allures, nutrition, hydratation, transitions.
 *
 * Sur un half ou un Ironman, ce n'est pas l'entraînement qui fait abandonner,
 * c'est de partir trop vite et de ne pas manger. L'athlète était entraîné
 * pendant six mois, puis laissé seul le jour J.
 */
export function PlanCourseCard({ course }: { course: Course }) {
  const [plan, setPlan] = useState<PlanCourse | null>(null);
  const [genereLe, setGenereLe] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<{ plan: PlanCourse | null; genereLe: string | null }>(`/races/${course.id}/plan`)
      .then(({ data }) => {
        setPlan(data.plan);
        setGenereLe(data.genereLe);
      })
      .catch(() => setPlan(null));
  }, [course.id]);

  async function generer() {
    setBusy(true);
    setError(null);
    try {
      const { data } = await api.post<{ plan: PlanCourse; genereLe: string }>(`/races/${course.id}/plan`);
      setPlan(data.plan);
      setGenereLe(data.genereLe);
    } catch (err) {
      setError(apiErrorMessage(err, "Génération impossible."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl border border-bordure bg-zinc-950/80 p-4">
      <div className="mb-1 flex items-center gap-2">
        <FaUtensils className="text-emerald-400" size={13} />
        <h3 className="text-sm font-bold text-white">Plan de course — {course.nom}</h3>
      </div>
      <p className="mb-3 text-xs text-doux">
        Allures cible, nutrition, hydratation et transitions. Sur une longue distance, c'est ce qui fait la
        différence entre finir et abandonner.
      </p>

      {error && <p className="mb-2 text-sm text-red-400">{error}</p>}

      {plan ? (
        <div className="space-y-2.5">
          <p className="rounded-xl border border-emerald-900/40 bg-emerald-950/20 px-3 py-2.5 text-sm text-emerald-100">
            {plan.resume}
          </p>

          <div className="grid gap-2 sm:grid-cols-2">
            <div className="rounded-xl border border-bordure bg-zinc-900/40 p-3">
              <h4 className="mb-1 text-xs font-bold uppercase tracking-wide text-doux">La veille</h4>
              <p className="text-xs text-doux">{plan.veille}</p>
            </div>
            <div className="rounded-xl border border-bordure bg-zinc-900/40 p-3">
              <h4 className="mb-1 text-xs font-bold uppercase tracking-wide text-doux">Le matin</h4>
              <p className="text-xs text-doux">{plan.matin}</p>
            </div>
          </div>

          <Bloc titre="Natation" Icon={FaPersonSwimming} couleur="text-sky-400" bloc={plan.natation} />
          <p className="rounded-lg border border-bordure/70 bg-zinc-900/20 px-3 py-2 text-xs text-doux">
            <span className="font-semibold text-zinc-300">Transition 1 · </span>
            {plan.transition1}
          </p>
          <Bloc titre="Vélo" Icon={FaPersonBiking} couleur="text-amber-400" bloc={plan.velo} />
          <p className="rounded-lg border border-bordure/70 bg-zinc-900/20 px-3 py-2 text-xs text-doux">
            <span className="font-semibold text-zinc-300">Transition 2 · </span>
            {plan.transition2}
          </p>
          <Bloc titre="Course" Icon={FaPersonRunning} couleur="text-rose-400" bloc={plan.course} />

          {plan.reperes.length > 0 && (
            <div className="rounded-xl border border-bordure bg-zinc-900/40 p-3">
              <h4 className="mb-1.5 text-xs font-bold uppercase tracking-wide text-doux">Repères à retenir</h4>
              <ul className="space-y-1">
                {plan.reperes.map((repere) => (
                  <li key={repere} className="text-xs text-doux">
                    · {repere}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex items-center justify-between gap-2 pt-1">
            {genereLe && (
              <p className="text-[11px] text-tres-doux">
                Établi le {new Date(genereLe).toLocaleDateString("fr-FR")}
              </p>
            )}
            <button
              onClick={() => void generer()}
              disabled={busy}
              className="flex items-center gap-1.5 rounded-lg border border-bordure px-3 py-1.5 text-xs text-doux transition-colors hover:border-bordure-forte hover:text-zinc-200 disabled:opacity-50"
            >
              <FaArrowsRotate size={10} />
              {busy ? "En cours…" : "Régénérer"}
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => void generer()}
          disabled={busy}
          className="w-full rounded-lg bg-emerald-600 px-3 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-500 disabled:opacity-50"
        >
          {busy ? "Votre coach prépare le plan…" : "Établir mon plan de course"}
        </button>
      )}
    </div>
  );
}
