import type { ButtonHTMLAttributes, ReactNode } from "react";

/**
 * Bouton unique de l'application.
 *
 * Les styles étaient recopiés à la main dans chaque composant, avec des tailles
 * de cible tactile variables — certaines sous les 44 px recommandés, difficiles
 * à viser en courant ou avec les mains froides.
 */

export type VarianteBouton = "principal" | "secondaire" | "discret" | "danger" | "succes";

const VARIANTES: Record<VarianteBouton, string> = {
  principal: "bg-accent text-white hover:bg-accent-clair hover:text-accent-sombre",
  secondaire: "border border-bordure text-fort hover:border-bordure-forte hover:bg-surface-haute",
  discret: "text-doux hover:bg-surface-haute hover:text-fort",
  danger: "bg-danger text-black hover:brightness-110",
  succes: "bg-succes text-black hover:brightness-110",
};

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variante?: VarianteBouton;
  /** Occupe toute la largeur disponible. */
  pleineLargeur?: boolean;
  /** Affiché à gauche du libellé. */
  icone?: ReactNode;
  /** Remplace le contenu par un indicateur, et désactive le bouton. */
  enCours?: boolean;
}

export function Bouton({
  variante = "secondaire",
  pleineLargeur,
  icone,
  enCours,
  children,
  className = "",
  disabled,
  ...reste
}: Props) {
  return (
    <button
      {...reste}
      disabled={disabled || enCours}
      // aria-busy plutôt qu'un simple changement de libellé : un lecteur
      // d'écran annonce alors que l'action est en cours.
      aria-busy={enCours || undefined}
      className={`inline-flex min-h-cible items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold transition-all duration-150 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 ${
        VARIANTES[variante]
      } ${pleineLargeur ? "w-full" : ""} ${className}`}
    >
      {enCours ? (
        <>
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
          <span>Un instant…</span>
        </>
      ) : (
        <>
          {icone}
          {children}
        </>
      )}
    </button>
  );
}
