import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  api,
  apiErrorMessage,
  isSubscriptionRequiredError,
  type AthleteProfile,
  type Session,
  type TrainingPlan,
  isGenerationRunning,
  type GenerationJob,
} from "../lib/api";
import { useAuth } from "../lib/AuthContext";
import { SessionCard } from "../components/SessionCard";
import { SessionDetailModal } from "../components/SessionDetailModal";
import { Spinner } from "../components/Spinner";

interface OvertrainingInsight {
  risk: "low" | "moderate" | "high";
  reasons: string[];
}

const SPORT_ICON: Record<Session["sport"], string> = {
  natation: "🏊",
  velo: "🚴",
  course: "🏃",
  renfo: "🏋️",
  repos: "😴",
};

/** Sondage de l'avancement : assez fréquent pour paraître vivant, assez espacé
 * pour ne pas marteler le serveur pendant deux minutes. */
const POLL_INTERVAL_MS = 2500;

export function Dashboard() {
  const { user } = useAuth();
  const [plan, setPlan] = useState<TrainingPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [subscriptionRequired, setSubscriptionRequired] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const didAutoGenerate = useRef(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [profile, setProfile] = useState<AthleteProfile | null>(null);
  const [overtraining, setOvertraining] = useState<OvertrainingInsight | null>(null);
  const [hasPastPlan, setHasPastPlan] = useState(false);
  const [debriefDismissed, setDebriefDismissed] = useState(false);

  const loadPlan = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get<TrainingPlan | null>("/plans/current");
      setPlan(data);
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * La génération dure souvent plus d'une minute : le serveur la traite en
   * tâche de fond et l'on suit son avancement. L'athlète peut donc quitter
   * l'écran, ou revenir plus tard, sans perdre le programme en cours.
   */
  const followJob = useCallback(
    async (job: GenerationJob) => {
      setGenerating(true);
      setError(null);

      let current = job;
      while (isGenerationRunning(current)) {
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
        try {
          const { data } = await api.get<GenerationJob>(`/plans/jobs/${current.id}`);
          current = data;
        } catch {
          // Coupure réseau passagère : on retente au tour suivant plutôt que
          // d'abandonner une génération qui est peut-être en train d'aboutir.
          continue;
        }
      }

      setGenerating(false);
      if (current.status === "reussie") {
        setDebriefDismissed(false);
        await loadPlan();
      } else {
        setError(current.error ?? "Échec de la génération du programme.");
      }
    },
    [loadPlan]
  );

  const startGeneration = useCallback(
    async (endpoint: "/plans/generate" | "/plans/next") => {
      setGenerating(true);
      setError(null);
      setSubscriptionRequired(false);
      try {
        const { data } = await api.post<GenerationJob>(endpoint);
        await followJob(data);
      } catch (err) {
        setGenerating(false);
        if (isSubscriptionRequiredError(err)) {
          setSubscriptionRequired(true);
        }
        setError(apiErrorMessage(err, "Échec de la génération du programme."));
      }
    },
    [followJob]
  );

  const generatePlan = useCallback(() => startGeneration("/plans/generate"), [startGeneration]);
  const generateNextWeek = useCallback(() => startGeneration("/plans/next"), [startGeneration]);

  /**
   * Réajuste les jours restants. Le motif est facultatif mais précieux : il
   * permet au coach de distinguer un imprévu d'agenda d'une douleur.
   */
  const adjustWeek = useCallback(async () => {
    const motif = window.prompt(
      "Réajuster les jours restants de votre semaine.\n\nQue s'est-il passé ? (facultatif, mais ça aide votre coach)",
      ""
    );
    if (motif === null) return;

    setGenerating(true);
    setError(null);
    try {
      const { data } = await api.post<GenerationJob>("/plans/adjust", { motif: motif.trim() || undefined });
      await followJob(data);
    } catch (err) {
      setGenerating(false);
      setError(apiErrorMessage(err, "Impossible de réajuster votre semaine."));
    }
  }, [followJob]);

  useEffect(() => {
    loadPlan();
    // Une génération lancée puis quittée continue côté serveur : on la reprend
    // au lieu d'afficher un écran vide.
    api
      .get<GenerationJob | null>("/plans/jobs/latest")
      .then(({ data }) => {
        if (isGenerationRunning(data)) followJob(data!);
      })
      .catch(() => undefined);
    api.get<AthleteProfile | null>("/profile").then(({ data }) => setProfile(data));
    api.get<{ exists: boolean }>("/plans/previous").then(({ data }) => setHasPastPlan(data.exists));
    if (user?.isPremium) {
      api.get<OvertrainingInsight>("/insights/overtraining").then(({ data }) => setOvertraining(data));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadPlan]);

  useEffect(() => {
    if (searchParams.get("generate") === "1" && !didAutoGenerate.current) {
      didAutoGenerate.current = true;
      generatePlan();
      searchParams.delete("generate");
      setSearchParams(searchParams, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function updateSession(id: string, status: Session["status"], ressenti?: string) {
    const { data } = await api.patch<Session>(`/sessions/${id}`, { status, ressenti });
    setPlan((prev) =>
      prev ? { ...prev, sessions: prev.sessions.map((s) => (s.id === id ? data : s)) } : prev
    );
  }

  async function swapSessions(sessionIdA: string, sessionIdB: string) {
    const { data } = await api.post<Session[]>("/sessions/swap", { sessionIdA, sessionIdB });
    setPlan((prev) =>
      prev
        ? {
            ...prev,
            sessions: prev.sessions.map((s) => data.find((updated) => updated.id === s.id) ?? s),
          }
        : prev
    );
  }

  const daysRemaining = useMemo(() => {
    if (!profile) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const target = new Date(profile.objectifDate);
    target.setHours(0, 0, 0, 0);
    return Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  }, [profile]);

  const { next, rest } = useMemo(() => {
    if (!plan) return { next: null as Session | null, rest: [] as Session[] };
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const upcoming = plan.sessions.filter(
      (s) => s.sport !== "repos" && s.status === "planifiee" && new Date(s.date) >= today
    );
    const nextSession = upcoming[0] ?? null;
    const rest = plan.sessions.filter((s) => s.id !== nextSession?.id);
    return { next: nextSession, rest };
  }, [plan]);

  function confirmRegenerate() {
    // Les séances déjà réalisées sont conservées côté serveur ; seules celles
    // encore planifiées sont remplacées. On le dit avant d'agir.
    const done = plan?.sessions.filter((s) => s.status !== "planifiee").length ?? 0;
    const message =
      done > 0
        ? `Régénérer la semaine ? Vos ${done} séance(s) déjà validée(s) sont conservées, les séances encore planifiées seront remplacées.`
        : "Régénérer la semaine ? Les séances encore planifiées seront remplacées.";
    if (window.confirm(message)) generatePlan();
  }

  const trialDaysLeft =
    user && user.plan === "free" && user.isTrialActive
      ? Math.max(0, Math.ceil((new Date(user.trialEndsAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
      : null;

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-bold text-white">Mon programme</h1>
        {user && !user.hasStandardAccess ? (
          <Link
            to="/abonnement"
            className="rounded-full bg-rose-500 px-3.5 py-1.5 text-xs font-semibold text-black transition-all duration-150 hover:scale-[1.03] hover:bg-rose-400 active:scale-[0.97]"
          >
            S'abonner
          </Link>
        ) : (
          <button
            onClick={plan ? confirmRegenerate : hasPastPlan ? generateNextWeek : generatePlan}
            disabled={generating}
            className="flex items-center gap-2 rounded-full bg-rose-500 px-3.5 py-1.5 text-xs font-semibold text-black transition-all duration-150 hover:scale-[1.03] hover:bg-rose-400 active:scale-[0.97] disabled:opacity-50 disabled:hover:scale-100"
          >
            {generating && <Spinner className="border-black/30 border-t-black" />}
            {generating
              ? "Génération..."
              : plan
                ? "Régénérer"
                : hasPastPlan
                  ? "Semaine terminée, nouvelle semaine"
                  : "Générer"}
          </button>
        )}
      </div>

      {plan && !generating && (
        <button
          onClick={adjustWeek}
          className="mb-4 w-full rounded-2xl border border-dashed border-zinc-800 px-3 py-2.5 text-sm text-zinc-400 transition-colors hover:border-rose-800/70 hover:text-zinc-200"
        >
          Je n'ai pas pu m'entraîner — réajuster ma semaine
        </button>
      )}

      {plan?.periodization && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Link
            to="/zones"
            className="rounded-full border border-rose-900/50 bg-rose-950/30 px-3 py-1 text-xs font-semibold text-rose-300 transition-colors hover:border-rose-700 hover:text-rose-200"
          >
            {plan.periodization.label}
            {plan.periodization.weeksToGoal > 0 && ` · J-${plan.periodization.weeksToGoal} sem.`}
          </Link>
          <a
            href="/api/calendar/sessions.ics"
            className="rounded-full border border-zinc-800 px-3 py-1 text-xs text-zinc-400 transition-colors hover:border-zinc-700 hover:text-zinc-200"
          >
            Ajouter à mon agenda
          </a>
        </div>
      )}

      {plan?.debrief && !debriefDismissed && (
        <div className="animate-fade-in-up mb-4 rounded-2xl border border-rose-900/50 bg-gradient-to-br from-rose-950/50 to-black p-4">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <p className="text-xs font-bold uppercase tracking-wide text-rose-400">🎉 Débrief de la semaine passée</p>
            <button
              onClick={() => setDebriefDismissed(true)}
              aria-label="Fermer"
              className="shrink-0 text-zinc-500 transition-colors hover:text-white"
            >
              ✕
            </button>
          </div>
          <p className="text-sm leading-relaxed text-zinc-200">{plan.debrief}</p>
        </div>
      )}

      {trialDaysLeft !== null && (
        <div className="animate-fade-in-up mb-4 flex items-center justify-between gap-3 rounded-2xl border border-zinc-800 bg-zinc-950/80 px-3.5 py-2.5">
          <p className="text-xs text-zinc-400">
            🎁 Essai gratuit : encore {trialDaysLeft} jour{trialDaysLeft > 1 ? "s" : ""}
          </p>
          <Link to="/abonnement" className="text-xs font-semibold text-rose-400 hover:underline">
            Voir les offres
          </Link>
        </div>
      )}

      {overtraining && overtraining.risk !== "low" && (
        <div
          className={`animate-fade-in-up mb-4 rounded-2xl border p-3.5 ${
            overtraining.risk === "high" ? "border-red-800 bg-red-950/30" : "border-amber-800 bg-amber-950/20"
          }`}
        >
          <p className={`text-sm font-semibold ${overtraining.risk === "high" ? "text-red-300" : "text-amber-300"}`}>
            ⚠️ Risque de surentraînement {overtraining.risk === "high" ? "élevé" : "modéré"}
          </p>
          <ul className="mt-1 space-y-0.5 text-xs text-zinc-400">
            {overtraining.reasons.map((r) => (
              <li key={r}>• {r}</li>
            ))}
          </ul>
        </div>
      )}

      {profile && daysRemaining !== null && (
        <div className="animate-fade-in-up mb-4 flex items-center gap-3 rounded-2xl border border-rose-900/50 bg-gradient-to-r from-rose-950/60 to-black p-3.5">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-rose-600/20 text-lg font-black text-rose-400">
            {daysRemaining > 0 ? `J-${daysRemaining}` : daysRemaining === 0 ? "J-J" : "🏁"}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-white">{profile.objectif}</p>
            <p className="text-xs text-zinc-400">
              {daysRemaining > 0
                ? `${daysRemaining} jour${daysRemaining > 1 ? "s" : ""} avant l'épreuve`
                : daysRemaining === 0
                  ? "C'est aujourd'hui !"
                  : "Épreuve passée"}
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="mb-4 rounded-md border border-red-900 bg-red-950/50 px-3 py-2 text-sm text-red-400">
          <p>{error}</p>
          {subscriptionRequired && (
            <Link to="/abonnement" className="mt-1 inline-block font-semibold text-rose-300 hover:underline">
              Voir les offres →
            </Link>
          )}
        </div>
      )}

      {generating ? (
        <div className="animate-fade-in-up rounded-2xl border border-rose-900/40 bg-gradient-to-b from-rose-950/25 to-zinc-950/80 p-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center">
            <span className="h-9 w-9 animate-spin rounded-full border-[3px] border-rose-500/25 border-t-rose-500" />
          </div>
          <p className="text-sm font-semibold text-white">Votre coach prépare votre semaine…</p>
          <p className="mx-auto mt-1.5 max-w-xs text-xs leading-relaxed text-zinc-400">
            Cela prend généralement une à deux minutes. Vous pouvez fermer l'application : la génération continue et
            vous retrouverez votre programme en revenant.
          </p>
        </div>
      ) : loading ? (
        <p className="flex items-center gap-2 text-zinc-500">
          <Spinner /> Chargement...
        </p>
      ) : !plan ? (
        <div className="rounded-2xl border border-dashed border-zinc-800 p-8 text-center text-zinc-500">
          {hasPastPlan
            ? 'Votre semaine précédente est terminée. Appuyez sur "Semaine terminée, nouvelle semaine" pour enchaîner avec une progression maîtrisée.'
            : 'Aucun programme pour cette semaine. Appuyez sur "Générer" pour que votre coach IA en crée un.'}
        </div>
      ) : (
        <div className="space-y-5">
          {next && (
            <div
              role="button"
              tabIndex={0}
              onClick={() => setSelectedId(next.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") setSelectedId(next.id);
              }}
              className="animate-fade-in-up relative cursor-pointer overflow-hidden rounded-3xl border border-zinc-800 bg-gradient-to-br from-zinc-900 to-black p-5 transition-colors duration-200 hover:border-zinc-700"
            >
              <span className="absolute right-4 top-4 rounded-full bg-rose-600 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-white">
                À venir
              </span>
              <p className="text-xs uppercase tracking-wide text-zinc-500">
                {new Date(next.date).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "short" })}
              </p>
              <div className="mt-3 flex items-center gap-3">
                <span className="text-4xl">{SPORT_ICON[next.sport]}</span>
                <div>
                  <p className="text-lg font-bold leading-tight text-white">{next.titre}</p>
                  <p className="text-sm text-zinc-400">
                    {next.dureeMin} min{next.distanceKm ? ` · ${next.distanceKm} km` : ""}
                  </p>
                </div>
              </div>
              {next.description && <p className="mt-3 text-sm text-zinc-300">{next.description}</p>}
            </div>
          )}

          <div className="space-y-3">
            {rest.map((session, i) => (
              <div key={session.id} className="animate-fade-in-up" style={{ animationDelay: `${i * 60}ms` }}>
                <SessionCard
                  session={session}
                  onOpen={() => setSelectedId(session.id)}
                  onQuickUpdate={(id, status) => updateSession(id, status)}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {selectedId &&
        (() => {
          const selected = plan?.sessions.find((s) => s.id === selectedId);
          if (!selected) return null;
          return (
            <SessionDetailModal
              session={selected}
              onClose={() => setSelectedId(null)}
              onUpdate={updateSession}
              allSessions={plan?.sessions}
              onSwap={swapSessions}
            />
          );
        })()}
    </div>
  );
}
