import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { euros, eurosRonds, moisCourt, moisLong } from "./format";

const AXE = { stroke: "#83838f", fontSize: 12 };
const GRILLE = "#2a2a31";
const SERIE_1 = "#3987e5";
const SERIE_2 = "#d95926";

function InfoBulle({ active, payload, label, format }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string; format: (v: number) => string }) {
  if (!active || !payload?.length || !label) return null;
  return (
    <div className="rounded-xl border border-bordure-forte bg-surface-haute px-3 py-2 text-xs shadow-lg">
      <p className="mb-1 font-semibold text-fort">{moisLong(label)}</p>
      {payload.map((p) => (
        <p key={p.name} className="flex items-center gap-2 text-doux">
          <span className="inline-block h-2 w-2 rounded-sm" style={{ background: p.color }} aria-hidden />
          {p.name} <span className="ml-auto pl-3 font-semibold text-fort">{format(p.value)}</span>
        </p>
      ))}
    </div>
  );
}

const legende = (v: string) => <span className="text-xs text-doux">{v}</span>;

/** Entrées et sorties du mois, côte à côte : deux séries, un seul axe. */
export function EntreesSorties({ donnees }: { donnees: { mois: string; entrees: number; sorties: number }[] }) {
  return (
    <div className="h-64" role="img" aria-label="Encaissements et dépenses par mois">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={donnees} barGap={2} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke={GRILLE} />
          <XAxis dataKey="mois" tickFormatter={moisCourt} tick={AXE} axisLine={false} tickLine={false} />
          <YAxis tickFormatter={(v: number) => eurosRonds(v)} tick={AXE} axisLine={false} tickLine={false} width={64} />
          <Tooltip cursor={{ fill: "rgba(255,255,255,0.04)" }} content={<InfoBulle format={euros} />} />
          <Legend formatter={legende} iconType="square" iconSize={8} />
          <Bar isAnimationActive={false} dataKey="entrees" name="Encaissé" fill={SERIE_1} radius={[4, 4, 0, 0]} maxBarSize={18} />
          <Bar isAnimationActive={false} dataKey="sorties" name="Dépensé (URSSAF compris)" fill={SERIE_2} radius={[4, 4, 0, 0]} maxBarSize={18} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Résultat cumulé : ce que l'application t'a rapporté (ou coûté) depuis janvier. */
export function ResultatCumule({ donnees }: { donnees: { mois: string; cumul: number }[] }) {
  return (
    <div className="h-56" role="img" aria-label="Résultat cumulé sur l'exercice">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={donnees} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke={GRILLE} />
          <XAxis dataKey="mois" tickFormatter={moisCourt} tick={AXE} axisLine={false} tickLine={false} />
          <YAxis tickFormatter={(v: number) => eurosRonds(v)} tick={AXE} axisLine={false} tickLine={false} width={64} />
          <ReferenceLine y={0} stroke="#3f3f47" />
          <Tooltip cursor={{ stroke: "#3f3f47" }} content={<InfoBulle format={euros} />} />
          <Line isAnimationActive={false} dataKey="cumul" name="Résultat cumulé" stroke={SERIE_1} strokeWidth={2} dot={{ r: 4, fill: SERIE_1, stroke: "#131316", strokeWidth: 2 }} activeDot={{ r: 5 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function Inscriptions({ donnees }: { donnees: { mois: string; inscriptions: number }[] }) {
  return (
    <div className="h-48" role="img" aria-label="Nouveaux comptes par mois">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={donnees} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke={GRILLE} />
          <XAxis dataKey="mois" tickFormatter={moisCourt} tick={AXE} axisLine={false} tickLine={false} />
          <YAxis allowDecimals={false} tick={AXE} axisLine={false} tickLine={false} width={32} />
          <Tooltip cursor={{ fill: "rgba(255,255,255,0.04)" }} content={<InfoBulle format={(v) => `${v}`} />} />
          <Bar isAnimationActive={false} dataKey="inscriptions" name="Nouveaux comptes" fill={SERIE_1} radius={[4, 4, 0, 0]} maxBarSize={22} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Répartition des dépenses : barres horizontales en HTML, triées, montant en clair. */
export function Repartition({ postes }: { postes: { libelle: string; cents: number }[] }) {
  const tries = postes.filter((p) => p.cents > 0).sort((a, b) => b.cents - a.cents);
  const max = tries[0]?.cents ?? 0;
  if (!tries.length) return <p className="text-sm text-tres-doux">Aucune dépense sur la période.</p>;
  return (
    <ul className="space-y-3">
      {tries.map((p) => (
        <li key={p.libelle}>
          <div className="mb-1 flex justify-between gap-3 text-sm">
            <span className="text-doux">{p.libelle}</span>
            <span className="font-semibold">{euros(p.cents)}</span>
          </div>
          <div className="h-2 rounded-full bg-surface-haute">
            <div className="h-full rounded-full" style={{ width: `${(p.cents / max) * 100}%`, background: SERIE_2 }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
