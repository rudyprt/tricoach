import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, type ChargeLigne } from "../api";
import { CATEGORIES, centsVersSaisie, dateFr, euros, versCents } from "../format";
import { Bouton, Carte, Champ, Erreur, classeSaisie } from "../ui";

const FREQUENCES = { mensuelle: "Chaque mois", annuelle: "Chaque année", ponctuelle: "Une fois" } as const;
type Frequence = keyof typeof FREQUENCES;

interface Brouillon {
  id?: string;
  libelle: string;
  categorie: string;
  montant: string;
  frequence: Frequence;
  debut: string;
  fin: string;
  notes: string;
}

const aujourdhui = () => new Date().toISOString().slice(0, 10);
const vide = (): Brouillon => ({ libelle: "", categorie: "hebergement", montant: "", frequence: "mensuelle", debut: aujourdhui(), fin: "", notes: "" });

/** Pour démarrer vite : les postes habituels d'une application comme TriCoach. */
const SUGGESTIONS: { libelle: string; categorie: string; frequence: Frequence }[] = [
  { libelle: "Render (hébergement)", categorie: "hebergement", frequence: "mensuelle" },
  { libelle: "Neon (base Postgres)", categorie: "base_de_donnees", frequence: "mensuelle" },
  { libelle: "Nom de domaine", categorie: "domaine", frequence: "annuelle" },
  { libelle: "Brevo (e-mails)", categorie: "email", frequence: "mensuelle" },
  { libelle: "Abonnement Claude", categorie: "ia", frequence: "mensuelle" },
  { libelle: "Compte bancaire pro", categorie: "banque", frequence: "mensuelle" },
];

export function Charges({ onChange }: { onChange: () => Promise<void> }) {
  const [lignes, setLignes] = useState<ChargeLigne[] | null>(null);
  const [b, setB] = useState<Brouillon | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  const charger = useCallback(async () => {
    setLignes(await api<ChargeLigne[]>("/charges"));
  }, []);
  useEffect(() => {
    void charger().catch((e: Error) => setErreur(e.message));
  }, [charger]);

  async function enregistrer(e: FormEvent) {
    e.preventDefault();
    if (!b) return;
    const montantCents = versCents(b.montant);
    if (montantCents === null || montantCents < 0) return setErreur("Montant invalide (ex. 7,00).");
    const corps = {
      libelle: b.libelle,
      categorie: b.categorie,
      montantCents,
      frequence: b.frequence,
      debut: b.debut,
      fin: b.frequence === "ponctuelle" || !b.fin ? null : b.fin,
      notes: b.notes || null,
    };
    try {
      await api(b.id ? `/charges/${b.id}` : "/charges", { method: b.id ? "PUT" : "POST", body: corps });
      setB(null);
      setErreur(null);
      await Promise.all([charger(), onChange()]);
    } catch (err) {
      setErreur(err instanceof Error ? err.message : "Enregistrement impossible.");
    }
  }

  async function supprimer(c: ChargeLigne) {
    if (!window.confirm(`Supprimer « ${c.libelle} » ? Elle disparaîtra aussi des mois passés.`)) return;
    await api(`/charges/${c.id}`, { method: "DELETE" });
    await Promise.all([charger(), onChange()]);
  }

  const mensuelTotal = (lignes ?? [])
    .filter((c) => c.frequence !== "ponctuelle" && (!c.fin || c.fin >= aujourdhui()))
    .reduce((s, c) => s + (c.frequence === "mensuelle" ? c.montantCents : c.montantCents / 12), 0);

  return (
    <div className="space-y-4">
      <Carte
        titre="Charges de l'activité"
        action={!b && <Bouton onClick={() => setB(vide())}>+ Ajouter</Bouton>}
      >
        <p className="text-sm text-doux">
          Charges fixes actives : <strong className="text-fort">{euros(Math.round(mensuelTotal))} / mois</strong> en moyenne (annuelles lissées).
          Le coût de l'API IA est compté automatiquement : n'ajoute ici que tes abonnements.
        </p>
        <p className="mt-1 text-xs text-tres-doux">Saisis les montants réellement payés, TVA comprise : en franchise de TVA, tu ne la récupères pas.</p>
      </Carte>

      {b && (
        <Carte titre={b.id ? "Modifier la charge" : "Nouvelle charge"}>
          {!b.id && (
            <div className="mb-4 flex flex-wrap gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s.libelle}
                  type="button"
                  onClick={() => setB({ ...b, ...s })}
                  className="min-h-9 rounded-full border border-bordure-forte px-3 text-xs text-doux hover:text-fort"
                >
                  {s.libelle}
                </button>
              ))}
            </div>
          )}
          <form onSubmit={enregistrer} className="grid gap-3 sm:grid-cols-2">
            <Champ libelle="Libellé">
              <input required value={b.libelle} onChange={(e) => setB({ ...b, libelle: e.target.value })} className={classeSaisie} />
            </Champ>
            <Champ libelle="Catégorie">
              <select value={b.categorie} onChange={(e) => setB({ ...b, categorie: e.target.value })} className={classeSaisie}>
                {Object.entries(CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Champ>
            <Champ libelle="Montant TTC (€)">
              <input required inputMode="decimal" placeholder="7,00" value={b.montant} onChange={(e) => setB({ ...b, montant: e.target.value })} className={classeSaisie} />
            </Champ>
            <Champ libelle="Fréquence">
              <select value={b.frequence} onChange={(e) => setB({ ...b, frequence: e.target.value as Frequence })} className={classeSaisie}>
                {Object.entries(FREQUENCES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Champ>
            <Champ libelle={b.frequence === "ponctuelle" ? "Date de paiement" : "Premier prélèvement"}>
              <input type="date" required value={b.debut} onChange={(e) => setB({ ...b, debut: e.target.value })} className={classeSaisie} />
            </Champ>
            {b.frequence !== "ponctuelle" && (
              <Champ libelle="Résiliée le (facultatif)" aide="Dernier mois payé. Vide : toujours active.">
                <input type="date" value={b.fin} onChange={(e) => setB({ ...b, fin: e.target.value })} className={classeSaisie} />
              </Champ>
            )}
            <div className="sm:col-span-2">
              <Champ libelle="Notes (facultatif)">
                <input value={b.notes} onChange={(e) => setB({ ...b, notes: e.target.value })} className={classeSaisie} />
              </Champ>
            </div>
            <div className="sm:col-span-2"><Erreur message={erreur} /></div>
            <div className="flex gap-2 sm:col-span-2">
              <Bouton type="submit">Enregistrer</Bouton>
              <Bouton variante="secondaire" onClick={() => { setB(null); setErreur(null); }}>Annuler</Bouton>
            </div>
          </form>
        </Carte>
      )}

      {!b && <Erreur message={erreur} />}

      <Carte>
        {lignes === null ? (
          <p className="text-sm text-doux">Chargement…</p>
        ) : lignes.length === 0 ? (
          <p className="text-sm text-doux">Aucune charge. Commence par l'hébergement et la base de données, même gratuits aujourd'hui : tu verras le jour où ils deviennent payants.</p>
        ) : (
          <ul className="divide-y divide-bordure">
            {lignes.map((c) => {
              const terminee = c.fin !== null && c.fin < aujourdhui();
              return (
                <li key={c.id} className={`py-3 ${terminee ? "opacity-60" : ""}`}>
                  <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{c.libelle}</p>
                    <p className="text-xs text-tres-doux">
                      {CATEGORIES[c.categorie] ?? c.categorie} · {FREQUENCES[c.frequence]} · depuis le {dateFr(c.debut)}
                      {c.fin && ` · ${terminee ? "résiliée" : "jusqu'au"} ${dateFr(c.fin)}`}
                      {c.notes && ` · ${c.notes}`}
                    </p>
                  </div>
                  <p className="font-semibold">{euros(c.montantCents)}</p>
                  </div>
                  <div className="-mr-3 mt-1 flex justify-end gap-1">
                    <button
                      className="min-h-11 rounded-lg px-3 text-sm text-doux hover:text-fort"
                      onClick={() => setB({ id: c.id, libelle: c.libelle, categorie: c.categorie, montant: centsVersSaisie(c.montantCents), frequence: c.frequence, debut: c.debut, fin: c.fin ?? "", notes: c.notes ?? "" })}
                    >
                      Modifier
                    </button>
                    <button className="min-h-11 rounded-lg px-3 text-sm text-danger hover:bg-danger/10" onClick={() => void supprimer(c)}>
                      Supprimer
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Carte>
    </div>
  );
}
