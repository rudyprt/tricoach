import { useId, useState, type ReactNode } from "react";
import { FaCircleQuestion } from "react-icons/fa6";

/**
 * Définitions du vocabulaire d'entraînement.
 *
 * L'application parlait de CSS, de FTP, d'affûtage et de fraîcheur sans jamais
 * les expliquer. Un débutant — c'est-à-dire la moitié des gens qui préparent un
 * premier triathlon — ne pouvait pas comprendre ses propres zones.
 */
export const DEFINITIONS: Record<string, { terme: string; definition: string }> = {
  ftp: {
    terme: "FTP",
    definition:
      "La puissance en watts que vous pourriez tenir une heure à vélo, à fond. C'est la référence à partir de laquelle toutes vos zones vélo sont calculées.",
  },
  css: {
    terme: "CSS",
    definition:
      "Votre vitesse critique en natation, exprimée en temps aux 100 m. C'est l'allure que vous pouvez tenir longtemps sans vous écrouler.",
  },
  seuil: {
    terme: "Seuil",
    definition:
      "L'intensité au-delà de laquelle l'effort devient rapidement insoutenable. Environ l'allure d'une course d'une heure.",
  },
  zones: {
    terme: "Zones Z1 à Z5",
    definition:
      "Cinq niveaux d'intensité. Z1-Z2 : endurance, vous pouvez parler. Z3 : tempo, phrases courtes. Z4 : seuil, quelques mots. Z5 : maximal, aucun mot.",
  },
  affutage: {
    terme: "Affûtage",
    definition:
      "Les deux à trois semaines avant une course : le volume baisse nettement, l'intensité reste. On ne construit plus de forme, on arrive frais.",
  },
  fraicheur: {
    terme: "Fraîcheur",
    definition:
      "L'écart entre votre condition acquise et votre fatigue récente. Elle doit être haute le jour d'une course, et peut être basse pendant un bloc d'entraînement.",
  },
  charge: {
    terme: "Charge",
    definition:
      "Le coût d'une séance, qui tient compte de sa durée et de son intensité. Une heure à fond pèse bien plus qu'une heure tranquille.",
  },
  vma: {
    terme: "VMA / PMA",
    definition:
      "La vitesse (ou puissance) maximale à laquelle vous consommez le plus d'oxygène. On la travaille par intervalles courts et très intenses.",
  },
};

export type TermeGlossaire = keyof typeof DEFINITIONS;

/**
 * Terme accompagné de sa définition, dépliable au clic.
 *
 * Une infobulle au survol serait invisible sur téléphone, où l'application est
 * majoritairement utilisée : c'est donc un bouton, et la définition s'affiche
 * en dessous.
 */
export function Terme({ cle, children }: { cle: TermeGlossaire; children?: ReactNode }) {
  const [ouvert, setOuvert] = useState(false);
  const id = useId();
  const entree = DEFINITIONS[cle];
  if (!entree) return <>{children}</>;

  return (
    <span className="inline">
      <button
        type="button"
        onClick={() => setOuvert((v) => !v)}
        aria-expanded={ouvert}
        aria-controls={id}
        className="inline-flex items-baseline gap-1 rounded text-inherit underline decoration-dotted decoration-from-font underline-offset-2 hover:text-fort"
      >
        {children ?? entree.terme}
        <FaCircleQuestion size={10} aria-hidden="true" className="translate-y-px opacity-60" />
        <span className="sr-only">, afficher la définition</span>
      </button>
      {ouvert && (
        <span
          id={id}
          className="animate-fade-in mt-1.5 block rounded-lg border border-bordure bg-surface-haute px-3 py-2 text-xs leading-relaxed text-doux"
        >
          <strong className="text-fort">{entree.terme}</strong> — {entree.definition}
        </span>
      )}
    </span>
  );
}
