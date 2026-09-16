import { useState } from "react";
import { FaEllipsis, FaBandage, FaShareNodes, FaCalendarPlus, FaWandMagicSparkles } from "react-icons/fa6";
import { PauseCard } from "./PauseCard";
import { PartagerSemaine } from "./PartagerSemaine";

/**
 * Actions secondaires de la semaine, repliées.
 *
 * Mettre en pause, partager, imprimer, réajuster, exporter vers l'agenda : cinq
 * blocs qui repoussaient le programme lui-même hors de l'écran. Or l'athlète
 * ouvre cette page pour savoir ce qu'il fait aujourd'hui, pas pour partager sa
 * semaine. Ces actions restent à un appui, sous le contenu.
 */
export function ActionsSemaine({
  aUnProgramme,
  onPauseChange,
  onReajuster,
}: {
  aUnProgramme: boolean;
  onPauseChange: () => void;
  onReajuster: () => void;
}) {
  const [ouvert, setOuvert] = useState(false);

  return (
    <div className="print:hidden">
      <button
        onClick={() => setOuvert((v) => !v)}
        aria-expanded={ouvert}
        className="flex min-h-cible w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-bordure text-sm text-doux transition-colors hover:border-bordure-forte hover:text-fort"
      >
        <FaEllipsis size={14} aria-hidden="true" />
        {ouvert ? "Masquer les actions" : "Autres actions"}
      </button>

      {ouvert && (
        <div className="animate-fade-in mt-3 space-y-3">
          {aUnProgramme && (
            <button
              onClick={onReajuster}
              className="flex min-h-cible w-full items-center gap-2.5 rounded-2xl border border-bordure bg-surface px-3.5 text-left text-sm text-fort transition-colors hover:border-bordure-forte"
            >
              <FaWandMagicSparkles className="shrink-0 text-accent" size={14} aria-hidden="true" />
              <span>
                Réajuster ma semaine
                <span className="block text-xs text-doux">Si vous n'avez pas pu vous entraîner comme prévu</span>
              </span>
            </button>
          )}

          {aUnProgramme && (
            <a
              href="/api/calendar/sessions.ics"
              className="flex min-h-cible w-full items-center gap-2.5 rounded-2xl border border-bordure bg-surface px-3.5 text-sm text-fort transition-colors hover:border-bordure-forte"
            >
              <FaCalendarPlus className="shrink-0 text-info" size={14} aria-hidden="true" />
              Ajouter mes séances à mon agenda
            </a>
          )}

          {aUnProgramme && (
            <div>
              <p className="mb-1.5 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-doux">
                <FaShareNodes size={10} aria-hidden="true" />
                Partager ou imprimer
              </p>
              <PartagerSemaine />
            </div>
          )}

          <div>
            <p className="mb-1.5 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-doux">
              <FaBandage size={10} aria-hidden="true" />
              Interruption d'entraînement
            </p>
            <PauseCard onChange={onPauseChange} />
          </div>
        </div>
      )}
    </div>
  );
}
