import { useEffect, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { FaArrowTrendUp, FaPersonSwimming, FaPersonBiking, FaPersonRunning } from "react-icons/fa6";
import { api, type ProgressionSeuils } from "../lib/api";
import { secondesVersAllure } from "../lib/formats";

const DISCIPLINES = [
  { cle: "course", label: "Allure au seuil", Icon: FaPersonRunning, couleur: "#fb7185", unite: "/km" },
  { cle: "velo", label: "FTP", Icon: FaPersonBiking, couleur: "#fbbf24", unite: " W" },
  { cle: "natation", label: "Vitesse critique", Icon: FaPersonSwimming, couleur: "#38bdf8", unite: "/100 m" },
] as const;

function jourCourt(date: string): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString("fr-FR", { month: "short", year: "2-digit" });
}

/**
 * Progression des seuils, test après test.
 *
 * L'historique existait, mais en phrases. Voir sa FTP monter sur douze mois est
 * ce qui donne envie de refaire un test dans six semaines, et c'est la seule
 * preuve tangible que l'entraînement paie.
 */
export function ProgressionSeuilsChart() {
  const [donnees, setDonnees] = useState<ProgressionSeuils | null>(null);

  useEffect(() => {
    api
      .get<ProgressionSeuils>("/tests/progression")
      .then(({ data }) => setDonnees(data))
      .catch(() => setDonnees(null));
  }, []);

  if (!donnees) return null;

  // Un seul point ne trace pas une progression : il faut au moins deux tests
  // dans une discipline pour que la courbe dise quelque chose.
  const tracables = DISCIPLINES.filter((d) => donnees.series[d.cle].length >= 2);
  if (tracables.length === 0) return null;

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/80 p-4">
      <div className="mb-1 flex items-center gap-2">
        <FaArrowTrendUp className="text-emerald-400" size={14} />
        <h2 className="text-sm font-bold text-white">Progression de mes seuils</h2>
      </div>
      <p className="mb-3 text-xs text-zinc-500">
        Chaque point est un test de terrain. C'est la mesure de ce que votre entraînement a réellement changé.
      </p>

      <div className="space-y-4">
        {tracables.map(({ cle, label, Icon, couleur, unite }) => {
          const points = donnees.series[cle].map((p) => ({ ...p, mois: jourCourt(p.date) }));
          const premier = points[0];
          const dernier = points[points.length - 1];
          const plusBasMieux = donnees.sens[cle] === "plus_bas_mieux";
          const ecart = ((dernier.valeur - premier.valeur) / premier.valeur) * 100;
          const progresse = plusBasMieux ? ecart < 0 : ecart > 0;

          return (
            <div key={cle}>
              <div className="mb-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <Icon style={{ color: couleur }} size={12} />
                <span className="text-xs font-semibold text-zinc-300">{label}</span>
                <span className="font-mono text-xs text-white">{dernier.libelle}</span>
                {Math.abs(ecart) >= 1 && (
                  <span className={`text-[11px] ${progresse ? "text-emerald-400" : "text-zinc-500"}`}>
                    {progresse ? "▲" : "▼"} {Math.abs(ecart).toFixed(1)} % depuis {premier.libelle}
                  </span>
                )}
              </div>

              <div className="h-28 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={points} margin={{ top: 5, right: 5, bottom: 0, left: -18 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                    <XAxis dataKey="mois" tick={{ fill: "#71717a", fontSize: 10 }} />
                    <YAxis
                      tick={{ fill: "#71717a", fontSize: 10 }}
                      domain={["dataMin - 5", "dataMax + 5"]}
                      // Une allure se lit à l'envers : plus bas sur l'axe
                      // signifierait « moins bon », alors que c'est l'inverse.
                      reversed={plusBasMieux}
                      tickFormatter={(v: number) => (plusBasMieux ? secondesVersAllure(v) : String(v))}
                    />
                    <Tooltip
                      contentStyle={{
                        background: "#09090b",
                        border: "1px solid #27272a",
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                      labelStyle={{ color: "#a1a1aa" }}
                      formatter={(_v: number, _n: string, entree: { payload?: { libelle?: string } }) => [
                        entree.payload?.libelle ?? "",
                        label,
                      ]}
                    />
                    <Line type="monotone" dataKey="valeur" stroke={couleur} strokeWidth={2} dot={{ r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <span className="sr-only">Unité : {unite}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
