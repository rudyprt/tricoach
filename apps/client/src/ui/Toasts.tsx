import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { FaCircleCheck, FaCircleExclamation, FaCircleInfo, FaRotateLeft } from "react-icons/fa6";

/**
 * Retours d'action.
 *
 * L'application n'en avait aucun : enregistrer son profil affichait un bandeau
 * en haut d'un formulaire qu'on ne voyait pas si l'on avait déjà fait défiler
 * la page, et valider une séance ne disait rien du tout.
 *
 * L'annulation est la seconde raison d'être de ce composant : une séance
 * marquée « faite » par erreur obligeait à rouvrir son détail pour corriger.
 */

export type TonToast = "succes" | "erreur" | "info";

export interface OptionsToast {
  ton?: TonToast;
  /** Durée d'affichage. Une action d'annulation laisse plus de temps. */
  dureeMs?: number;
  /** Bouton d'annulation : le libellé est toujours « Annuler ». */
  onAnnuler?: () => void | Promise<void>;
}

interface Toast extends OptionsToast {
  id: number;
  message: string;
}

interface ContexteToasts {
  afficher: (message: string, options?: OptionsToast) => void;
}

const Contexte = createContext<ContexteToasts | null>(null);

export function useToasts(): ContexteToasts {
  const contexte = useContext(Contexte);
  if (!contexte) throw new Error("useToasts doit être utilisé dans un ToastProvider.");
  return contexte;
}

const ICONES: Record<TonToast, typeof FaCircleCheck> = {
  succes: FaCircleCheck,
  erreur: FaCircleExclamation,
  info: FaCircleInfo,
};

const COULEURS: Record<TonToast, string> = {
  succes: "border-succes/40 text-succes",
  erreur: "border-danger/40 text-danger",
  info: "border-info/40 text-info",
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const prochainId = useRef(0);

  const retirer = useCallback((id: number) => {
    setToasts((liste) => liste.filter((t) => t.id !== id));
  }, []);

  const afficher = useCallback((message: string, options: OptionsToast = {}) => {
    const id = (prochainId.current += 1);
    setToasts((liste) => [...liste.slice(-2), { id, message, ...options }]);
  }, []);

  const valeur = useMemo(() => ({ afficher }), [afficher]);

  return (
    <Contexte.Provider value={valeur}>
      {children}
      {createPortal(
        <div
          // « polite » et non « assertive » : ces messages accompagnent une
          // action volontaire, ils ne doivent pas couper la lecture en cours.
          role="status"
          aria-live="polite"
          className="pointer-events-none fixed inset-x-0 z-[60] flex flex-col items-center gap-2 px-4"
          style={{ bottom: "calc(var(--marge-basse) + 4.75rem)" }}
        >
          {toasts.map((toast) => (
            <ToastVisible key={toast.id} toast={toast} onFin={() => retirer(toast.id)} />
          ))}
        </div>,
        document.body
      )}
    </Contexte.Provider>
  );
}

function ToastVisible({ toast, onFin }: { toast: Toast; onFin: () => void }) {
  const ton = toast.ton ?? "info";
  const Icone = ICONES[ton];
  // Une annulation demande le temps de lire, de comprendre et de viser.
  const duree = toast.dureeMs ?? (toast.onAnnuler ? 7000 : 3500);

  useEffect(() => {
    const minuterie = setTimeout(onFin, duree);
    return () => clearTimeout(minuterie);
  }, [duree, onFin]);

  return (
    <div
      className={`animate-fade-in-up pointer-events-auto flex w-full max-w-sm items-center gap-3 rounded-2xl border bg-surface-haute px-3.5 py-3 shadow-2xl shadow-black/60 ${COULEURS[ton]}`}
    >
      <Icone size={16} className="shrink-0" />
      <p className="min-w-0 flex-1 text-sm text-fort">{toast.message}</p>
      {toast.onAnnuler && (
        <button
          onClick={async () => {
            await toast.onAnnuler?.();
            onFin();
          }}
          className="flex min-h-cible shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-sm font-semibold text-fort transition-colors hover:bg-white/10"
        >
          <FaRotateLeft size={11} />
          Annuler
        </button>
      )}
    </div>
  );
}
