import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { FaChartLine, FaCrown, FaPersonBiking, FaPersonRunning, FaPersonSwimming, FaArrowsRotate } from "react-icons/fa6";
import {
  api,
  apiErrorMessage,
  type AnalyseCourseReponse,
  type Course,
  type ResultatCourse,
  type SegmentCourse,
} from "../lib/api";
import { useAuth } from "../lib/AuthContext";
import { Spinner } from "./Spinner";

const VIDE: ResultatCourse = {
  natation: "",
  t1: "",
  velo: "",
  t2: "",
  course: "",
  total: "",
  classementGeneral: "",
  classementCategorie: "",
  conditions: "",
  ressenti: "",
};

const SEGMENTS: { cle: SegmentCourse; label: string; placeholder: string }[] = [
  { cle: "natation", label: "Natation", placeholder: "28:40" },
  { cle: "t1", label: "T1", placeholder: "2:10" },
  { cle: "velo", label: "Vélo", placeholder: "1:12:30" },
  { cle: "t2", label: "T2", placeholder: "1:20" },
  { cle: "course", label: "Course", placeholder: "48:15" },
];

const ICONES: Partial<Record<SegmentCourse, { Icon: typeof FaPersonSwimming; couleur: string }>> = {
  natation: { Icon: FaPersonSwimming, couleur: "text-sky-400" },
  velo: { Icon: FaPersonBiking, couleur: "text-amber-400" },
  course: { Icon: FaPersonRunning, couleur: "text-rose-400" },
};

const champ =
  "w-full rounded-md border border-bordure bg-zinc-950 px-2.5 py-1.5 text-sm text-white outline-none transition-colors focus:border-rose-500";

const nombreOuNull = (v: string) => (v.trim() === "" ? null : Number(v));

/**
 * Analyse d'une course disputée (offre Premium).
 *
 * L'athlète saisit ses temps par segment et raconte sa course ; le coach la
 * relit comme au débrief du lendemain : où le temps s'est perdu, ce qui a
 * marché, ce qu'il faut travailler. Les axes de progrès sont ensuite repris
 * dans les semaines générées.
 */
export function AnalyseCourseCard({ course, onAnalysee }: { course: Course; onAnalysee?: () => void }) {
  const { user } = useAuth();
  const [donnees, setDonnees] = useState<AnalyseCourseReponse | null>(null);
  const [saisie, setSaisie] = useState<ResultatCourse>(VIDE);
  const [fc, setFc] = useState({ natation: "", velo: "", course: "" });
  const [distances, setDistances] = useState({ natationM: "", veloKm: "", courseKm: "" });
  const [edition, setEdition] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<AnalyseCourseReponse>(`/races/${course.id}/analyse`)
      .then(({ data }) => {
        setDonnees(data);
        if (data.resultat) {
          setSaisie({ ...VIDE, ...data.resultat });
          setFc({
            natation: data.resultat.fcNatation ? String(data.resultat.fcNatation) : "",
            velo: data.resultat.fcVelo ? String(data.resultat.fcVelo) : "",
            course: data.resultat.fcCourse ? String(data.resultat.fcCourse) : "",
          });
        }
        setEdition(!data.analyse);
      })
      .catch(() => setEdition(true));
  }, [course.id]);

  /** Épreuve d'une seule discipline : un temps, une FC, pas de transitions. */
  const unique = course.discipline && course.discipline !== "triathlon" ? course.discipline : null;

  if (!user?.isPremium) {
    return (
      <div className="rounded-2xl border border-rose-900/50 bg-rose-950/20 p-4">
        <div className="mb-1 flex items-center gap-2">
          <FaCrown className="text-rose-400" size={13} />
          <h3 className="text-sm font-bold text-white">Analyse de course — offre Premium</h3>
        </div>
        <p className="mb-3 text-xs text-doux">
          Saisissez vos temps par segment : le coach relit votre course, repère où le temps s'est perdu et en tire
          vos axes de progrès, repris ensuite dans vos semaines d'entraînement.
        </p>
        <Link
          to="/abonnement"
          className="inline-block rounded-lg bg-rose-500 px-3 py-2 text-xs font-semibold text-black transition-colors hover:bg-rose-400"
        >
          Découvrir Premium
        </Link>
      </div>
    );
  }

  async function analyser(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const dist =
      !unique && course.format === "autre"
        ? {
            distances: Object.fromEntries(
              Object.entries(distances)
                .filter(([, v]) => v.trim() !== "")
                .map(([k, v]) => [k, Number(v.replace(",", "."))])
            ),
          }
        : {};
    try {
      const { data } = await api.post<AnalyseCourseReponse>(`/races/${course.id}/analyse`, {
        ...saisie,
        // Une seule discipline : son temps est le temps total.
        ...(unique ? { [unique]: saisie.total } : {}),
        ...dist,
        fcNatation: nombreOuNull(fc.natation),
        fcVelo: nombreOuNull(fc.velo),
        fcCourse: nombreOuNull(fc.course),
      });
      setDonnees(data);
      setEdition(false);
      onAnalysee?.();
    } catch (err) {
      setError(apiErrorMessage(err, "Analyse impossible."));
    } finally {
      setBusy(false);
    }
  }

  const { analyse, chiffres } = donnees ?? { analyse: null, chiffres: null };

  return (
    <div className="rounded-2xl border border-bordure bg-zinc-950/80 p-4">
      <div className="mb-1 flex items-center gap-2">
        <FaChartLine className="text-rose-400" size={13} />
        <h3 className="text-sm font-bold text-white">Analyse de course — {course.nom}</h3>
      </div>
      <p className="mb-3 text-xs text-doux">
        Le coach relit votre course segment par segment et en tire ce qu'il faut travailler.
      </p>

      {error && <p className="mb-2 text-sm text-red-400">{error}</p>}

      {edition ? (
        <form onSubmit={analyser} className="space-y-3">
          {unique ? (
            <div className="grid grid-cols-2 gap-2">
              <label className="block text-xs text-doux">
                Votre temps (h:mm:ss ou mm:ss)
                <input
                  required
                  value={saisie.total}
                  onChange={(e) => setSaisie({ ...saisie, total: e.target.value })}
                  placeholder="44:30"
                  inputMode="numeric"
                  className={`mt-0.5 ${champ}`}
                />
              </label>
              <label className="block text-xs text-doux">
                FC moyenne (bpm)
                <input
                  type="number"
                  min={80}
                  max={230}
                  value={fc[unique]}
                  onChange={(e) => setFc({ ...fc, [unique]: e.target.value })}
                  className={`mt-0.5 ${champ}`}
                />
              </label>
            </div>
          ) : (
          <>
          <div>
            <p className="mb-1.5 text-xs font-semibold text-zinc-300">Vos temps (h:mm:ss ou mm:ss)</p>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
              {SEGMENTS.map((s) => (
                <label key={s.cle} className="block text-xs text-doux">
                  {s.label}
                  <input
                    value={saisie[s.cle]}
                    onChange={(e) => setSaisie({ ...saisie, [s.cle]: e.target.value })}
                    placeholder={s.placeholder}
                    inputMode="numeric"
                    className={`mt-0.5 ${champ}`}
                  />
                </label>
              ))}
              <label className="block text-xs text-doux">
                Total
                <input
                  value={saisie.total}
                  onChange={(e) => setSaisie({ ...saisie, total: e.target.value })}
                  placeholder="2:35:10"
                  inputMode="numeric"
                  className={`mt-0.5 ${champ}`}
                />
              </label>
            </div>
          </div>

          {course.format === "autre" && (
            <div>
              <p className="mb-1.5 text-xs font-semibold text-zinc-300">Distances</p>
              <div className="grid grid-cols-3 gap-2">
                {(
                  [
                    ["natationM", "Natation (m)"],
                    ["veloKm", "Vélo (km)"],
                    ["courseKm", "Course (km)"],
                  ] as const
                ).map(([cle, label]) => (
                  <label key={cle} className="block text-xs text-doux">
                    {label}
                    <input
                      value={distances[cle]}
                      onChange={(e) => setDistances({ ...distances, [cle]: e.target.value })}
                      inputMode="decimal"
                      className={`mt-0.5 ${champ}`}
                    />
                  </label>
                ))}
              </div>
            </div>
          )}

          <div>
            <p className="mb-1.5 text-xs font-semibold text-zinc-300">FC moyenne par discipline (facultatif)</p>
            <div className="grid grid-cols-3 gap-2">
              {(["natation", "velo", "course"] as const).map((cle) => (
                <label key={cle} className="block text-xs text-doux">
                  {SEGMENTS.find((s) => s.cle === cle)?.label} (bpm)
                  <input
                    type="number"
                    min={80}
                    max={230}
                    value={fc[cle]}
                    onChange={(e) => setFc({ ...fc, [cle]: e.target.value })}
                    className={`mt-0.5 ${champ}`}
                  />
                </label>
              ))}
            </div>
          </div>
          </>
          )}

          <div className="grid grid-cols-2 gap-2">
            <label className="block text-xs text-doux">
              Classement général
              <input
                value={saisie.classementGeneral}
                onChange={(e) => setSaisie({ ...saisie, classementGeneral: e.target.value })}
                placeholder="152 / 840"
                className={`mt-0.5 ${champ}`}
              />
            </label>
            <label className="block text-xs text-doux">
              Classement catégorie
              <input
                value={saisie.classementCategorie}
                onChange={(e) => setSaisie({ ...saisie, classementCategorie: e.target.value })}
                placeholder="12 / 95"
                className={`mt-0.5 ${champ}`}
              />
            </label>
          </div>

          <label className="block text-xs text-doux">
            Conditions
            <input
              value={saisie.conditions}
              onChange={(e) => setSaisie({ ...saisie, conditions: e.target.value })}
              placeholder="Chaleur, vent, eau à 17 °C, parcours vallonné..."
              maxLength={300}
              className={`mt-0.5 ${champ}`}
            />
          </label>

          <label className="block text-xs text-doux">
            Comment s'est passée votre course ?
            <textarea
              value={saisie.ressenti}
              onChange={(e) => setSaisie({ ...saisie, ressenti: e.target.value })}
              placeholder="Sensations, ce que vous avez mangé et bu, incidents (crampes, crevaison, coup de fatigue)..."
              rows={3}
              maxLength={1500}
              className={`mt-0.5 ${champ}`}
            />
          </label>

          <button
            type="submit"
            disabled={busy}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-rose-500 px-3 py-2.5 text-sm font-semibold text-black transition-colors hover:bg-rose-400 disabled:opacity-50"
          >
            {busy && <Spinner className="border-black/30 border-t-black" />}
            {busy ? "Analyse en cours..." : "Analyser ma course"}
          </button>
        </form>
      ) : analyse ? (
        <div className="space-y-2.5">
          <p className="rounded-xl border border-rose-900/40 bg-rose-950/20 px-3 py-2.5 text-sm text-rose-100">
            {analyse.resume}
          </p>

          {chiffres && chiffres.segments.length > 0 && (
            <div className="overflow-x-auto rounded-xl border border-bordure">
              <table className="w-full text-xs">
                <tbody>
                  {chiffres.segments.map((s) => (
                    <tr key={s.segment} className="border-b border-bordure/60 last:border-0">
                      <td className="px-3 py-1.5 font-semibold text-zinc-300">{s.libelle}</td>
                      <td className="px-2 py-1.5 tabular-nums text-white">{s.duree}</td>
                      <td className="px-2 py-1.5 tabular-nums text-doux">{s.allure ?? ""}</td>
                      <td className="px-2 py-1.5 tabular-nums text-doux">{s.fcMoyenne ? `${s.fcMoyenne} bpm` : ""}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-tres-doux">
                        {s.part !== null ? `${s.part} %` : ""}
                      </td>
                    </tr>
                  ))}
                  {chiffres.total && (
                    <tr>
                      <td className="px-3 py-1.5 font-bold text-white">Total</td>
                      <td className="px-2 py-1.5 font-bold tabular-nums text-white">{chiffres.total}</td>
                      <td colSpan={3} className="px-3 py-1.5 text-right text-doux">
                        {chiffres.ecartObjectifS !== null &&
                          (chiffres.ecartObjectifS > 0
                            ? `${Math.round(chiffres.ecartObjectifS / 60)} min au-dessus de l'objectif`
                            : `${Math.round(-chiffres.ecartObjectifS / 60)} min sous l'objectif`)}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {analyse.segments.map((s) => {
            const icone = ICONES[s.segment];
            return (
              <div key={s.segment} className="rounded-xl border border-bordure bg-zinc-900/40 p-3">
                <h4 className="mb-1 flex items-center gap-2 text-sm font-bold text-white">
                  {icone ? <icone.Icon className={icone.couleur} size={13} /> : <FaArrowsRotate className="text-doux" size={11} />}
                  {SEGMENTS.find((x) => x.cle === s.segment)?.label}
                </h4>
                <p className="text-xs text-doux">{s.constat}</p>
                <p className="mt-1 text-xs text-emerald-300/90">→ {s.conseil}</p>
              </div>
            );
          })}

          {analyse.pointsForts.length > 0 && (
            <div className="rounded-xl border border-emerald-900/40 bg-emerald-950/20 p-3">
              <h4 className="mb-1.5 text-xs font-bold uppercase tracking-wide text-emerald-300">Points forts</h4>
              <ul className="space-y-1">
                {analyse.pointsForts.map((p) => (
                  <li key={p} className="text-xs text-emerald-100/90">
                    · {p}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="rounded-xl border border-amber-900/40 bg-amber-950/20 p-3">
            <h4 className="mb-1.5 text-xs font-bold uppercase tracking-wide text-amber-300">Axes de progrès</h4>
            <ol className="space-y-2">
              {analyse.axesProgres.map((a) => (
                <li key={a.titre} className="text-xs">
                  <p className="font-semibold text-amber-100">{a.titre}</p>
                  <p className="text-doux">{a.pourquoi}</p>
                  <p className="text-amber-200/80">À l'entraînement : {a.travail}</p>
                </li>
              ))}
            </ol>
            <p className="mt-2 text-[11px] text-tres-doux">
              Ces axes sont repris dans les semaines que votre coach génère.
            </p>
          </div>

          <div className="rounded-xl border border-bordure bg-zinc-900/40 p-3">
            <h4 className="mb-1 text-xs font-bold uppercase tracking-wide text-doux">Pour la prochaine course</h4>
            <p className="text-xs text-doux">{analyse.prochaineCourse}</p>
          </div>

          <button
            onClick={() => setEdition(true)}
            className="text-xs font-semibold text-rose-300 underline-offset-2 hover:underline"
          >
            Modifier mes temps et refaire l'analyse
          </button>
        </div>
      ) : (
        <p className="flex items-center gap-2 text-sm text-doux">
          <Spinner /> Chargement...
        </p>
      )}
    </div>
  );
}
