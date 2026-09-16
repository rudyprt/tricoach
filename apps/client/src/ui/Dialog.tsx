import { useCallback, useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { FaXmark } from "react-icons/fa6";

/**
 * Boîte de dialogue accessible.
 *
 * Les modales de l'application n'en étaient pas : de simples div, sans
 * `role="dialog"`, sans fermeture au clavier, sans piège à focus. Au lecteur
 * d'écran, le contenu de la page restait lisible derrière, et la tabulation
 * s'échappait dans l'arrière-plan.
 */

const FOCUSABLES =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface DialogProps {
  ouvert: boolean;
  onClose: () => void;
  titre: string;
  /** Description lue juste après le titre par les lecteurs d'écran. */
  description?: string;
  children: ReactNode;
  /** Pied de la boîte : les actions. */
  actions?: ReactNode;
  /** Empêche la fermeture par Échap ou par le fond — pour une action en cours. */
  bloquant?: boolean;
}

export function Dialog({ ouvert, onClose, titre, description, children, actions, bloquant }: DialogProps) {
  const panneau = useRef<HTMLDivElement>(null);
  const declencheur = useRef<Element | null>(null);
  const titreId = useId();
  const descriptionId = useId();

  const fermer = useCallback(() => {
    if (!bloquant) onClose();
  }, [bloquant, onClose]);

  useEffect(() => {
    if (!ouvert) return;

    // Mémorisé à l'ouverture pour être rendu à la fermeture : sans cela, le
    // focus repart au début de la page et l'on perd sa place.
    declencheur.current = document.activeElement;

    // La boîte elle-même, et non son premier bouton : un lecteur d'écran
    // annonce alors le titre et la description avant que l'on agisse. Le
    // premier bouton serait « Fermer », ce qui ne dit rien de ce qu'on ouvre.
    panneau.current?.focus();

    function surTouche(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        fermer();
        return;
      }
      if (e.key !== "Tab") return;

      // Piège à focus : la tabulation boucle dans la boîte au lieu d'aller
      // visiter l'arrière-plan, que l'utilisateur ne voit pas.
      const cibles = Array.from(panneau.current?.querySelectorAll<HTMLElement>(FOCUSABLES) ?? []);
      if (cibles.length === 0) return;
      const debut = cibles[0];
      const fin = cibles[cibles.length - 1];

      if (e.shiftKey && document.activeElement === debut) {
        e.preventDefault();
        fin.focus();
      } else if (!e.shiftKey && document.activeElement === fin) {
        e.preventDefault();
        debut.focus();
      }
    }

    document.addEventListener("keydown", surTouche);
    // Le fond ne doit pas défiler sous la boîte.
    const defilementInitial = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", surTouche);
      document.body.style.overflow = defilementInitial;
      (declencheur.current as HTMLElement | null)?.focus?.();
    };
  }, [ouvert, fermer]);

  if (!ouvert) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
      style={{ paddingTop: "var(--marge-haute)", paddingBottom: "var(--marge-basse)" }}
    >
      <div
        className="animate-fade-in absolute inset-0 bg-black/80 backdrop-blur-sm"
        onClick={fermer}
        // Le fond n'est pas une cible d'interaction pour un lecteur d'écran :
        // Échap fait déjà le travail.
        aria-hidden="true"
      />

      <div
        ref={panneau}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titreId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className="animate-fade-in-up relative flex max-h-[92dvh] w-full flex-col rounded-t-3xl border border-bordure bg-surface shadow-2xl sm:max-w-md sm:rounded-3xl"
      >
        <div className="flex items-start gap-3 border-b border-bordure px-4 py-3.5">
          <div className="min-w-0 flex-1">
            <h2 id={titreId} className="text-base font-bold text-fort">
              {titre}
            </h2>
            {description && (
              <p id={descriptionId} className="mt-0.5 text-sm text-doux">
                {description}
              </p>
            )}
          </div>
          {!bloquant && (
            <button
              onClick={onClose}
              aria-label="Fermer"
              className="-mr-1 -mt-1 flex h-cible w-cible shrink-0 items-center justify-center rounded-full text-doux transition-colors hover:bg-surface-haute hover:text-fort"
            >
              <FaXmark size={16} />
            </button>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">{children}</div>

        {actions && <div className="flex gap-2 border-t border-bordure px-4 py-3">{actions}</div>}
      </div>
    </div>,
    document.body
  );
}
