import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import type { Session } from "../lib/api";

function weekStartLabel(dateStr: string): string {
  const d = new Date(dateStr);
  const day = d.getDay();
  const diff = (day === 0 ? -6 : 1) - day;
  d.setDate(d.getDate() + diff);
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
}

interface WeekPoint {
  semaine: string;
  natation: number;
  velo: number;
  course: number;
  renfo: number;
}

function buildWeeklyData(sessions: Session[]): WeekPoint[] {
  const completed = sessions.filter((s) => s.status === "faite" && s.sport !== "repos");
  const byWeek = new Map<string, WeekPoint>();

  for (const s of completed) {
    const label = weekStartLabel(s.date);
    if (!byWeek.has(label)) {
      byWeek.set(label, { semaine: label, natation: 0, velo: 0, course: 0, renfo: 0 });
    }
    const point = byWeek.get(label)!;
    const hours = s.dureeMin / 60;
    if (s.sport === "natation") point.natation += hours;
    else if (s.sport === "velo") point.velo += hours;
    else if (s.sport === "course") point.course += hours;
    else if (s.sport === "renfo") point.renfo += hours;
  }

  return Array.from(byWeek.values()).sort((a, b) => (a.semaine > b.semaine ? 1 : -1));
}

export function ProgressChart({ sessions }: { sessions: Session[] }) {
  const data = buildWeeklyData(sessions);

  if (data.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-bordure p-8 text-center text-doux">
        Pas encore assez de séances validées pour afficher une courbe de progression.
      </div>
    );
  }

  return (
    <div className="h-64 rounded-2xl border border-bordure bg-zinc-950 p-3">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ left: -20, right: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
          <XAxis dataKey="semaine" stroke="#71717a" fontSize={11} />
          <YAxis stroke="#71717a" fontSize={11} unit="h" />
          <Tooltip
            contentStyle={{ background: "#09090b", border: "1px solid #27272a", borderRadius: 8 }}
            labelStyle={{ color: "#e4e4e7" }}
          />
          <Legend />
          <Line type="monotone" dataKey="natation" name="Natation" stroke="#38bdf8" strokeWidth={2} />
          <Line type="monotone" dataKey="velo" name="Vélo" stroke="#a78bfa" strokeWidth={2} />
          <Line type="monotone" dataKey="course" name="Course" stroke="#fb923c" strokeWidth={2} />
          <Line type="monotone" dataKey="renfo" name="Renforcement" stroke="#4ade80" strokeWidth={2} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
