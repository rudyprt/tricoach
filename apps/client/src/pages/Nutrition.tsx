import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { FaDroplet, FaTrash, FaUtensils } from "react-icons/fa6";
import { api, apiErrorMessage, type FormatRavito, type NutritionResume, type ProfilNutrition } from "../lib/api";
import { useAuth } from "../lib/AuthContext";
import { Spinner } from "../components/Spinner";

const FORMATS: { valeur: FormatRavito; label: string }[] = [
  { valeur: "boisson", label: "Boisson d'effort" },
  { valeur: "gel", label: "Gels" },
  { valeur: "barre", label: "Barres" },
  { valeur: "solide", label: "Aliments (banane, pâte de fruits)" },
];

const SPORTS = [
  { valeur: "velo", label: "Vélo" },
  { valeur: "course", label: "Course à pied" },
  { valeur: "natation", label: "Natation" },
] as const;

const champ =
  "mt-0.5 w-full rounded-lg border border-bordure bg-zinc-900 px-3 py-2 text-sm text-white outline-none focus:border-amber-500";

/**
 * Nutrition autour de l'effort (offre Premium).
 *
 * Chaque information affine les doses calculées pour chaque séance : le poids
 * pour les grammes par kilo, le test de sudation pour la boisson et le sodium,
 * le journal pour les glucides que l'estomac accepte.
 */
export function Nutrition() {
  const { user } = useAuth();
  const [donnees, setDonnees] = useState<NutritionResume | null>(null);
  const [profil, setProfil] = useState<ProfilNutrition>({ poidsKg: null, formats: [], cafeine: false, sueurSalee: false });
  const [poids, setPoids] = useState("");
  const [test, setTest] = useState({
    date: new Date().toLocaleDateString("fr-CA"),
    sport: "velo" as (typeof SPORTS)[number]["valeur"],
    dureeMin: "60",
    poidsAvantKg: "",
    poidsApresKg: "",
    boissonMl: "",
    temperatureC: "",
  });
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function charger() {
    const { data } = await api.get<NutritionResume>("/nutrition");
    setDonnees(data);
    setProfil(data.profil);
    setPoids(data.profil.poidsKg ? String(data.profil.poidsKg) : "");
  }

  useEffect(() => {
    if (user?.isPremium) void charger().catch(() => setError("Chargement impossible."));
  }, [user?.isPremium]);

  if (!user?.isPremium) {
    return (
      <div className="rounded-2xl border border-amber-900/40 bg-amber-950/10 p-5">
        <h1 className="mb-1 text-xl font-bold text-white">Nutrition</h1>
        <p className="mb-3 text-sm text-doux">
          Quoi manger et boire avant, pendant et après chaque séance, dosé selon votre poids, votre sudation mesurée
          et ce que votre estomac tolère — et un entraînement digestif à l'approche de vos courses longues.
        </p>
        <Link
          to="/abonnement"
          className="inline-block rounded-lg bg-amber-500 px-3 py-2 text-sm font-semibold text-black hover:bg-amber-400"
        >
          Découvrir l'offre Premium
        </Link>
      </div>
    );
  }

  if (!donnees) {
    return (
      <p className="flex items-center gap-2 text-doux">
        <Spinner /> Chargement...
      </p>
    );
  }

  async function enregistrerProfil(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    try {
      await api.put("/nutrition/profil", { ...profil, poidsKg: poids.trim() ? Number(poids.replace(",", ".")) : null });
      await charger();
      setMessage("Préférences enregistrées.");
    } catch (err) {
      setError(apiErrorMessage(err, "Enregistrement impossible."));
    }
  }

  async function ajouterTest(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    const nombre = (v: string) => Number(v.replace(",", "."));
    try {
      const { data } = await api.post<{ tauxMlH: number }>("/nutrition/tests-sudation", {
        date: test.date,
        sport: test.sport,
        dureeMin: nombre(test.dureeMin),
        poidsAvantKg: nombre(test.poidsAvantKg),
        poidsApresKg: nombre(test.poidsApresKg),
        boissonMl: test.boissonMl.trim() ? nombre(test.boissonMl) : 0,
        temperatureC: test.temperatureC.trim() ? nombre(test.temperatureC) : null,
      });
      setTest({ ...test, poidsAvantKg: "", poidsApresKg: "", boissonMl: "", temperatureC: "" });
      await charger();
      setMessage(`Test enregistré : vous perdez environ ${data.tauxMlH} ml de sueur par heure.`);
    } catch (err) {
      setError(apiErrorMessage(err, "Test invalide."));
    }
  }

  async function supprimerTest(id: string) {
    await api.delete(`/nutrition/tests-sudation/${id}`);
    await charger();
  }

  const s = donnees.sudation;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="mb-1 text-xl font-bold text-white">Nutrition</h1>
        <p className="text-sm text-doux">
          Chaque séance affiche son ravitaillement. Plus vous en dites ici, plus les doses sont les vôtres.
        </p>
      </div>

      {message && <p className="rounded-lg border border-emerald-900 bg-emerald-950/40 px-3 py-2 text-sm text-emerald-300">{message}</p>}
      {error && <p className="rounded-lg border border-red-900 bg-red-950/40 px-3 py-2 text-sm text-red-400">{error}</p>}

      <div className="grid gap-2 sm:grid-cols-3">
        <div className="rounded-xl border border-bordure bg-zinc-950/80 p-3">
          <p className="text-xs text-doux">Sudation mesurée</p>
          <p className="text-lg font-bold text-white">{s.global ? `${s.global} ml/h` : "—"}</p>
          {(s.velo || s.course) && (
            <p className="text-[11px] text-tres-doux">
              {[s.velo && `vélo ${s.velo}`, s.course && `course ${s.course}`, s.natation && `natation ${s.natation}`]
                .filter(Boolean)
                .join(" · ")}
            </p>
          )}
        </div>
        <div className="rounded-xl border border-bordure bg-zinc-950/80 p-3">
          <p className="text-xs text-doux">Glucides bien tolérés</p>
          <p className="text-lg font-bold text-white">{donnees.toleranceGH ? `${donnees.toleranceGH} g/h` : "—"}</p>
          <p className="text-[11px] text-tres-doux">D'après le journal de vos séances longues.</p>
        </div>
        <div className="rounded-xl border border-bordure bg-zinc-950/80 p-3">
          <p className="text-xs text-doux">Troubles à partir de</p>
          <p className="text-lg font-bold text-white">{donnees.limiteGH ? `${donnees.limiteGH} g/h` : "—"}</p>
          <p className="text-[11px] text-tres-doux">Les doses restent en dessous.</p>
        </div>
      </div>

      <form onSubmit={enregistrerProfil} className="space-y-3 rounded-2xl border border-bordure bg-zinc-950/80 p-4">
        <h2 className="flex items-center gap-2 text-sm font-bold text-white">
          <FaUtensils className="text-amber-400" size={13} /> Vos préférences
        </h2>
        <label className="block text-xs text-doux">
          Poids (kg) — pour doser glucides, protéines et caféine
          <input value={poids} onChange={(e) => setPoids(e.target.value)} inputMode="decimal" placeholder="70" className={champ} />
        </label>
        <div>
          <p className="mb-1 text-xs text-doux">Ce que vous prenez à l'effort</p>
          <div className="flex flex-wrap gap-1.5">
            {FORMATS.map((f) => {
              const actif = profil.formats.includes(f.valeur);
              return (
                <button
                  key={f.valeur}
                  type="button"
                  aria-pressed={actif}
                  onClick={() =>
                    setProfil({
                      ...profil,
                      formats: actif ? profil.formats.filter((x) => x !== f.valeur) : [...profil.formats, f.valeur],
                    })
                  }
                  className={`rounded-full border px-2.5 py-1 text-xs ${
                    actif ? "border-amber-500 bg-amber-950/50 text-amber-100" : "border-bordure text-doux"
                  }`}
                >
                  {f.label}
                </button>
              );
            })}
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm text-zinc-300">
          <input type="checkbox" checked={profil.cafeine} onChange={(e) => setProfil({ ...profil, cafeine: e.target.checked })} />
          Je consomme de la caféine avant l'effort
        </label>
        <label className="flex items-center gap-2 text-sm text-zinc-300">
          <input
            type="checkbox"
            checked={profil.sueurSalee}
            onChange={(e) => setProfil({ ...profil, sueurSalee: e.target.checked })}
          />
          Ma sueur est salée (traces blanches sur les vêtements)
        </label>
        <button type="submit" className="rounded-lg bg-amber-500 px-3 py-2 text-sm font-semibold text-black hover:bg-amber-400">
          Enregistrer
        </button>
      </form>

      <form onSubmit={ajouterTest} className="space-y-3 rounded-2xl border border-bordure bg-zinc-950/80 p-4">
        <h2 className="flex items-center gap-2 text-sm font-bold text-white">
          <FaDroplet className="text-sky-400" size={13} /> Test de sudation
        </h2>
        <p className="text-xs text-doux">
          Pesez-vous nu juste avant et juste après une séance d'au moins une heure, à allure habituelle, en notant ce que
          vous avez bu. Refaites-le par temps chaud et par temps frais : vos besoins changent.
        </p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <label className="block text-xs text-doux">
            Date
            <input type="date" required value={test.date} onChange={(e) => setTest({ ...test, date: e.target.value })} className={champ} />
          </label>
          <label className="block text-xs text-doux">
            Sport
            <select
              value={test.sport}
              onChange={(e) => setTest({ ...test, sport: e.target.value as typeof test.sport })}
              className={champ}
            >
              {SPORTS.map((sp) => (
                <option key={sp.valeur} value={sp.valeur}>
                  {sp.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs text-doux">
            Durée (min)
            <input required inputMode="numeric" value={test.dureeMin} onChange={(e) => setTest({ ...test, dureeMin: e.target.value })} className={champ} />
          </label>
          <label className="block text-xs text-doux">
            Température (°C)
            <input inputMode="numeric" value={test.temperatureC} onChange={(e) => setTest({ ...test, temperatureC: e.target.value })} className={champ} />
          </label>
          <label className="block text-xs text-doux">
            Poids avant (kg)
            <input required inputMode="decimal" value={test.poidsAvantKg} onChange={(e) => setTest({ ...test, poidsAvantKg: e.target.value })} className={champ} />
          </label>
          <label className="block text-xs text-doux">
            Poids après (kg)
            <input required inputMode="decimal" value={test.poidsApresKg} onChange={(e) => setTest({ ...test, poidsApresKg: e.target.value })} className={champ} />
          </label>
          <label className="block text-xs text-doux">
            Boisson bue (ml)
            <input inputMode="numeric" value={test.boissonMl} onChange={(e) => setTest({ ...test, boissonMl: e.target.value })} className={champ} />
          </label>
        </div>
        <button type="submit" className="rounded-lg bg-sky-500 px-3 py-2 text-sm font-semibold text-black hover:bg-sky-400">
          Calculer ma sudation
        </button>

        {donnees.tests.length > 0 && (
          <ul className="space-y-1 border-t border-white/10 pt-3">
            {donnees.tests.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-2 text-xs text-doux">
                <span>
                  {t.date} · {SPORTS.find((sp) => sp.valeur === t.sport)?.label} · {t.dureeMin} min
                  {t.temperatureC != null ? ` · ${t.temperatureC} °C` : ""} ·{" "}
                  <span className="font-semibold text-white">{t.tauxMlH} ml/h</span>
                </span>
                <button
                  type="button"
                  onClick={() => void supprimerTest(t.id)}
                  aria-label={`Supprimer le test du ${t.date}`}
                  className="p-1 text-tres-doux hover:text-red-400"
                >
                  <FaTrash size={10} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </form>

      <p className="text-[11px] text-tres-doux">
        Ces repères concernent le carburant de l'entraînement et de la course. Ils ne remplacent pas l'avis d'un
        médecin ou d'un diététicien, en particulier en cas de pathologie, d'allergie ou de trouble alimentaire.
      </p>
    </div>
  );
}
