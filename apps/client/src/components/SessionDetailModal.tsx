import { useState } from "react";
import type { Session, SessionBlock } from "../lib/api";

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

const BLOCKS: { key: keyof NonNullable<Session["structure"]>; label: string; color: string }[] = [
  { key: "echauffement", label: "Échauffement", color: "border-sky-800 bg-sky-950/30" },
  { key: "corps", label: "Corps de séance", color: "border-rose-800 bg-rose-950/30" },
  { key: "retourCalme", label: "Retour au calme", color: "border-emerald-800 bg-emerald-950/30" },
];

function BlockCard({ label, block, color }: { label: string; block: SessionBlock; color: string }) {
  return (
    <div className={`rounded-xl border p-3 ${color}`}>
      <div className="mb-1 flex items-center justify-between">
        <p className="text-sm font-semibold text-white">{label}</p>
        <span className="text-xs text-zinc-400">{block.dureeMin} min</span>
      </div>
      <p className="mb-1 text-xs font-medium text-zinc-300">{block.cible}</p>
      <p className="text-sm text-zinc-400">{block.description}</p>

      {block.exercices && block.exercices.length > 0 && (
        <ul className="mt-2 space-y-1.5 border-t border-white/10 pt-2">
          {block.exercices.map((ex, i) => (
            <li key={i} className="flex items-start gap-2 text-xs">
              <span className="mt-0.5 shrink-0 rounded bg-black/30 px-1.5 py-0.5 font-mono text-zinc-300">
                {ex.repetitions}
              </span>
              <span className="text-zinc-400">
                {ex.allure}
                {ex.recuperation ? ` · récup ${ex.recuperation}` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface Props {
  session: Session;
  onClose: () => void;
  onUpdate: (id: string, status: Session["status"], ressenti?: string) => Promise<void>;
  allSessions?: Session[];
  onSwap?: (sessionIdA: string, sessionIdB: string) => Promise<void>;
}

export function SessionDetailModal({ session, onClose, onUpdate, allSessions, onSwap }: Props) {
  const [ressenti, setRessenti] = useState(session.ressenti ?? "");
  const [saving, setSaving] = useState(false);
  const [reorganizing, setReorganizing] = useState(false);
  const isRestDay = session.sport === "repos";

  async function updateStatus(status: Session["status"]) {
    setSaving(true);
    try {
      await onUpdate(session.id, status, ressenti || undefined);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  async function saveRessenti() {
    setSaving(true);
    try {
      await onUpdate(session.id, session.status, ressenti || undefined);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  async function handleSwap(targetId: string) {
    if (!onSwap) return;
    setSaving(true);
    try {
      await onSwap(session.id, targetId);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  const dateLabel = new Date(session.date).toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const otherDays = allSessions?.filter((s) => s.id !== session.id) ?? [];

  return (
    <div className="fixed inset-0 z-30 flex items-end justify-center sm:items-center">
      <div className="animate-fade-in absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="animate-fade-in-up relative max-h-[85vh] w-full max-w-[420px] overflow-y-auto rounded-t-3xl border border-zinc-800 bg-zinc-950 p-5 sm:rounded-3xl">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-2xl">
              {SPORT_ICON[session.sport]}
            </span>
            <div className="min-w-0">
              <p className="text-xs capitalize uppercase tracking-wide text-zinc-500">{dateLabel}</p>
              <p className="text-lg font-bold leading-tight text-white">{session.titre}</p>
              <p className="text-sm text-zinc-500">{SPORT_LABELS[session.sport]}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Fermer"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-zinc-500 transition-colors hover:bg-zinc-900 hover:text-white"
          >
            ✕
          </button>
        </div>

        {!isRestDay && session.objectif && (
          <div className="mb-4 rounded-xl border border-rose-900/50 bg-gradient-to-br from-rose-950/40 to-black p-3.5">
            <p className="mb-1 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-rose-400">
              🎯 Pourquoi cette séance ?
            </p>
            <p className="text-sm leading-relaxed text-zinc-200">{session.objectif}</p>
          </div>
        )}

        {!isRestDay && (
          <div className="mb-4 flex flex-wrap gap-4 text-sm text-zinc-300">
            <span>⏱️ {session.dureeMin} min</span>
            {session.distanceKm != null && <span>📍 {session.distanceKm} km</span>}
          </div>
        )}

        {session.structure ? (
          <div className="mb-4 space-y-2">
            <p className="text-xs font-bold uppercase tracking-wide text-zinc-500">Détail de la séance</p>
            {BLOCKS.map(({ key, label, color }) => (
              <BlockCard key={key} label={label} block={session.structure![key]} color={color} />
            ))}
          </div>
        ) : (
          session.description && <p className="mb-4 text-sm leading-relaxed text-zinc-300">{session.description}</p>
        )}

        {!isRestDay && (
          <div className="mb-4 space-y-1">
            <label className="text-sm text-zinc-400">Ressenti</label>
            <textarea
              value={ressenti}
              onChange={(e) => setRessenti(e.target.value)}
              rows={2}
              placeholder="Comment s'est passée la séance ?"
              className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-white outline-none transition-colors focus:border-rose-500"
            />
          </div>
        )}

        {!isRestDay &&
          (session.status === "planifiee" ? (
            <div className="flex gap-2">
              <button
                onClick={() => updateStatus("faite")}
                disabled={saving}
                className="flex-1 rounded-lg bg-emerald-600 px-3 py-2.5 text-sm font-semibold text-white transition-all duration-150 hover:bg-emerald-500 active:scale-[0.97] disabled:opacity-50"
              >
                ✓ Marquer faite
              </button>
              <button
                onClick={() => updateStatus("manquee")}
                disabled={saving}
                className="flex-1 rounded-lg border border-zinc-800 px-3 py-2.5 text-sm font-semibold text-zinc-300 transition-all duration-150 hover:bg-zinc-900 active:scale-[0.97] disabled:opacity-50"
              >
                Manquée
              </button>
            </div>
          ) : (
            <div className="flex gap-2">
              <button
                onClick={saveRessenti}
                disabled={saving}
                className="flex-1 rounded-lg bg-rose-500 px-3 py-2.5 text-sm font-semibold text-black transition-all duration-150 hover:bg-rose-400 active:scale-[0.97] disabled:opacity-50"
              >
                Enregistrer
              </button>
              <button
                onClick={() => updateStatus("planifiee")}
                disabled={saving}
                className="flex-1 rounded-lg border border-zinc-800 px-3 py-2.5 text-sm font-semibold text-zinc-300 transition-all duration-150 hover:bg-zinc-900 active:scale-[0.97] disabled:opacity-50"
              >
                Réinitialiser
              </button>
            </div>
          ))}

        {onSwap && otherDays.length > 0 && (
          <div className="mt-4 border-t border-zinc-800 pt-4">
            {!reorganizing ? (
              <button
                onClick={() => setReorganizing(true)}
                className="w-full rounded-lg border border-zinc-800 px-3 py-2.5 text-sm font-semibold text-zinc-300 transition-colors hover:bg-zinc-900"
              >
                🔄 Déplacer vers un autre jour
              </button>
            ) : (
              <div className="animate-fade-in space-y-2">
                <p className="text-sm text-zinc-400">Échanger avec :</p>
                <div className="grid grid-cols-2 gap-2">
                  {otherDays.map((d) => (
                    <button
                      key={d.id}
                      onClick={() => handleSwap(d.id)}
                      disabled={saving}
                      className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-2 text-left text-xs text-zinc-200 transition-colors hover:border-rose-700 hover:bg-zinc-800 disabled:opacity-50"
                    >
                      <span className="text-base">{SPORT_ICON[d.sport]}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium capitalize">
                          {new Date(d.date).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric" })}
                        </span>
                        <span className="block truncate text-zinc-500">{SPORT_LABELS[d.sport]}</span>
                      </span>
                    </button>
                  ))}
                </div>
                <button
                  onClick={() => setReorganizing(false)}
                  className="w-full rounded-lg px-3 py-1.5 text-xs text-zinc-500 hover:text-zinc-300"
                >
                  Annuler
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
