import { useEffect, useState, type FormEvent } from "react";
import { api, type Parametres } from "../api";
import { centsVersSaisie, versCents } from "../format";
import { Bouton, Carte, Champ, Erreur, classeSaisie } from "../ui";

/** Préréglages d'activité : taux 2026, à confirmer avec le classement URSSAF. */
const PRESETS = {
  bic: { libelle: "Prestations de services commerciales (BIC)", tauxCotisations: 21.2, tauxCfp: 0.1, tauxVersementLiberatoire: 1.7 },
  bnc: { libelle: "Profession libérale non réglementée (BNC)", tauxCotisations: 25.6, tauxCfp: 0.2, tauxVersementLiberatoire: 2.2 },
};

type Saisie = Omit<Parametres, "prixStandardCents" | "prixPremiumCents" | "plafondCaCents" | "seuilTvaCents" | "seuilTvaMajoreCents"> & {
  prixStandard: string;
  prixPremium: string;
  plafondCa: string;
  seuilTva: string;
  seuilTvaMajore: string;
};

function versSaisie(p: Parametres): Saisie {
  const { prixStandardCents, prixPremiumCents, plafondCaCents, seuilTvaCents, seuilTvaMajoreCents, ...reste } = p;
  return {
    ...reste,
    prixStandard: centsVersSaisie(prixStandardCents),
    prixPremium: centsVersSaisie(prixPremiumCents),
    plafondCa: centsVersSaisie(plafondCaCents),
    seuilTva: centsVersSaisie(seuilTvaCents),
    seuilTvaMajore: centsVersSaisie(seuilTvaMajoreCents),
  };
}

function Nombre({ libelle, aide, valeur, onChange, pas = 0.1 }: { libelle: string; aide?: string; valeur: number; onChange: (n: number) => void; pas?: number }) {
  return (
    <Champ libelle={libelle} aide={aide}>
      <input type="number" step={pas} min={0} required value={valeur} onChange={(e) => onChange(Number(e.target.value))} className={classeSaisie} />
    </Champ>
  );
}

function Interrupteur({ libelle, aide, valeur, onChange }: { libelle: string; aide: string; valeur: boolean; onChange: (b: boolean) => void }) {
  return (
    <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border border-bordure p-3">
      <input type="checkbox" checked={valeur} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 h-5 w-5 accent-[#f43f5e]" />
      <span>
        <span className="block text-sm font-medium">{libelle}</span>
        <span className="block text-xs text-tres-doux">{aide}</span>
      </span>
    </label>
  );
}

export function ParametresPage({ onChange }: { onChange: () => Promise<void> }) {
  const [s, setS] = useState<Saisie | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  useEffect(() => {
    api<Parametres>("/parametres").then((p) => setS(versSaisie(p)), (e: Error) => setErreur(e.message));
  }, []);

  if (!s) return <Erreur message={erreur} />;
  const maj = (partiel: Partial<Saisie>) => {
    setOk(false);
    setS({ ...s, ...partiel });
  };

  async function enregistrer(e: FormEvent) {
    e.preventDefault();
    if (!s) return;
    const { prixStandard, prixPremium, plafondCa, seuilTva, seuilTvaMajore, ...reste } = s;
    const montants = [prixStandard, prixPremium, plafondCa, seuilTva, seuilTvaMajore].map(versCents);
    if (montants.some((m) => m === null || m < 0)) return setErreur("Un montant est illisible.");
    const [prixStandardCents, prixPremiumCents, plafondCaCents, seuilTvaCents, seuilTvaMajoreCents] = montants as number[];
    try {
      const p = await api<Parametres>("/parametres", {
        method: "PUT",
        body: { ...reste, dateDebutActivite: reste.dateDebutActivite || null, prixStandardCents, prixPremiumCents, plafondCaCents, seuilTvaCents, seuilTvaMajoreCents },
      });
      setS(versSaisie(p));
      setErreur(null);
      setOk(true);
      await onChange();
    } catch (err) {
      setErreur(err instanceof Error ? err.message : "Enregistrement impossible.");
    }
  }

  return (
    <form onSubmit={enregistrer} className="space-y-4">
      <Carte titre="Micro-entreprise">
        <div className="grid gap-3 sm:grid-cols-2">
          <Champ libelle="Date de début d'activité" aide="Vide tant qu'elle n'est pas créée : tout est simulé.">
            <input type="date" value={s.dateDebutActivite ?? ""} onChange={(e) => maj({ dateDebutActivite: e.target.value || null })} className={classeSaisie} />
          </Champ>
          <Champ libelle="Déclaration URSSAF">
            <select value={s.periodicite} onChange={(e) => maj({ periodicite: e.target.value as Saisie["periodicite"] })} className={classeSaisie}>
              <option value="trimestrielle">Trimestrielle</option>
              <option value="mensuelle">Mensuelle</option>
            </select>
          </Champ>
          <div className="sm:col-span-2">
            <p className="mb-1 text-xs font-medium text-doux">Type d'activité (préremplit les taux)</p>
            <div className="flex flex-wrap gap-2">
              {Object.entries(PRESETS).map(([k, v]) => (
                <Bouton key={k} variante="secondaire" onClick={() => maj({ tauxCotisations: v.tauxCotisations, tauxCfp: v.tauxCfp, tauxVersementLiberatoire: v.tauxVersementLiberatoire })}>
                  {v.libelle}
                </Bouton>
              ))}
            </div>
            <p className="mt-1 text-xs text-tres-doux">Un abonnement à une appli vendu à des particuliers relève en général du BIC services. C'est l'URSSAF qui tranche à l'immatriculation.</p>
          </div>
          <Nombre libelle="Cotisations sociales (% du CA)" valeur={s.tauxCotisations} onChange={(n) => maj({ tauxCotisations: n })} />
          <Nombre libelle="Formation professionnelle, CFP (%)" valeur={s.tauxCfp} onChange={(n) => maj({ tauxCfp: n })} pas={0.01} />
          <Interrupteur
            libelle="ACRE"
            aide="Ouverte aux 18-25 ans. À demander dans les 60 jours après la création. Dure jusqu'à la fin du 3e trimestre civil suivant le début."
            valeur={s.acre}
            onChange={(b) => maj({ acre: b })}
          />
          <Nombre libelle="Réduction ACRE (%)" aide="50 si création avant le 1er juillet 2026, 25 après." valeur={s.reductionAcre} onChange={(n) => maj({ reductionAcre: n })} pas={1} />
          <Interrupteur
            libelle="Versement libératoire"
            aide="Impôt sur le revenu payé avec les cotisations, en % du CA. Si ton foyer est peu ou pas imposable, le barème classique coûte souvent moins : simule avant d'opter."
            valeur={s.versementLiberatoire}
            onChange={(b) => maj({ versementLiberatoire: b })}
          />
          <Nombre libelle="Taux du versement libératoire (%)" valeur={s.tauxVersementLiberatoire} onChange={(n) => maj({ tauxVersementLiberatoire: n })} />
        </div>
      </Carte>

      <Carte titre="Offres et coûts">
        <div className="grid gap-3 sm:grid-cols-2">
          <Champ libelle="Prix Standard (€ / mois)">
            <input inputMode="decimal" required value={s.prixStandard} onChange={(e) => maj({ prixStandard: e.target.value })} className={classeSaisie} />
          </Champ>
          <Champ libelle="Prix Premium (€ / mois)">
            <input inputMode="decimal" required value={s.prixPremium} onChange={(e) => maj({ prixPremium: e.target.value })} className={classeSaisie} />
          </Champ>
          <Nombre libelle="Taux de change (€ pour 1 $)" aide="L'API IA est facturée en dollars." valeur={s.tauxUsdEur} onChange={(n) => maj({ tauxUsdEur: n })} pas={0.01} />
          <Nombre libelle="TVA facturée sur l'IA (%)" aide="20 sans numéro de TVA intracommunautaire valide ; 0 sinon." valeur={s.tvaSurIa} onChange={(n) => maj({ tvaSurIa: n })} pas={1} />
        </div>
      </Carte>

      <Carte titre="Seuils légaux">
        <div className="grid gap-3 sm:grid-cols-3">
          <Champ libelle="Plafond micro (€)">
            <input inputMode="decimal" required value={s.plafondCa} onChange={(e) => maj({ plafondCa: e.target.value })} className={classeSaisie} />
          </Champ>
          <Champ libelle="Franchise TVA (€)">
            <input inputMode="decimal" required value={s.seuilTva} onChange={(e) => maj({ seuilTva: e.target.value })} className={classeSaisie} />
          </Champ>
          <Champ libelle="Franchise TVA majorée (€)">
            <input inputMode="decimal" required value={s.seuilTvaMajore} onChange={(e) => maj({ seuilTvaMajore: e.target.value })} className={classeSaisie} />
          </Champ>
        </div>
        <p className="mt-2 text-xs text-tres-doux">Valeurs 2026 pour les services. Vérifie-les chaque janvier sur autoentrepreneur.urssaf.fr.</p>
      </Carte>

      <Erreur message={erreur} />
      {ok && <p role="status" className="text-sm text-succes">Paramètres enregistrés.</p>}
      <Bouton type="submit">Enregistrer</Bouton>
    </form>
  );
}
