import { useCallback, useEffect, useMemo, useState } from "react";
import {
  api,
  apiErrorMessage,
  formatUsd,
  type AdminActivityDay,
  type AdminAuditEntry,
  type AdminOverview,
  type AdminUserList,
  type AdminUserRow,
  type Plan,
} from "../lib/api";
import { useAuth } from "../lib/AuthContext";
import { Spinner } from "../components/Spinner";

type Tab = "vue" | "comptes" | "audit";

const PLAN_LABELS: Record<Plan, string> = { free: "Gratuit", standard: "Standard", premium: "Premium" };

const PLAN_BADGE: Record<Plan, string> = {
  free: "bg-zinc-800 text-doux",
  standard: "bg-sky-500/15 text-sky-300",
  premium: "bg-rose-500/15 text-rose-300",
};

const KIND_LABELS: Record<string, string> = {
  chat: "Chat coach",
  plan_generation: "Génération de programme",
  plan_progression: "Progression hebdomadaire",
};

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-bordure bg-zinc-950/80 p-3">
      <p className="text-xs uppercase tracking-wide text-doux">{label}</p>
      <p className="mt-1 text-2xl font-bold text-white">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-doux">{hint}</p>}
    </div>
  );
}

function formatDate(value: string | null): string {
  if (!value) return "jamais";
  return new Date(value).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

function relativeDays(value: string | null): string {
  if (!value) return "jamais revenu";
  const days = Math.floor((Date.now() - new Date(value).getTime()) / (24 * 3600 * 1000));
  if (days <= 0) return "aujourd'hui";
  if (days === 1) return "hier";
  return `il y a ${days} j`;
}

/** Barres d'activité sur 30 jours, dessinées sans dépendance de graphique. */
function ActivityChart({ days }: { days: AdminActivityDay[] }) {
  const max = Math.max(1, ...days.map((d) => Math.max(d.actifs, d.inscriptions)));
  return (
    <div className="rounded-xl border border-bordure bg-zinc-950/80 p-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-semibold text-white">Activité sur 30 jours</p>
        <div className="flex gap-3 text-xs">
          <span className="flex items-center gap-1 text-doux">
            <span className="h-2 w-2 rounded-sm bg-rose-500" /> actifs
          </span>
          <span className="flex items-center gap-1 text-doux">
            <span className="h-2 w-2 rounded-sm bg-sky-500" /> inscriptions
          </span>
        </div>
      </div>
      <div className="flex h-28 items-end gap-[3px]">
        {days.map((d) => (
          <div key={d.date} className="group relative flex flex-1 flex-col justify-end gap-[2px]">
            <div
              className="w-full rounded-sm bg-rose-500/80"
              style={{ height: `${(d.actifs / max) * 70}%` }}
            />
            <div
              className="w-full rounded-sm bg-sky-500/80"
              style={{ height: `${(d.inscriptions / max) * 70}%` }}
            />
            <span className="pointer-events-none absolute -top-1 left-1/2 z-10 hidden -translate-x-1/2 -translate-y-full whitespace-nowrap rounded border border-bordure-forte bg-black px-2 py-1 text-[11px] text-zinc-200 group-hover:block">
              {d.date} · {d.actifs} actif(s) · {d.inscriptions} inscription(s) · {formatUsd(d.coutMicroUsd)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Ce qui n'est pas branché échoue en silence : autant le dire ici. */
/** Vérifie l'envoi de bout en bout, et remonte l'erreur exacte du serveur SMTP. */
function TestEmail() {
  const [state, setState] = useState<"repos" | "envoi">("repos");
  const [resultat, setResultat] = useState<{ ok: boolean; message: string } | null>(null);

  async function envoyer() {
    setState("envoi");
    setResultat(null);
    try {
      const { data } = await api.post<{ destinataire: string }>("/admin/test-email");
      setResultat({ ok: true, message: `E-mail envoyé à ${data.destinataire}. Vérifiez aussi vos indésirables.` });
    } catch (err) {
      setResultat({ ok: false, message: apiErrorMessage(err, "L'envoi a échoué.") });
    } finally {
      setState("repos");
    }
  }

  return (
    <div className="rounded-xl border border-bordure bg-zinc-950/80 p-3">
      <p className="text-sm font-semibold text-white">Envoi d'e-mails</p>
      <p className="mt-0.5 text-xs text-doux">
        Envoie un message à votre propre adresse pour vérifier la configuration.
      </p>
      <button
        onClick={envoyer}
        disabled={state === "envoi"}
        className="mt-2 flex items-center gap-2 rounded-lg border border-bordure px-3 py-1.5 text-xs text-zinc-300 transition-colors hover:border-rose-700 hover:text-white disabled:opacity-50"
      >
        {state === "envoi" && <Spinner />}
        Envoyer un e-mail de test
      </button>
      {resultat && (
        <p
          className={`mt-2 rounded-md px-2.5 py-1.5 text-xs ${
            resultat.ok
              ? "border border-emerald-900 bg-emerald-950/40 text-emerald-300"
              : "border border-red-900 bg-red-950/40 text-red-400"
          }`}
        >
          {resultat.message}
        </p>
      )}
    </div>
  );
}

function ConfigurationAlerts({ configuration }: { configuration: AdminOverview["configuration"] }) {
  const manquants = [
    !configuration.emailsActifs && {
      titre: "Envoi d'e-mails inactif",
      detail:
        "Aucun serveur SMTP configuré : les liens de réinitialisation de mot de passe et de confirmation d'adresse ne partent pas. Renseignez SMTP_HOST chez votre hébergeur.",
    },
    !configuration.coachIaActif && {
      titre: "Coach IA inactif",
      detail: "Clé API Anthropic manquante : aucun programme ne peut être généré.",
    },
    !configuration.paiementEnLigneActif && {
      titre: "Paiement en ligne inactif",
      detail: "Les abonnements s'activent uniquement à la main depuis l'onglet Comptes.",
    },
  ].filter(Boolean) as { titre: string; detail: string }[];

  if (manquants.length === 0) return null;

  return (
    <div className="space-y-2">
      {manquants.map((m) => (
        <div key={m.titre} className="rounded-xl border border-amber-900/50 bg-amber-950/20 p-3">
          <p className="text-sm font-semibold text-amber-200">⚠ {m.titre}</p>
          <p className="mt-0.5 text-xs leading-relaxed text-amber-300/70">{m.detail}</p>
        </div>
      ))}
    </div>
  );
}

function Overview({ overview, activity }: { overview: AdminOverview; activity: AdminActivityDay[] }) {
  const { comptes, frequentation, activite, coutIa } = overview;
  return (
    <div className="space-y-5">
      <ConfigurationAlerts configuration={overview.configuration} />
      <TestEmail />
      <section>
        <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-doux">Comptes et abonnements</h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Comptes" value={String(comptes.total)} hint={`+${comptes.inscriptions7j} sur 7 j`} />
          <Stat
            label="Abonnés"
            value={String(comptes.payants)}
            hint={`${comptes.tauxConversionPct}% de conversion`}
          />
          <Stat label="Essais en cours" value={String(comptes.essaisEnCours)} />
          <Stat
            label="Essais perdus"
            value={String(comptes.essaisExpiresNonConvertis)}
            hint="expirés, restés gratuits"
          />
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          {(Object.keys(PLAN_LABELS) as Plan[]).map((plan) => (
            <span key={plan} className={`rounded-full px-3 py-1 text-xs font-semibold ${PLAN_BADGE[plan]}`}>
              {PLAN_LABELS[plan]} : {comptes.parOffre[plan] ?? 0}
            </span>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-doux">Fréquentation</h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Actifs 24 h" value={String(frequentation.actifs24h)} />
          <Stat label="Actifs 7 j" value={String(frequentation.actifs7j)} />
          <Stat
            label="Actifs 30 j"
            value={String(frequentation.actifs30j)}
            hint={`${frequentation.retention30jPct}% des comptes`}
          />
          <Stat
            label="Jamais revenus"
            value={String(frequentation.jamaisRevenus)}
            hint="inscrits sans retour"
          />
        </div>
        <div className="mt-2">
          <ActivityChart days={activity} />
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <Stat label="Programmes générés (30 j)" value={String(activite.programmesGeneres30j)} />
          <Stat label="Objectifs à venir" value={String(activite.athletesAvecObjectifAVenir)} />
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-doux">Coût du coach IA</h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat
            label="Sur 30 jours"
            value={formatUsd(coutIa.total30jMicroUsd)}
            hint={`${coutIa.appels30j} appel(s)`}
          />
          <Stat label="Depuis le début" value={formatUsd(coutIa.totalMicroUsd)} hint={`${coutIa.appelsTotal} appel(s)`} />
          <Stat
            label="Par abonné (30 j)"
            value={formatUsd(coutIa.coutMoyenParPayant30jMicroUsd)}
            hint="à comparer au prix de l'offre"
          />
          <Stat
            label="Tokens"
            value={`${Math.round((coutIa.tokensEntree + coutIa.tokensSortie) / 1000)} k`}
            hint="entrée + sortie"
          />
        </div>
        {coutIa.parType.length > 0 && (
          <ul className="mt-2 space-y-1 rounded-xl border border-bordure bg-zinc-950/80 p-3">
            {coutIa.parType.map((t) => (
              <li key={t.kind} className="flex items-center justify-between text-sm">
                <span className="text-doux">{KIND_LABELS[t.kind] ?? t.kind}</span>
                <span className="text-zinc-300">
                  {t.appels} appel(s) · <span className="font-mono text-white">{formatUsd(t.coutMicroUsd)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-1.5 text-xs text-tres-doux">
          Estimation calculée sur les tarifs publics Anthropic relevés le {coutIa.tarifsMisAJourLe}. Elle sert de
          repère, pas de facture.
        </p>
      </section>
    </div>
  );
}

function UserRowCard({
  user,
  onChangePlan,
  busy,
}: {
  user: AdminUserRow;
  onChangePlan: (user: AdminUserRow, plan: Plan) => void;
  busy: boolean;
}) {
  return (
    <div className="rounded-xl border border-bordure bg-zinc-950/80 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-2 truncate text-sm font-semibold text-white">
            {user.name}
            {user.role === "admin" && (
              <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-bold uppercase text-amber-300">
                admin
              </span>
            )}
          </p>
          <p className="truncate text-xs text-doux">{user.email}</p>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${PLAN_BADGE[user.plan]}`}>
          {PLAN_LABELS[user.plan]}
          {user.plan === "free" && user.isTrialActive && " (essai)"}
        </span>
      </div>

      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-doux sm:grid-cols-4">
        <div>
          <dt className="inline">Inscrit </dt>
          <dd className="inline text-zinc-300">{formatDate(user.createdAt)}</dd>
        </div>
        <div>
          <dt className="inline">Vu </dt>
          <dd className="inline text-zinc-300">{relativeDays(user.lastSeenAt)}</dd>
        </div>
        <div>
          <dt className="inline">Séances </dt>
          <dd className="inline text-zinc-300">{user._count.sessions}</dd>
        </div>
        <div>
          <dt className="inline">Coût IA </dt>
          <dd className="inline text-zinc-300">{formatUsd(user.coutIaMicroUsd)}</dd>
        </div>
      </dl>

      {user.profile && (
        <p className="mt-1.5 truncate text-xs text-doux">
          🎯 {user.profile.objectif} — {formatDate(user.profile.objectifDate)}
        </p>
      )}

      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {(Object.keys(PLAN_LABELS) as Plan[]).map((plan) => (
          <button
            key={plan}
            onClick={() => onChangePlan(user, plan)}
            disabled={busy || user.plan === plan}
            className="rounded-md border border-bordure px-2.5 py-1 text-xs text-zinc-300 transition-colors hover:border-rose-700 hover:text-white disabled:opacity-40 disabled:hover:border-bordure disabled:hover:text-zinc-300"
          >
            {user.plan === plan ? `${PLAN_LABELS[plan]} ✓` : `Passer en ${PLAN_LABELS[plan]}`}
          </button>
        ))}
      </div>
    </div>
  );
}

function Users() {
  const [list, setList] = useState<AdminUserList | null>(null);
  const [query, setQuery] = useState("");
  const [planFilter, setPlanFilter] = useState<Plan | "">("");
  const [page, setPage] = useState(1);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), perPage: "25" });
      if (query.trim()) params.set("q", query.trim());
      if (planFilter) params.set("plan", planFilter);
      const { data } = await api.get<AdminUserList>(`/admin/users?${params}`);
      setList(data);
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err, "Impossible de charger les comptes."));
    } finally {
      setLoading(false);
    }
  }, [page, query, planFilter]);

  useEffect(() => {
    const timer = setTimeout(load, 250);
    return () => clearTimeout(timer);
  }, [load]);

  async function changePlan(user: AdminUserRow, plan: Plan) {
    const label = PLAN_LABELS[plan];
    const motif = window.prompt(
      `Passer ${user.email} en offre ${label} ?\n\nMotif (conservé dans le journal d'audit) :`,
      plan === "free" ? "Résiliation" : "Paiement reçu"
    );
    if (motif === null) return;

    setBusyId(user.id);
    setError(null);
    try {
      await api.patch(`/admin/users/${user.id}/plan`, { plan, motif });
      await load();
    } catch (err) {
      setError(apiErrorMessage(err, "Impossible de modifier l'offre."));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <input
          value={query}
          onChange={(e) => {
            setPage(1);
            setQuery(e.target.value);
          }}
          placeholder="Rechercher un email ou un nom..."
          className="min-w-0 flex-1 rounded-lg border border-bordure bg-zinc-900 px-3 py-2 text-sm text-white outline-none transition-colors focus:border-rose-500"
        />
        <select
          value={planFilter}
          onChange={(e) => {
            setPage(1);
            setPlanFilter(e.target.value as Plan | "");
          }}
          className="rounded-lg border border-bordure bg-zinc-900 px-3 py-2 text-sm text-white outline-none focus:border-rose-500"
        >
          <option value="">Toutes les offres</option>
          <option value="free">Gratuit</option>
          <option value="standard">Standard</option>
          <option value="premium">Premium</option>
        </select>
      </div>

      {error && (
        <p className="rounded-md border border-red-900 bg-red-950/50 px-3 py-2 text-sm text-red-400">{error}</p>
      )}

      {loading && !list ? (
        <div className="flex justify-center py-8">
          <Spinner />
        </div>
      ) : (
        list && (
          <>
            <p className="text-xs text-doux">
              {list.total} compte{list.total > 1 ? "s" : ""} — page {list.page}/{list.pages}
            </p>
            <div className="space-y-2">
              {list.users.map((u) => (
                <UserRowCard key={u.id} user={u} onChangePlan={changePlan} busy={busyId === u.id} />
              ))}
              {list.users.length === 0 && <p className="py-6 text-center text-sm text-doux">Aucun compte.</p>}
            </div>

            {list.pages > 1 && (
              <div className="flex items-center justify-center gap-3 pt-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={list.page <= 1}
                  className="rounded-md border border-bordure px-3 py-1.5 text-sm text-zinc-300 disabled:opacity-40"
                >
                  Précédent
                </button>
                <span className="text-sm text-doux">
                  {list.page} / {list.pages}
                </span>
                <button
                  onClick={() => setPage((p) => Math.min(list.pages, p + 1))}
                  disabled={list.page >= list.pages}
                  className="rounded-md border border-bordure px-3 py-1.5 text-sm text-zinc-300 disabled:opacity-40"
                >
                  Suivant
                </button>
              </div>
            )}
          </>
        )
      )}
    </div>
  );
}

function Audit() {
  const [entries, setEntries] = useState<AdminAuditEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<{ actions: AdminAuditEntry[] }>("/admin/audit")
      .then(({ data }) => setEntries(data.actions))
      .catch((err) => setError(apiErrorMessage(err, "Impossible de charger le journal.")));
  }, []);

  if (error) {
    return <p className="rounded-md border border-red-900 bg-red-950/50 px-3 py-2 text-sm text-red-400">{error}</p>;
  }
  if (!entries) {
    return (
      <div className="flex justify-center py-8">
        <Spinner />
      </div>
    );
  }
  if (entries.length === 0) {
    return <p className="py-6 text-center text-sm text-doux">Aucune action enregistrée.</p>;
  }

  return (
    <ul className="space-y-2">
      {entries.map((entry) => {
        const details = entry.details as { de?: string; vers?: string; motif?: string | null } | null;
        return (
          <li key={entry.id} className="rounded-xl border border-bordure bg-zinc-950/80 p-3 text-sm">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="font-semibold text-white">
                {entry.action === "plan.update" ? "Changement d'offre" : "Changement de rôle"}
              </span>
              <span className="text-xs text-doux">
                {new Date(entry.createdAt).toLocaleString("fr-FR")}
              </span>
            </div>
            <p className="mt-1 text-doux">
              <span className="text-zinc-300">{entry.admin.email}</span>
              {" → "}
              <span className="text-zinc-300">{entry.targetUser?.email ?? "compte supprimé"}</span>
              {details?.de && details?.vers && (
                <>
                  {" : "}
                  {details.de} → <span className="text-rose-300">{details.vers}</span>
                </>
              )}
            </p>
            {details?.motif && <p className="mt-0.5 text-xs italic text-doux">« {details.motif} »</p>}
          </li>
        );
      })}
    </ul>
  );
}

export function Admin() {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>("vue");
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [activity, setActivity] = useState<AdminActivityDay[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      api.get<AdminOverview>("/admin/overview"),
      api.get<{ jours: AdminActivityDay[] }>("/admin/activity"),
    ])
      .then(([o, a]) => {
        setOverview(o.data);
        setActivity(a.data.jours);
      })
      .catch((err) => setError(apiErrorMessage(err, "Impossible de charger les statistiques.")));
  }, []);

  const tabs = useMemo(
    () =>
      [
        { key: "vue" as const, label: "Vue d'ensemble" },
        { key: "comptes" as const, label: "Comptes" },
        { key: "audit" as const, label: "Journal" },
      ],
    []
  );

  // Le serveur reste la seule autorité : cet écran ne fait que masquer une
  // interface inutile, il ne protège rien par lui-même.
  if (user && user.role !== "admin") {
    return <p className="py-10 text-center text-sm text-doux">Cette page n'est pas accessible.</p>;
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-white">Administration</h1>
        <p className="mt-0.5 text-sm text-doux">Abonnements, fréquentation et coût du coach IA.</p>
      </div>

      <div className="flex gap-1 rounded-lg border border-bordure bg-zinc-950 p-1">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              tab === t.key ? "bg-rose-500 text-black" : "text-doux hover:text-white"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && (
        <p className="rounded-md border border-red-900 bg-red-950/50 px-3 py-2 text-sm text-red-400">{error}</p>
      )}

      {tab === "vue" &&
        (overview ? (
          <Overview overview={overview} activity={activity} />
        ) : (
          !error && (
            <div className="flex justify-center py-8">
              <Spinner />
            </div>
          )
        ))}
      {tab === "comptes" && <Users />}
      {tab === "audit" && <Audit />}
    </div>
  );
}
