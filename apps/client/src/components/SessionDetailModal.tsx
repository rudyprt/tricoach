import { useState } from "react";
import type { Session, SessionBlock } from "../lib/api";
import { Dialog } from "../ui/Dialog";
import { Bouton } from "../ui/Bouton";

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
    <Dialog
      ouvert
      onClose={onClose}
      titre={session.titre}
      description={`${SPORT_LABELS[session.sport]} — ${dateLabel}`}
      bloquant={saving}
    >
      <div>
        <div className="mb-4 flex items-center gap-3">
          <span
            aria-hidden="true"
            className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-surface-haute text-2xl"
          >
            {SPORT_ICON[session.sport]}
          </span>
          {!isRestDay && (
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-doux">
              <span>{session.dureeMin} min</span>
              {session.distanceKm != null && <span>{session.distanceKm} km</span>}
            </div>
          )}
        </div>

        {!isRestDay && session.objectif && (
          <div className="mb-4 rounded-xl border border-rose-900/50 bg-gradient-to-br from-rose-950/40 to-black p-3.5">
            <p className="mb-1 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-rose-400">
              🎯 Pourquoi cette séance ?
            </p>
            <p className="text-sm leading-relaxed text-zinc-200">{session.objectif}</p>
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
              <Bouton variante="succes" pleineLargeur enCours={saving} onClick={() => updateStatus("faite")}>
                Marquer faite
              </Bouton>
              <Bouton variante="secondaire" pleineLargeur disabled={saving} onClick={() => updateStatus("manquee")}>
                Manquée
              </Bouton>
            </div>
          ) : (
            <div className="flex gap-2">
              <Bouton variante="principal" pleineLargeur enCours={saving} onClick={saveRessenti}>
                Enregistrer
              </Bouton>
              <Bouton variante="secondaire" pleineLargeur disabled={saving} onClick={() => updateStatus("planifiee")}>
                Réinitialiser
              </Bouton>
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
    </Dialog>
  );
}
