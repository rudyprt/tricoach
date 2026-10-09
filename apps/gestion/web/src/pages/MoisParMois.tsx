import type { Tableau } from "../api";
import { euros, moisLong, nombreFr } from "../format";
import { ResultatCumule } from "../graphiques";
import { Carte } from "../ui";

export function MoisParMois({ t }: { t: Tableau }) {
  let cumul = 0;
  const courbe = t.exercice.mois
    .filter((b) => b.mois <= t.moisCourant)
    .map((b) => ({ mois: b.mois, cumul: (cumul += b.resultatCents) }));
  const tot = t.exercice.totaux;

  const colonnes = ["Mois", "CA", "Charges", "IA", "Frais", "URSSAF", "Résultat", "Payants", "Inscrits"];

  return (
    <div className="space-y-4">
      <Carte titre={`Résultat cumulé · ${t.annee}`}>
        <ResultatCumule donnees={courbe} />
      </Carte>
      <Carte titre="Détail mensuel">
        <div className="-mx-4 overflow-x-auto px-4 sm:-mx-5 sm:px-5">
          <table className="w-full min-w-[720px] text-right text-sm">
            <thead>
              <tr className="border-b border-bordure text-xs text-doux">
                {colonnes.map((c, i) => (
                  <th key={c} scope="col" className={`py-2 font-medium ${i === 0 ? "text-left" : ""}`}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {t.exercice.mois.map((b) => {
                const futur = b.mois > t.moisCourant;
                return (
                  <tr key={b.mois} className={`border-b border-bordure/60 ${futur ? "text-tres-doux" : ""} ${b.mois === t.moisCourant ? "bg-surface-haute" : ""}`}>
                    <th scope="row" className="py-2 text-left font-medium capitalize">
                      {moisLong(b.mois)}
                      {b.acre && <span className="ml-2 rounded bg-info/15 px-1.5 text-[10px] font-semibold text-info">ACRE</span>}
                    </th>
                    <td>{euros(b.caCents)}</td>
                    <td>{euros(b.chargesCents)}</td>
                    <td>{euros(b.coutIaCents)}</td>
                    <td>{euros(b.fraisPaiementCents)}</td>
                    <td>{euros(b.prelevementsCents)}</td>
                    <td className={`font-semibold ${futur ? "" : b.resultatCents < 0 ? "text-danger" : b.resultatCents > 0 ? "text-succes" : ""}`}>{euros(b.resultatCents)}</td>
                    <td>{b.payants ?? "—"}</td>
                    <td>{b.inscriptions}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="font-semibold">
                <th scope="row" className="py-2 text-left">Total à date</th>
                <td>{euros(tot.caCents)}</td>
                <td>{euros(tot.chargesCents)}</td>
                <td>{euros(tot.coutIaCents)}</td>
                <td>{euros(tot.fraisPaiementCents)}</td>
                <td>{euros(tot.prelevementsCents)}</td>
                <td className={tot.resultatCents < 0 ? "text-danger" : "text-succes"}>{euros(tot.resultatCents)}</td>
                <td />
                <td>{tot.inscriptions}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        <p className="mt-3 text-xs text-tres-doux">
          Mois futurs : charges récurrentes déjà prévues, sans CA. « Payants » vient d'une photographie prise chaque mois à l'ouverture de l'outil : « — » quand elle n'existe pas encore. Coût IA converti au taux {nombreFr(t.parametres.tauxUsdEur)} €/$, TVA de {nombreFr(t.parametres.tvaSurIa)} % incluse.
        </p>
      </Carte>
    </div>
  );
}
