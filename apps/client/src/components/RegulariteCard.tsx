import { useEffect, useState } from "react";
import { FaFire, FaMedal, FaStopwatch } from "react-icons/fa6";
import { api, type BilanRegularite } from "../lib/api";
import { formatDuree } from "../lib/formats";

function moisCourt(date: string): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
}

/** Étiquette compacte sous chaque barre : sans elle, on ne sait pas quelle semaine on lit. */
function jourEtMois(date: string): string {
  const d = new Date(`${date}T12:00:00`);
  return `${d.getDate()}/${d.getMonth() + 1}`;
}

/**
 * Régularité, jalons et records.
 *
 * L'application mesurait la charge et les seuils, mais ne disait jamais à
 * l'athlète ce qu'il avait accompli. Ce qui fait revenir quelqu'un semaine
 * après semaine, ce n'est pas une courbe de fatigue : c'est de voir que la
 * série tient.
 */
export function RegulariteCard() {
  const [bilan, setBilan] = useState<BilanRegularite | null>(null);

  useEffect(() => {
    api
      .get<BilanRegularite>("/insights/regularite")
      .then(({ data }) => setBilan(data))
      .catch(() => setBilan(null));
  }, []);

  if (!bilan || bilan.totalSeances === 0) return null;

  const avecDonnees = bilan.semaines.filter((s) => s.seancesPrevues > 0);
  const maxVolume = Math.max(60, ...avecDonnees.map((s) => s.prevuMin));

  return (
    <div className="rounded-2xl border border-bordure bg-surface p-4">
      <div className="mb-3 flex items-center gap-2">
        <FaFire className="text-accent" size={14} aria-hidden="true" />
        <h2 className="text-sm font-bold text-fort">Ma régularité</h2>
      </div>

      <dl className="mb-4 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-xl border border-bordure bg-surface-haute px-2 py-2.5">
          <dt className="text-[11px] text-doux">Série</dt>
          <dd className="text-lg font-bold text-fort">
            {bilan.serie}
            <span className="text-xs font-normal text-doux"> sem.</span>
          </dd>
        </div>
        <div className="rounded-xl border border-bordure bg-surface-haute px-2 py-2.5">
          <dt className="text-[11px] text-doux">Séances</dt>
          <dd className="text-lg font-bold text-fort">{bilan.totalSeances}</dd>
        </div>
        <div className="rounded-xl border border-bordure bg-surface-haute px-2 py-2.5">
          <dt className="text-[11px] text-doux">Total</dt>
          <dd className="text-lg font-bold text-fort">
            {bilan.totalHeures}
            <span className="text-xs font-normal text-doux"> h</span>
          </dd>
        </div>
      </dl>

      {avecDonnees.length > 0 && (
        <div className="mb-4">
          <p className="mb-1.5 text-xs text-doux">
            Prévu et réalisé, semaine par semaine
            {bilan.meilleureSerie > bilan.serie && ` · record : ${bilan.meilleureSerie} semaines`}
          </p>
          <ul className="flex items-end gap-1">
            {avecDonnees.map((semaine) => {
              const part = semaine.prevuMin > 0 ? semaine.realiseMin / semaine.prevuMin : 0;
              // Les barres sont mises à l'échelle du volume, pas du taux : sinon
              // toutes les semaines tenues sont pleines et se ressemblent, et
              // l'on ne voit plus qu'une semaine légère diffère d'une grosse.
              const hauteurPrevu = Math.round((semaine.prevuMin / maxVolume) * 100);
              return (
                <li key={semaine.weekStart} className="flex min-w-0 flex-1 flex-col items-center gap-1">
                  <span aria-hidden="true" className="flex h-14 w-full items-end">
                    <span
                      style={{ height: `${Math.max(6, hauteurPrevu)}%` }}
                      className="flex w-full flex-col justify-end rounded-sm border border-bordure-forte bg-fond"
                    >
                      <span
                        style={{ height: `${Math.min(100, part * 100)}%` }}
                        className={`w-full rounded-sm ${semaine.tenue ? "bg-succes" : "bg-attention"}`}
                      />
                    </span>
                  </span>
                  <span aria-hidden="true" className="text-[9px] text-tres-doux">
                    {jourEtMois(semaine.weekStart)}
                  </span>
                  <span className="sr-only">
                    Semaine du {moisCourt(semaine.weekStart)} : {formatDuree(semaine.realiseMin)} réalisés sur{" "}
                    {formatDuree(semaine.prevuMin)} prévus.
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="mt-1.5 flex items-center gap-3 text-[11px] text-tres-doux">
            <span className="flex items-center gap-1.5">
              <span aria-hidden="true" className="h-2.5 w-2.5 rounded-sm bg-succes" />
              semaine tenue
            </span>
            <span className="flex items-center gap-1.5">
              <span aria-hidden="true" className="h-2.5 w-2.5 rounded-sm bg-attention" />
              incomplète
            </span>
            <span className="flex items-center gap-1.5">
              <span aria-hidden="true" className="h-2.5 w-2.5 rounded-sm border border-bordure-forte" />
              prévu
            </span>
          </p>
        </div>
      )}

      {bilan.jalons.length > 0 && (
        <ul className="mb-3 space-y-1.5">
          {bilan.jalons.map((jalon) => (
            <li key={jalon.cle} className="flex items-start gap-2 rounded-lg bg-surface-haute px-3 py-2">
              <FaMedal className="mt-0.5 shrink-0 text-attention" size={12} aria-hidden="true" />
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-fort">{jalon.titre}</span>
                <span className="block text-xs text-doux">{jalon.detail}</span>
              </span>
            </li>
          ))}
        </ul>
      )}

      {bilan.records.length > 0 && (
        <div>
          <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-doux">
            <FaStopwatch size={10} aria-hidden="true" />
            Mes meilleurs temps
          </p>
          <ul className="space-y-1">
            {bilan.records.map((record) => (
              <li key={record.libelle} className="flex items-baseline justify-between gap-2 text-sm">
                <span className="text-doux">{record.libelle}</span>
                <span className="font-mono font-semibold text-fort">{record.valeur}</span>
                <span className="text-xs text-tres-doux">{moisCourt(record.date)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
