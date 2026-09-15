import { useEffect, useState } from "react";
import { Area, AreaChart, CartesianGrid, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { FaBatteryHalf } from "react-icons/fa6";
import { api, type BilanDeCharge } from "../lib/api";

const COULEURS_ETAT: Record<BilanDeCharge["lecture"]["etat"], string> = {
  frais: "border-emerald-900/50 bg-emerald-950/20 text-emerald-200",
  equilibre: "border-sky-900/50 bg-sky-950/20 text-sky-200",
  charge: "border-amber-900/50 bg-amber-950/20 text-amber-200",
  surcharge: "border-red-900/50 bg-red-950/20 text-red-200",
};

function jourCourt(date: string): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
}

/**
 * Condition, fatigue et fraîcheur sur trois mois.
 *
 * C'est la lecture qui manquait : deux semaines identiques en minutes peuvent
 * laisser frais ou épuisé selon ce qui les a précédées, et le plafond de
 * volume hebdomadaire ne dit rien de cet état-là.
 */
export function ChargeChart() {
  const [bilan, setBilan] = useState<BilanDeCharge | null>(null);

  useEffect(() => {
    api
      .get<BilanDeCharge>("/insights/charge")
      .then(({ data }) => setBilan(data))
      .catch(() => setBilan(null));
  }, []);

  if (!bilan || bilan.seancesTotal < 6) return null;

  // Un point par semaine suffit à lire la tendance et garde le graphique
  // lisible sur un écran de téléphone.
  const points = bilan.points.filter((_, i) => i % 3 === 0).map((p) => ({ ...p, jour: jourCourt(p.date) }));
  const estime = bilan.seancesEstimees / bilan.seancesTotal > 0.5;

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/80 p-4">
      <div className="mb-1 flex items-center gap-2">
        <FaBatteryHalf className="text-sky-400" size={14} />
        <h2 className="text-sm font-bold text-white">Condition et fatigue</h2>
      </div>
      <p className="mb-3 text-xs text-zinc-500">
        Votre condition se construit lentement, votre fatigue monte et redescend vite. L'écart entre les deux est
        votre fraîcheur : elle doit être haute le jour d'une course.
      </p>

      <div className={`mb-3 rounded-xl border px-3 py-2.5 ${COULEURS_ETAT[bilan.lecture.etat]}`}>
        <p className="text-sm font-bold">{bilan.lecture.titre}</p>
        <p className="mt-0.5 text-xs leading-relaxed opacity-90">{bilan.lecture.message}</p>
      </div>

      <div className="h-56 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={points} margin={{ top: 5, right: 5, bottom: 0, left: -20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
            <XAxis dataKey="jour" tick={{ fill: "#71717a", fontSize: 10 }} interval="preserveStartEnd" />
            <YAxis tick={{ fill: "#71717a", fontSize: 10 }} />
            <Tooltip
              contentStyle={{ background: "#09090b", border: "1px solid #27272a", borderRadius: 8, fontSize: 12 }}
              labelStyle={{ color: "#a1a1aa" }}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Area
              type="monotone"
              dataKey="forme"
              name="Condition"
              stroke="#38bdf8"
              fill="#38bdf8"
              fillOpacity={0.15}
            />
            <Line type="monotone" dataKey="fatigue" name="Fatigue" stroke="#fb7185" dot={false} strokeWidth={2} />
            <Line
              type="monotone"
              dataKey="fraicheur"
              name="Fraîcheur"
              stroke="#a3e635"
              dot={false}
              strokeWidth={1.5}
              strokeDasharray="4 3"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {estime && (
        <p className="mt-2 text-[11px] leading-snug text-zinc-600">
          Ces valeurs sont estimées à partir de la durée de vos séances, faute de capteur de puissance ou de
          cardiofréquencemètre. Lisez-les comme une tendance, pas comme une mesure.
        </p>
      )}
    </div>
  );
}
