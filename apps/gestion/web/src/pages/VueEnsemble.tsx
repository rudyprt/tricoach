import type { Tableau } from "../api";
import { CATEGORIES, dateFr, euros, eurosRonds, moisLong } from "../format";
import { EntreesSorties, Inscriptions, Repartition } from "../graphiques";
import { Carte, Stat, tonDe } from "../ui";

type Bilan = Tableau["ceMois"];
type Totaux = Tableau["cumul"]["totaux"];

/** Tout ce qui sort, URSSAF compris. */
export function sorties(b: Bilan | Totaux): number {
  return b.chargesCents + b.coutIaCents + b.fraisPaiementCents + b.prelevementsCents;
}

function BlocPeriode({ titre, b }: { titre: string; b: Bilan | Totaux }) {
  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold text-doux">{titre}</h2>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat libelle="Chiffre d'affaires" valeur={euros(b.caCents)} />
        <Stat
          libelle="Dépenses"
          valeur={euros(b.chargesCents + b.coutIaCents + b.fraisPaiementCents)}
          detail={`dont IA ${euros(b.coutIaCents)}`}
        />
        <Stat libelle="URSSAF" valeur={euros(b.prelevementsCents)} detail="cotisations, CFP, impôt" />
        <Stat libelle="Résultat net" valeur={euros(b.resultatCents)} ton={tonDe(b.resultatCents)} detail="ce qui te reste" />
      </div>
    </section>
  );
}

const COULEUR_ALERTE = {
  info: "border-info/40 bg-info/10 text-info",
  attention: "border-attention/40 bg-attention/10 text-attention",
  critique: "border-danger/40 bg-danger/10 text-danger",
};
const ICONE_ALERTE = { info: "ℹ", attention: "⚠", critique: "⛔" };

export function VueEnsemble({ t }: { t: Tableau }) {
  const u = t.utilisateurs;
  const cumul = t.cumul.totaux;
  const depenseTotale = cumul.chargesCents + cumul.coutIaCents + cumul.fraisPaiementCents;
  const ex = t.exercice.totaux;
  const postes = [
    ...Object.entries(ex.chargesParCategorie).map(([c, v]) => ({ libelle: CATEGORIES[c] ?? c, cents: v })),
    { libelle: "IA (API Anthropic)", cents: ex.coutIaCents },
    { libelle: "URSSAF", cents: ex.prelevementsCents },
    { libelle: "Frais de paiement", cents: ex.fraisPaiementCents },
  ];

  return (
    <div className="space-y-6">
      {t.alertes.length > 0 && (
        <ul className="space-y-2">
          {t.alertes.map((a) => (
            <li key={a.message} className={`flex gap-2 rounded-xl border px-3 py-2 text-sm ${COULEUR_ALERTE[a.niveau]}`}>
              <span aria-hidden>{ICONE_ALERTE[a.niveau]}</span>
              <span>{a.message}</span>
            </li>
          ))}
        </ul>
      )}

      <section className="rounded-2xl border border-bordure bg-gradient-to-br from-surface-haute to-surface p-5">
        <p className="text-sm text-doux">Depuis le début ({moisLong(t.cumul.depuis)}), l'application t'a coûté</p>
        <p className="mt-1 text-4xl font-black tracking-tight">{euros(depenseTotale)}</p>
        <p className="mt-2 text-sm text-doux">
          pour {euros(cumul.caCents)} encaissés et {euros(cumul.prelevementsCents)} versés à l'URSSAF :{" "}
          <strong className={cumul.resultatCents >= 0 ? "text-succes" : "text-danger"}>
            {cumul.resultatCents >= 0 ? "bénéfice" : "perte"} cumulé(e) de {euros(Math.abs(cumul.resultatCents))}
          </strong>
          .
        </p>
      </section>

      <BlocPeriode titre={`Ce mois-ci · ${moisLong(t.moisCourant)}`} b={t.ceMois} />
      <BlocPeriode titre={`Exercice ${t.annee}${t.annee === Number(t.aujourdhui.slice(0, 4)) ? ` · au ${dateFr(t.aujourdhui)}` : ""}`} b={ex} />

      <section>
        <h2 className="mb-2 text-sm font-semibold text-doux">Utilisateurs · en direct</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat libelle="Inscrits" valeur={`${u.inscrits}`} detail={`+${u.nouveauxCeMois} ce mois · ${u.profilsCompletes} profils complétés`} />
          <Stat libelle="Abonnés payants" valeur={`${u.payants}`} detail={`${u.standard} Standard · ${u.premium} Premium`} />
          <Stat libelle="En essai (14 j)" valeur={`${u.essais}`} detail={`${u.gratuits} gratuits hors essai`} />
          <Stat libelle="Actifs" valeur={`${u.actifs7j}`} detail={`7 j · ${u.actifsJour} sur 24 h · ${u.actifs30j} sur 30 j`} />
          <Stat libelle="Revenu mensuel potentiel" valeur={euros(t.revenus.mrrPotentielCents)} detail={`${eurosRonds(t.revenus.arrPotentielCents)} / an si tous paient`} />
          <Stat
            libelle="Coût IA par actif (mois)"
            valeur={t.revenus.coutIaParActifCents === null ? "—" : euros(t.revenus.coutIaParActifCents)}
            detail="actifs sur 30 jours"
          />
          <Stat
            libelle="Point mort"
            valeur={t.pointMort.abonnesNecessaires === null ? "—" : `${t.pointMort.abonnesNecessaires} abonnés`}
            detail={`Standard, pour couvrir ${euros(t.pointMort.depensesMensuellesCents)} / mois`}
          />
          <Stat libelle="E-mails vérifiés" valeur={`${u.verifies}`} detail={u.inscrits ? `${Math.round((u.verifies / u.inscrits) * 100)} % des inscrits` : undefined} />
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Carte titre={`Encaissé et dépensé · ${t.annee}`}>
          <EntreesSorties donnees={t.exercice.mois.map((b) => ({ mois: b.mois, entrees: b.caCents, sorties: sorties(b) }))} />
        </Carte>
        <Carte titre={`Où part l'argent · ${t.annee}`}>
          <Repartition postes={postes} />
        </Carte>
        <Carte titre="Nouveaux comptes · 12 derniers mois" className="lg:col-span-2">
          <Inscriptions donnees={u.historique} />
          <p className="mt-2 text-xs text-tres-doux">Comptes encore existants : un compte supprimé disparaît de son mois d'inscription.</p>
        </Carte>
      </div>
    </div>
  );
}
