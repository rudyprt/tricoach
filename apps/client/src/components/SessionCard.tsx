import type { Session } from "../lib/api";

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

const STATUS_RING: Record<Session["status"], string> = {
  planifiee: "border-bordure",
  faite: "border-emerald-800",
  manquee: "border-red-900",
};

interface Props {
  session: Session;
  onOpen: () => void;
  onQuickUpdate: (id: string, status: Session["status"]) => void;
}

export function SessionCard({ session, onOpen, onQuickUpdate }: Props) {
  const isRestDay = session.sport === "repos";

  const dateLabel = new Date(session.date).toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "short",
  });

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onOpen();
      }}
      className={`w-full cursor-pointer rounded-2xl border bg-zinc-950 p-3 text-left transition-colors duration-200 hover:border-bordure-forte ${STATUS_RING[session.status]}`}
    >
      <div className="flex items-center gap-3">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-xl">
          {SPORT_ICON[session.sport]}
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-[11px] uppercase tracking-wide text-doux">{dateLabel}</p>
          <p className="truncate font-semibold text-white">
            {SPORT_LABELS[session.sport]} — {session.titre}
          </p>
          {!isRestDay && (
            <p className="text-sm text-doux">
              {session.dureeMin} min{session.distanceKm ? ` · ${session.distanceKm} km` : ""}
            </p>
          )}
        </div>

        {!isRestDay && session.status === "planifiee" && (
          <div className="flex shrink-0 gap-2">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onQuickUpdate(session.id, "faite");
              }}
              aria-label="Marquer comme faite"
              className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-600 text-white transition-all duration-150 hover:scale-110 hover:bg-emerald-500 active:scale-90"
            >
              ✓
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onQuickUpdate(session.id, "manquee");
              }}
              aria-label="Marquer comme manquée"
              className="flex h-9 w-9 items-center justify-center rounded-full border border-bordure text-doux transition-all duration-150 hover:scale-110 hover:bg-zinc-900 active:scale-90"
            >
              ✕
            </button>
          </div>
        )}

        {session.status === "faite" && (
          <span className="shrink-0 rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-medium text-emerald-300">
            Fait
          </span>
        )}
        {session.status === "manquee" && (
          <span className="shrink-0 rounded-full bg-red-500/15 px-2.5 py-1 text-xs font-medium text-red-300">
            Manquée
          </span>
        )}

        {(isRestDay || session.status !== "planifiee") && <span className="shrink-0 text-zinc-700">›</span>}
      </div>

      {session.description && (
        <p className="mt-2 truncate pl-[3.75rem] text-sm text-doux">{session.description}</p>
      )}
      {session.ressenti && (
        <p className="mt-1 truncate pl-[3.75rem] text-sm italic text-emerald-300">Ressenti : {session.ressenti}</p>
      )}
    </div>
  );
}
