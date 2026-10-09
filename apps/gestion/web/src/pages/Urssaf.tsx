import type { Tableau } from "../api";
import { dateFr, euros, moisLong, nombreFr } from "../format";
import { Carte, Jauge, Stat } from "../ui";

const STATUTS = {
  a_venir: { libelle: "À venir", classe: "text-tres-doux" },
  en_cours: { libelle: "En cours", classe: "text-info" },
  a_declarer: { libelle: "À déclarer", classe: "text-attention" },
  echue: { libelle: "Passée", classe: "text-tres-doux" },
} as const;

export function Urssaf({ t }: { t: Tableau }) {
  const u = t.urssaf;
  const p = t.parametres;
  const ex = t.exercice.totaux;
  const prochaine = u.prochaine;

  return (
    <div className="space-y-4">
      {u.simulation && (
        <p className="rounded-xl border border-info/40 bg-info/10 px-3 py-2 text-sm text-info">
          ℹ Simulation : la micro-entreprise n'est pas encore créée. Aucun montant n'est dû tant qu'elle n'existe pas.
        </p>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          libelle={prochaine ? `Prochaine échéance · ${prochaine.libelle}` : "Prochaine échéance"}
          valeur={prochaine ? euros(prochaine.montantCents) : "—"}
          detail={prochaine ? `avant le ${dateFr(prochaine.dateLimite)} · ${STATUTS[prochaine.statut].libelle.toLowerCase()}` : undefined}
        />
        <Stat libelle="Cotisations sociales" valeur={euros(ex.cotisationsSocialesCents)} detail={`exercice ${t.annee}`} />
        <Stat libelle="Formation pro (CFP)" valeur={euros(ex.cfpCents)} detail={`${nombreFr(p.tauxCfp)} % du CA`} />
        <Stat
          libelle="Impôt libératoire"
          valeur={p.versementLiberatoire ? euros(ex.versementLiberatoireCents) : "Non opté"}
          detail={p.versementLiberatoire ? `${nombreFr(p.tauxVersementLiberatoire)} % du CA` : "impôt au barème, l'année suivante"}
        />
      </div>

      <Carte titre="Taux appliqués">
        <ul className="grid gap-2 text-sm sm:grid-cols-2">
          <li>Cotisations sociales : <strong>{nombreFr(p.tauxCotisations)} %</strong>{p.acre && <> · <strong>{nombreFr(p.tauxCotisations * (1 - p.reductionAcre / 100))} %</strong> sous ACRE</>}</li>
          <li>CFP : <strong>{nombreFr(p.tauxCfp)} %</strong></li>
          <li>Versement libératoire : <strong>{p.versementLiberatoire ? `${nombreFr(p.tauxVersementLiberatoire)} %` : "non"}</strong></li>
          <li>Déclaration : <strong>{p.periodicite}</strong></li>
          <li>
            ACRE : <strong>{p.acre ? (u.acreJusquau ? `jusqu'à fin ${moisLong(u.acreJusquau)}` : "oui (date de début à renseigner)") : "non"}</strong>
          </li>
        </ul>
      </Carte>

      <Carte titre={`Seuils · ${t.annee}`}>
        <div className="space-y-4">
          <Jauge
            libelle="Franchise de TVA"
            valeur={u.caAnneeCents}
            max={u.seuilTvaCents}
            detail={`${euros(u.caAnneeCents)} sur ${euros(u.seuilTvaCents)} · TVA due immédiatement au-delà de ${euros(u.seuilTvaMajoreCents)}`}
          />
          <Jauge libelle="Plafond du régime micro" valeur={u.caAnneeCents} max={u.plafondCaCents} detail={`${euros(u.caAnneeCents)} sur ${euros(u.plafondCaCents)} (proratisé l'année de création)`} />
        </div>
      </Carte>

      <Carte titre={`Calendrier des déclarations · ${t.annee}`}>
        <div className="-mx-4 overflow-x-auto px-4 sm:-mx-5 sm:px-5">
          <table className="w-full min-w-[480px] text-sm">
            <thead>
              <tr className="border-b border-bordure text-left text-xs text-doux">
                <th scope="col" className="py-2 font-medium">Période</th>
                <th scope="col" className="py-2 font-medium">Date limite</th>
                <th scope="col" className="py-2 text-right font-medium">CA déclaré</th>
                <th scope="col" className="py-2 text-right font-medium">À payer</th>
                <th scope="col" className="py-2 text-right font-medium">Statut</th>
              </tr>
            </thead>
            <tbody>
              {u.echeances.map((e) => (
                <tr key={e.premierMois} className="border-b border-bordure/60">
                  <th scope="row" className="py-2 text-left font-medium capitalize">{e.libelle}</th>
                  <td>{dateFr(e.dateLimite)}</td>
                  <td className="text-right">{euros(e.caCents)}</td>
                  <td className="text-right font-semibold">{euros(e.montantCents)}</td>
                  <td className={`text-right ${STATUTS[e.statut].classe}`}>{STATUTS[e.statut].libelle}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-tres-doux">
          La déclaration est obligatoire même à 0 € de CA, sous peine de pénalité. La toute première déclaration couvre la période depuis la création jusqu'à la fin de la première échéance pleine : vérifie la date sur ton espace autoentrepreneur.urssaf.fr. Statut « passée » : l'outil ne sait pas si tu as payé.
        </p>
      </Carte>
    </div>
  );
}
