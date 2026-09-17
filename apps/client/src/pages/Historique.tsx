import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, type Session, type SessionPage, type Activity, formatAllure } from "../lib/api";
import { useAuth } from "../lib/AuthContext";
import { ProgressChart } from "../components/ProgressChart";
import { ChargeChart } from "../components/ChargeChart";
import { RegulariteCard } from "../components/RegulariteCard";
import { Spinner } from "../components/Spinner";
import { SessionDetailModal } from "../components/SessionDetailModal";

const SPORT_ICON: Record<Session["sport"], string> = {
  natation: "🏊",
  velo: "🚴",
  course: "🏃",
  renfo: "🏋️",
  repos: "😴",
};

const SPORT_LABELS: Record<Session["sport"], string> = {
  natation: "Natation",
  velo: "Vélo",
  course: "Course",
  renfo: "Renforcement",
  repos: "Repos",
};

const STATUS_LABELS: Record<Session["status"], string> = {
  planifiee: "Planifiée",
  faite: "Faite",
  manquee: "Manquée",
};

const LIMITED_HISTORY_COUNT = 5;

interface HrZones {
  zones: { zone: string; minutes: number }[];
}

/** Résumé chiffré d'une activité mesurée. */
function resumeActivite(a: Activity): string {
  const morceaux = [`${a.dureeMin} min`];
  if (a.distanceKm) morceaux.push(`${a.distanceKm} km`);
  if (a.allureSecParKm) morceaux.push(formatAllure(a.allureSecParKm));
  if (a.puissanceMoy) morceaux.push(`${a.puissanceMoy} W`);
  if (a.fcMoyenne) morceaux.push(`FC ${a.fcMoyenne}`);
  return morceaux.join(" · ");
}

export function Historique() {
  const { user } = useAuth();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [recherche, setRecherche] = useState("");
  const [sportFilter, setSportFilter] = useState<string>("tous");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hrZones, setHrZones] = useState<HrZones | null>(null);
  const [activities, setActivities] = useState<Activity[]>([]);

  useEffect(() => {
    // L'historique est paginé côté serveur : on charge les pages en chaîne
    // plutôt que de réclamer plusieurs années de séances d'un coup.
    (async () => {
      const collected: Session[] = [];
      let cursor: string | null = null;
      do {
        const { data }: { data: SessionPage } = await api.get<SessionPage>("/sessions", {
          params: cursor ? { cursor } : undefined,
        });
        collected.push(...data.sessions);
        cursor = data.nextCursor;
      } while (cursor && collected.length < 1000);
      setSessions(collected);
      setLoading(false);
    })().catch(() => setLoading(false));
    // Données réellement mesurées : elles enrichissent l'historique sans le
    // remplacer, et restent silencieuses si Strava n'est pas relié.
    api
      .get<{ activities: Activity[] }>("/activities")
      .then(({ data }) => setActivities(data.activities))
      .catch(() => undefined);
    if (user?.isPremium) {
      api.get<HrZones>("/insights/hr-zones").then(({ data }) => setHrZones(data));
    }
  }, [user?.isPremium]);

  async function updateSession(
    id: string,
    status: Session["status"],
    ressenti?: string,
    dureeReelleMin?: number | null
  ) {
    const { data } = await api.patch<Session>(`/sessions/${id}`, { status, ressenti, dureeReelleMin });
    setSessions((prev) => prev.map((s) => (s.id === id ? data : s)));
  }

  const hasFullAccess = user?.hasStandardAccess ?? false;

  const allPastSessions = useMemo(() => {
    const now = new Date();
    return sessions
      .filter((s) => new Date(s.date) <= now && s.sport !== "repos")
      .filter((s) => sportFilter === "tous" || s.sport === sportFilter)
      .sort((a, b) => (a.date < b.date ? 1 : -1));
  }, [sessions, sportFilter]);

  const pastSessions = hasFullAccess ? allPastSessions : allPastSessions.slice(0, LIMITED_HISTORY_COUNT);
  const hiddenCount = allPastSessions.length - pastSessions.length;

  // La recherche porte sur ce que l'athlète a sous les yeux : le titre de la
  // séance et son propre ressenti, qui est souvent ce dont il se souvient.
  const sessionsAffichees = useMemo(() => {
    const terme = recherche.trim().toLowerCase();
    if (!terme) return pastSessions;
    return pastSessions.filter(
      (s) =>
        s.titre.toLowerCase().includes(terme) ||
        (s.ressenti ?? "").toLowerCase().includes(terme) ||
        (s.description ?? "").toLowerCase().includes(terme)
    );
  }, [pastSessions, recherche]);

  const maxZoneMinutes = hrZones ? Math.max(1, ...hrZones.zones.map((z) => z.minutes)) : 1;

  // Les données mesurées s'affichent à côté du prévu : c'est l'écart entre les
  // deux qui a de la valeur pour l'athlète.
  const activitesParSeance = useMemo(() => {
    const index = new Map<string, Activity>();
    for (const a of activities) {
      if (a.sessionId) index.set(a.sessionId, a);
    }
    return index;
  }, [activities]);

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-bold text-white">Historique & progression</h1>

      {/* Ouvert à tous, contrairement à la courbe de progression : c'est le
          garde-fou anti-surentraînement, pas un argument commercial. */}
      <RegulariteCard />

      <ChargeChart />

      {hasFullAccess ? (
        <ProgressChart sessions={sessions} />
      ) : (
        <div className="rounded-2xl border border-dashed border-bordure p-6 text-center">
          <p className="text-sm text-doux">
            Débloquez la courbe de progression (forme, volume, performance) avec l'offre Standard.
          </p>
          <Link
            to="/abonnement"
            className="mt-3 inline-block rounded-full bg-rose-500 px-4 py-1.5 text-xs font-semibold text-black transition-all hover:bg-rose-400"
          >
            Voir les offres
          </Link>
        </div>
      )}

      {user?.isPremium && hrZones && hrZones.zones.length > 0 && (
        <div className="rounded-2xl border border-bordure bg-zinc-950/80 p-4">
          <p className="mb-3 text-sm font-semibold text-white">Répartition par zone (30 derniers jours)</p>
          <div className="space-y-2">
            {hrZones.zones.map((z) => (
              <div key={z.zone} className="flex items-center gap-2">
                <span className="w-16 shrink-0 text-xs text-doux">{z.zone}</span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-zinc-900">
                  <div
                    className="h-full rounded-full bg-rose-500"
                    style={{ width: `${(z.minutes / maxZoneMinutes) * 100}%` }}
                  />
                </div>
                <span className="w-14 shrink-0 text-right text-xs text-doux">{z.minutes} min</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="recherche-seances" className="sr-only">
          Rechercher une séance
        </label>
        <input
          id="recherche-seances"
          type="search"
          value={recherche}
          onChange={(e) => setRecherche(e.target.value)}
          placeholder="Rechercher un titre, un ressenti…"
          className="min-w-0 flex-1 rounded-lg border border-bordure bg-surface px-3 py-2 text-sm text-fort placeholder:text-tres-doux focus:border-accent"
        />
        <label htmlFor="filtre-sport" className="sr-only">
          Filtrer par sport
        </label>
        <select
          id="filtre-sport"
          value={sportFilter}
          onChange={(e) => setSportFilter(e.target.value)}
          className="rounded-lg border border-bordure bg-surface px-2 py-2 text-sm text-fort focus:border-accent"
        >
          <option value="tous">Tous les sports</option>
          <option value="natation">Natation</option>
          <option value="velo">Vélo</option>
          <option value="course">Course</option>
          <option value="renfo">Renforcement</option>
        </select>
      </div>

      {loading ? (
        <p className="flex items-center gap-2 text-doux">
          <Spinner /> Chargement...
        </p>
      ) : sessionsAffichees.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-bordure p-8 text-center">
          <span aria-hidden="true" className="mb-3 block text-4xl">
            {recherche || sportFilter !== "tous" ? "🔍" : "📈"}
          </span>
          <p className="text-sm font-semibold text-fort">
            {recherche || sportFilter !== "tous" ? "Aucune séance ne correspond" : "Pas encore de séance passée"}
          </p>
          <p className="mx-auto mt-1.5 max-w-xs text-sm text-doux">
            {recherche || sportFilter !== "tous"
              ? "Essayez un autre mot, ou remettez le filtre sur tous les sports."
              : "Vos séances validées apparaîtront ici, avec vos progrès semaine après semaine."}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {sessionsAffichees.map((s, i) => (
            <div
              key={s.id}
              role="button"
              tabIndex={0}
              onClick={() => setSelectedId(s.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") setSelectedId(s.id);
              }}
              className="animate-fade-in-up flex cursor-pointer items-center gap-3 rounded-2xl border border-bordure bg-zinc-950 px-3 py-2.5 transition-colors duration-200 hover:border-bordure-forte"
              style={{ animationDelay: `${Math.min(i, 12) * 40}ms` }}
            >
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-lg">
                {SPORT_ICON[s.sport]}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-white">
                  {new Date(s.date).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" })}
                  {" · "}
                  {SPORT_LABELS[s.sport]} — {s.titre}
                </p>
                <p className="truncate text-xs text-doux">
                  {s.dureeMin} min{s.distanceKm ? ` · ${s.distanceKm} km` : ""}
                  {s.ressenti ? ` · Ressenti : ${s.ressenti}` : ""}
                </p>
                {activitesParSeance.get(s.id) && (
                  <p className="mt-0.5 truncate text-xs text-[#fc4c02]">
                    ⌚ Réalisé : {resumeActivite(activitesParSeance.get(s.id)!)}
                  </p>
                )}
              </div>
              <span
                className={`shrink-0 rounded-full px-2 py-1 text-xs ${
                  s.status === "faite"
                    ? "bg-emerald-500/20 text-emerald-300"
                    : s.status === "manquee"
                      ? "bg-red-500/20 text-red-300"
                      : "bg-zinc-800 text-zinc-300"
                }`}
              >
                {STATUS_LABELS[s.status]}
              </span>
            </div>
          ))}

          {!hasFullAccess && hiddenCount > 0 && (
            <div className="rounded-2xl border border-dashed border-bordure p-4 text-center">
              <p className="text-sm text-doux">
                {hiddenCount} séance{hiddenCount > 1 ? "s" : ""} supplémentaire{hiddenCount > 1 ? "s" : ""} masquée
                {hiddenCount > 1 ? "s" : ""}. Passez à Standard pour un historique illimité.
              </p>
              <Link
                to="/abonnement"
                className="mt-2 inline-block rounded-full bg-rose-500 px-4 py-1.5 text-xs font-semibold text-black transition-all hover:bg-rose-400"
              >
                Voir les offres
              </Link>
            </div>
          )}
        </div>
      )}

      {selectedId &&
        (() => {
          const selected = sessions.find((s) => s.id === selectedId);
          if (!selected) return null;
          return (
            <SessionDetailModal
              session={selected}
              onClose={() => setSelectedId(null)}
              onUpdate={updateSession}
            />
          );
        })()}
    </div>
  );
}
