import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, type EncaissementLigne, type Tableau } from "../api";
import { centsVersSaisie, dateFr, euros, versCents } from "../format";
import { Bouton, Carte, Champ, Erreur, classeSaisie } from "../ui";

interface Brouillon {
  id?: string;
  date: string;
  libelle: string;
  categorie: "abonnement" | "autre";
  montant: string;
  frais: string;
}

const vide = (): Brouillon => ({ date: new Date().toISOString().slice(0, 10), libelle: "", categorie: "abonnement", montant: "", frais: "0" });

export function Encaissements({ t, onChange }: { t: Tableau; onChange: () => Promise<void> }) {
  const [lignes, setLignes] = useState<EncaissementLigne[] | null>(null);
  const [b, setB] = useState<Brouillon | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  const charger = useCallback(async () => {
    setLignes(await api<EncaissementLigne[]>("/encaissements"));
  }, []);
  useEffect(() => {
    void charger().catch((e: Error) => setErreur(e.message));
  }, [charger]);

  async function apres() {
    await Promise.all([charger(), onChange()]);
  }

  async function enregistrer(e: FormEvent) {
    e.preventDefault();
    if (!b) return;
    const montantCents = versCents(b.montant);
    const fraisCents = versCents(b.frais || "0");
    if (montantCents === null) return setErreur("Montant invalide (ex. 19,99). Négatif pour un remboursement.");
    if (fraisCents === null || fraisCents < 0) return setErreur("Frais invalides.");
    try {
      await api(b.id ? `/encaissements/${b.id}` : "/encaissements", {
        method: b.id ? "PUT" : "POST",
        body: { date: b.date, libelle: b.libelle, categorie: b.categorie, montantCents, fraisCents },
      });
      setB(null);
      setErreur(null);
      await apres();
    } catch (err) {
      setErreur(err instanceof Error ? err.message : "Enregistrement impossible.");
    }
  }

  async function estimer() {
    try {
      await api("/encaissements/estimation", { method: "POST" });
      setErreur(null);
      await apres();
    } catch (err) {
      setErreur(err instanceof Error ? err.message : "Estimation impossible.");
    }
  }

  async function supprimer(l: EncaissementLigne) {
    if (!window.confirm(`Supprimer « ${l.libelle} » (${euros(l.montantCents)}) ?`)) return;
    await api(`/encaissements/${l.id}`, { method: "DELETE" });
    await apres();
  }

  return (
    <div className="space-y-4">
      <Carte titre="Encaissements" action={!b && <Bouton onClick={() => setB(vide())}>+ Ajouter</Bouton>}>
        <p className="text-sm text-doux">
          Aucun paiement n'est branché : le CA, c'est ce que tu saisis ici, à la date où l'argent arrive sur ton compte. C'est l'assiette de tes cotisations URSSAF.
        </p>
        {t.revenus.mrrPotentielCents > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-3 rounded-xl border border-bordure bg-surface-haute p-3">
            <p className="flex-1 text-sm text-doux">
              {t.utilisateurs.payants} compte(s) payant(s) : {euros(t.revenus.mrrPotentielCents)} potentiels ce mois-ci.
            </p>
            <Bouton variante="secondaire" onClick={() => void estimer()}>Pré-remplir ce mois</Bouton>
          </div>
        )}
      </Carte>

      <Erreur message={!b ? erreur : null} />

      {b && (
        <Carte titre={b.id ? "Modifier l'encaissement" : "Nouvel encaissement"}>
          <form onSubmit={enregistrer} className="grid gap-3 sm:grid-cols-2">
            <Champ libelle="Date d'encaissement">
              <input type="date" required value={b.date} onChange={(e) => setB({ ...b, date: e.target.value })} className={classeSaisie} />
            </Champ>
            <Champ libelle="Type">
              <select value={b.categorie} onChange={(e) => setB({ ...b, categorie: e.target.value as Brouillon["categorie"] })} className={classeSaisie}>
                <option value="abonnement">Abonnement</option>
                <option value="autre">Autre recette</option>
              </select>
            </Champ>
            <div className="sm:col-span-2">
              <Champ libelle="Libellé">
                <input required placeholder="Abonnement Premium — Jean D." value={b.libelle} onChange={(e) => setB({ ...b, libelle: e.target.value })} className={classeSaisie} />
              </Champ>
            </div>
            <Champ libelle="Montant encaissé (€)" aide="Négatif pour un remboursement.">
              <input required inputMode="decimal" placeholder="19,99" value={b.montant} onChange={(e) => setB({ ...b, montant: e.target.value })} className={classeSaisie} />
            </Champ>
            <Champ libelle="Frais du prestataire (€)" aide="Commission Stripe, PayPal… 0 si virement.">
              <input inputMode="decimal" value={b.frais} onChange={(e) => setB({ ...b, frais: e.target.value })} className={classeSaisie} />
            </Champ>
            <div className="sm:col-span-2"><Erreur message={erreur} /></div>
            <div className="flex gap-2 sm:col-span-2">
              <Bouton type="submit">Enregistrer</Bouton>
              <Bouton variante="secondaire" onClick={() => { setB(null); setErreur(null); }}>Annuler</Bouton>
            </div>
          </form>
        </Carte>
      )}

      <Carte>
        {lignes === null ? (
          <p className="text-sm text-doux">Chargement…</p>
        ) : lignes.length === 0 ? (
          <p className="text-sm text-doux">Aucun encaissement pour l'instant.</p>
        ) : (
          <ul className="divide-y divide-bordure">
            {lignes.map((l) => (
              <li key={l.id} className="py-3">
                <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{l.libelle}</p>
                  <p className="text-xs text-tres-doux">
                    {dateFr(l.date)} · {l.categorie === "abonnement" ? "Abonnement" : "Autre"}
                    {l.fraisCents > 0 && ` · frais ${euros(l.fraisCents)}`}
                  </p>
                </div>
                <p className={`font-semibold ${l.montantCents < 0 ? "text-danger" : "text-succes"}`}>{euros(l.montantCents)}</p>
                </div>
                  <div className="-mr-3 mt-1 flex justify-end gap-1">
                  <button
                    className="min-h-11 rounded-lg px-3 text-sm text-doux hover:text-fort"
                    onClick={() => setB({ id: l.id, date: l.date, libelle: l.libelle, categorie: l.categorie, montant: centsVersSaisie(l.montantCents), frais: centsVersSaisie(l.fraisCents) })}
                  >
                    Modifier
                  </button>
                  <button className="min-h-11 rounded-lg px-3 text-sm text-danger hover:bg-danger/10" onClick={() => void supprimer(l)}>
                    Supprimer
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Carte>
    </div>
  );
}
