import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api, apiErrorMessage, type AthleteProfile, type Disponibilites, type Materiel } from "../lib/api";
import { CreneauxForm } from "../components/CreneauxForm";
import { MaterielForm, MATERIEL_PAR_DEFAUT } from "../components/MaterielForm";
import { Spinner } from "../components/Spinner";
import { CalendrierCourses } from "../components/CalendrierCourses";

const DISCIPLINES = [
  { key: "tempsNatation", icon: "🏊", label: "Natation", placeholder: "Ex : 1500m nage libre en 28min" },
  { key: "tempsVelo", icon: "🚴", label: "Vélo", placeholder: "Ex : 40km en 1h10" },
  { key: "tempsCourse", icon: "🏃", label: "Course à pied", placeholder: "Ex : 10km en 45min" },
] as const;

type DisciplineKey = (typeof DISCIPLINES)[number]["key"];

/** "4:10" ou "4:10/km" → 250 secondes. Renvoie null si la saisie est vide. */
function allureVersSecondes(saisie: string): number | null {
  const propre = saisie.trim().replace(/\/(km|100m)$/i, "");
  if (propre === "") return null;
  const match = propre.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function secondesVersAllure(secondes: number): string {
  const m = Math.floor(secondes / 60);
  const s = secondes % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function Objectif() {
  const [loaded, setLoaded] = useState(false);
  const [objectif, setObjectif] = useState("");
  const [objectifDate, setObjectifDate] = useState("");
  const [temps, setTemps] = useState<Record<DisciplineKey, string>>({
    tempsNatation: "",
    tempsVelo: "",
    tempsCourse: "",
  });
  const [heuresSemaine, setHeuresSemaine] = useState(6);
  const [disponibilites, setDisponibilites] = useState<Disponibilites>({});
  const [materiel, setMateriel] = useState<Materiel>(MATERIEL_PAR_DEFAUT);
  const [contraintes, setContraintes] = useState("");
  const [ftpWatts, setFtpWatts] = useState("");
  // Valeurs de seuil : saisies en texte lisible, converties en secondes pour l'API.
  const [seuilCourse, setSeuilCourse] = useState("");
  const [css, setCss] = useState("");
  const [fcSeuil, setFcSeuil] = useState("");
  const [fcMax, setFcMax] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(false);

  // Extraite de l'effet : le calendrier de courses pilote l'objectif du profil,
  // et doit pouvoir demander son rechargement après une modification.
  const load = useCallback(() => {
    return api.get<AthleteProfile | null>("/profile").then(({ data }) => {
      if (data) {
        setObjectif(data.objectif);
        setObjectifDate(data.objectifDate.slice(0, 10));
        setTemps({
          tempsNatation: data.tempsNatation,
          tempsVelo: data.tempsVelo,
          tempsCourse: data.tempsCourse,
        });
        setHeuresSemaine(data.heuresSemaine);
        setDisponibilites(data.disponibilites ?? {});
        setMateriel(data.materiel ?? MATERIEL_PAR_DEFAUT);
        setContraintes(data.contraintes);
        setFtpWatts(data.ftpWatts ? String(data.ftpWatts) : "");
        setSeuilCourse(data.seuilCourseSecParKm ? secondesVersAllure(data.seuilCourseSecParKm) : "");
        setCss(data.cssSecPer100m ? secondesVersAllure(data.cssSecPer100m) : "");
        setFcSeuil(data.fcSeuil ? String(data.fcSeuil) : "");
        setFcMax(data.fcMax ? String(data.fcMax) : "");
      }
      setLoaded(true);
    });
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    setLoading(true);
    try {
      await api.put("/profile", {
        objectif,
        objectifDate,
        ...temps,
        heuresSemaine,
        contraintes,
        disponibilites: Object.keys(disponibilites).length > 0 ? disponibilites : null,
        materiel,
        ftpWatts: ftpWatts.trim() === "" ? null : Number(ftpWatts),
        seuilCourseSecParKm: allureVersSecondes(seuilCourse),
        cssSecPer100m: allureVersSecondes(css),
        fcSeuil: fcSeuil.trim() === "" ? null : Number(fcSeuil),
        fcMax: fcMax.trim() === "" ? null : Number(fcMax),
      });
      setSaved(true);
    } catch (err) {
      setError(apiErrorMessage(err, "Impossible d'enregistrer votre profil."));
    } finally {
      setLoading(false);
    }
  }

  if (!loaded) {
    return (
      <p className="flex items-center gap-2 text-zinc-500">
        <Spinner /> Chargement...
      </p>
    );
  }

  return (
    <div>
      <h1 className="mb-1 text-xl font-bold text-white">Mon objectif</h1>
      <p className="mb-4 text-sm text-zinc-400">
        Modifiez votre objectif ou vos informations à tout moment. Votre historique et vos progrès déjà enregistrés
        restent intacts.
      </p>

      <div className="mb-4">
        <CalendrierCourses onChange={load} />
      </div>

      <form onSubmit={handleSubmit} className="animate-fade-in-up space-y-4 rounded-2xl border border-zinc-800 bg-zinc-950/80 p-4 shadow-2xl shadow-black/50 sm:p-5">
        {error && <p className="rounded-md border border-red-900 bg-red-950/50 px-3 py-2 text-sm text-red-400">{error}</p>}
        {saved && (
          <p className="rounded-md border border-emerald-900 bg-emerald-950/40 px-3 py-2 text-sm text-emerald-300">
            ✓ Profil mis à jour. Générez ou régénérez votre programme depuis l'onglet Programme pour qu'il tienne
            compte du changement.
          </p>
        )}

        <div className="space-y-1">
          <label className="text-sm text-zinc-300">Objectif à venir</label>
          <input
            required
            placeholder="Ex : Half Ironman de Nice, distance M, marathon..."
            value={objectif}
            onChange={(e) => setObjectif(e.target.value)}
            className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-white outline-none transition-colors focus:border-rose-500"
          />
        </div>

        <div className="space-y-1">
          <label className="text-sm text-zinc-300">Date de cet objectif</label>
          <input
            type="date"
            required
            value={objectifDate}
            onChange={(e) => setObjectifDate(e.target.value)}
            className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-white outline-none transition-colors focus:border-rose-500"
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm text-zinc-300">Temps de référence, par discipline (facultatif)</label>
          <div className="grid gap-3 sm:grid-cols-3">
            {DISCIPLINES.map((d) => (
              <div
                key={d.key}
                className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3 transition-colors duration-200 hover:border-rose-800/60 hover:bg-zinc-900"
              >
                <p className="mb-2 text-sm font-medium text-white">
                  <span className="mr-1">{d.icon}</span>
                  {d.label}
                </p>
                <input
                  placeholder={d.placeholder}
                  value={temps[d.key]}
                  onChange={(e) => setTemps((prev) => ({ ...prev, [d.key]: e.target.value }))}
                  className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-sm text-white outline-none transition-colors focus:border-rose-500"
                />
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-3">
          <CreneauxForm valeur={disponibilites} onChange={setDisponibilites} />
        </div>

        <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-3">
          <MaterielForm valeur={materiel} onChange={setMateriel} />
        </div>

        <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-3">
          <p className="text-sm font-medium text-white">Vos valeurs de seuil (facultatif)</p>
          <p className="mt-0.5 mb-3 text-xs text-zinc-500">
            Si vous les connaissez, elles remplacent l'estimation faite à partir de vos temps de référence — et vos
            zones deviennent exactes plutôt qu'approchées.
          </p>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <label className="text-xs text-zinc-400">Allure au seuil en course (min:s par km)</label>
              <input
                placeholder="Ex : 4:10"
                value={seuilCourse}
                onChange={(e) => setSeuilCourse(e.target.value)}
                className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-white outline-none transition-colors focus:border-rose-500"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs text-zinc-400">CSS natation (min:s aux 100 m)</label>
              <input
                placeholder="Ex : 1:45"
                value={css}
                onChange={(e) => setCss(e.target.value)}
                className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-white outline-none transition-colors focus:border-rose-500"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs text-zinc-400">FC au seuil (bpm)</label>
              <input
                type="number"
                min={100}
                max={220}
                placeholder="Ex : 168"
                value={fcSeuil}
                onChange={(e) => setFcSeuil(e.target.value)}
                className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-white outline-none transition-colors focus:border-rose-500"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs text-zinc-400">FC maximale (bpm)</label>
              <input
                type="number"
                min={120}
                max={230}
                placeholder="Ex : 188"
                value={fcMax}
                onChange={(e) => setFcMax(e.target.value)}
                className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-white outline-none transition-colors focus:border-rose-500"
              />
            </div>
          </div>
          <p className="mt-2 text-xs text-zinc-600">
            Sans FC au seuil, elle est estimée à 92 % de votre FC max. Si vous ne renseignez pas non plus votre FC
            max, elle est déduite de vos séances importées.
          </p>
        </div>

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
            className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-white outline-none transition-colors focus:border-rose-500"
          />
          <p className="text-xs text-zinc-500">
            Si vous la connaissez, vos zones vélo seront exprimées en puissance plutôt qu'estimées à partir de votre
            vitesse.
          </p>
        </div>

        <div className="space-y-1">
          <label className="text-sm text-zinc-300">Heures disponibles pour vous entraîner par semaine</label>
          <input
            type="number"
            required
            min={1}
            max={30}
            step={0.5}
            value={heuresSemaine}
            onChange={(e) => setHeuresSemaine(Number(e.target.value))}
            className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-white outline-none transition-colors focus:border-rose-500"
          />
        </div>

        <div className="space-y-1">
          <label className="text-sm text-zinc-300">Blessures ou contraintes particulières (facultatif)</label>
          <textarea
            placeholder="Ex : douleur au genou droit, pas de piscine le week-end, déplacement pro semaine prochaine..."
            value={contraintes}
            onChange={(e) => setContraintes(e.target.value)}
            rows={3}
            className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-white outline-none transition-colors focus:border-rose-500"
          />
        </div>

        <div className="flex gap-2">
          <button
            type="submit"
            disabled={loading}
            className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-rose-500 px-3 py-2.5 text-sm font-semibold text-black transition-all duration-150 hover:scale-[1.01] hover:bg-rose-400 active:scale-[0.99] disabled:opacity-50 disabled:hover:scale-100"
          >
            {loading && <Spinner className="border-black/30 border-t-black" />}
            {loading ? "Enregistrement..." : "Enregistrer"}
          </button>
          <Link
            to="/dashboard"
            className="flex items-center justify-center rounded-lg border border-zinc-800 px-4 py-2.5 text-sm font-semibold text-zinc-300 transition-colors hover:bg-zinc-900"
          >
            Retour
          </Link>
        </div>
      </form>
    </div>
  );
}
