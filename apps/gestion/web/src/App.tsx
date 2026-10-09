import { useCallback, useEffect, useState } from "react";
import { api, NonConnecte, type Tableau } from "./api";
import { Connexion } from "./pages/Connexion";
import { VueEnsemble } from "./pages/VueEnsemble";
import { MoisParMois } from "./pages/MoisParMois";
import { Charges } from "./pages/Charges";
import { Encaissements } from "./pages/Encaissements";
import { Urssaf } from "./pages/Urssaf";
import { ParametresPage } from "./pages/Parametres";

const ONGLETS = [
  { id: "vue", libelle: "Vue d'ensemble" },
  { id: "mois", libelle: "Mois par mois" },
  { id: "charges", libelle: "Charges" },
  { id: "encaissements", libelle: "Encaissements" },
  { id: "urssaf", libelle: "URSSAF" },
  { id: "parametres", libelle: "Paramètres" },
] as const;
type Onglet = (typeof ONGLETS)[number]["id"];

/** Actualisation automatique : toutes les 30 s tant que la page est visible. */
const INTERVALLE_MS = 30_000;

function ongletDepuisUrl(): Onglet {
  const h = window.location.hash.slice(1);
  return (ONGLETS.find((o) => o.id === h)?.id ?? "vue") as Onglet;
}

export function App() {
  const [connecte, setConnecte] = useState<boolean | null>(null);
  const [onglet, setOnglet] = useState<Onglet>(ongletDepuisUrl);
  const [annee, setAnnee] = useState(() => new Date().getFullYear());
  const [tableau, setTableau] = useState<Tableau | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [maintenant, setMaintenant] = useState(Date.now());

  const charger = useCallback(async () => {
    try {
      const t = await api<Tableau>(`/tableau?annee=${annee}`);
      setTableau(t);
      setConnecte(true);
      setErreur(null);
    } catch (e) {
      if (e instanceof NonConnecte) setConnecte(false);
      else setErreur(e instanceof Error ? e.message : "Erreur inattendue.");
    }
  }, [annee]);

  useEffect(() => {
    void charger();
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") void charger();
    }, INTERVALLE_MS);
    const auRetour = () => {
      if (document.visibilityState === "visible") void charger();
    };
    document.addEventListener("visibilitychange", auRetour);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", auRetour);
    };
  }, [charger]);

  useEffect(() => {
    const id = window.setInterval(() => setMaintenant(Date.now()), 5_000);
    const surHash = () => setOnglet(ongletDepuisUrl());
    window.addEventListener("hashchange", surHash);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("hashchange", surHash);
    };
  }, []);

  if (connecte === false) return <Connexion onConnecte={() => void charger()} />;
  if (!tableau) {
    return (
      <main className="grid min-h-dvh place-items-center p-4 text-doux">
        {erreur ? <p className="text-danger">{erreur}</p> : <p>Chargement…</p>}
      </main>
    );
  }

  const age = Math.max(0, Math.round((maintenant - new Date(tableau.genereLe).getTime()) / 1000));
  const anneeCourante = Number(tableau.aujourdhui.slice(0, 4));

  async function deconnexion() {
    await api("/deconnexion", { method: "POST" }).catch(() => undefined);
    setConnecte(false);
    setTableau(null);
  }

  return (
    <div className="mx-auto min-h-dvh max-w-6xl px-4 pb-16" style={{ paddingTop: "max(env(safe-area-inset-top), 1rem)" }}>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold">TriCoach <span className="text-accent">Gestion</span></h1>
          <p className="text-xs text-tres-doux" aria-live="polite">
            <span className="mr-1 inline-block h-2 w-2 rounded-full bg-succes align-middle" aria-hidden />
            En direct · mis à jour il y a {age < 5 ? "quelques secondes" : `${age} s`}
            {erreur && <span className="ml-2 text-danger">· dernière actualisation échouée</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="sr-only" htmlFor="annee">Exercice</label>
          <select
            id="annee"
            value={annee}
            onChange={(e) => setAnnee(Number(e.target.value))}
            className="min-h-11 rounded-xl border border-bordure-forte bg-surface px-3 text-sm"
          >
            {[anneeCourante + 1, anneeCourante, anneeCourante - 1, anneeCourante - 2].map((a) => (
              <option key={a} value={a}>Exercice {a}</option>
            ))}
          </select>
          <button onClick={() => void deconnexion()} className="min-h-11 rounded-xl px-3 text-sm text-doux hover:text-fort">
            Déconnexion
          </button>
        </div>
      </header>

      <nav className="-mx-4 mt-4 overflow-x-auto px-4" aria-label="Sections">
        <ul className="flex gap-1 border-b border-bordure">
          {ONGLETS.map((o) => (
            <li key={o.id}>
              <a
                href={`#${o.id}`}
                aria-current={onglet === o.id ? "page" : undefined}
                className={`block min-h-11 whitespace-nowrap border-b-2 px-3 pt-3 text-sm font-medium ${
                  onglet === o.id ? "border-accent text-fort" : "border-transparent text-doux hover:text-fort"
                }`}
              >
                {o.libelle}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <main className="mt-5">
        {onglet === "vue" && <VueEnsemble t={tableau} />}
        {onglet === "mois" && <MoisParMois t={tableau} />}
        {onglet === "charges" && <Charges onChange={charger} />}
        {onglet === "encaissements" && <Encaissements t={tableau} onChange={charger} />}
        {onglet === "urssaf" && <Urssaf t={tableau} />}
        {onglet === "parametres" && <ParametresPage onChange={charger} />}
      </main>
    </div>
  );
}
