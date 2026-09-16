import { useEffect, useState } from "react";
import { FaCheck } from "react-icons/fa6";

/**
 * Attente de génération.
 *
 * Elle dure une à deux minutes et n'affichait qu'un mot : « Génération… ».
 * Sans repère, une minute paraît une panne. Les étapes ci-dessous décrivent ce
 * que le coach fait réellement, dans l'ordre où il le fait.
 */

const ETAPES = [
  { libelle: "Lecture de votre profil et de vos zones", secondes: 4 },
  { libelle: "Bilan de vos séances récentes", secondes: 10 },
  { libelle: "Choix de la phase et du volume de la semaine", secondes: 18 },
  { libelle: "Écriture des séances, jour par jour", secondes: 55 },
  { libelle: "Relecture et mise en forme", secondes: 90 },
];

export function GenerationEnCours({ titre = "Votre coach prépare la semaine" }: { titre?: string }) {
  const [secondes, setSecondes] = useState(0);

  useEffect(() => {
    const minuterie = setInterval(() => setSecondes((s) => s + 1), 1000);
    return () => clearInterval(minuterie);
  }, []);

  // La dernière étape reste « en cours » quoi qu'il arrive : annoncer la fin
  // avant qu'elle n'arrive serait pire que ne rien annoncer.
  const indexCourant = Math.min(
    ETAPES.length - 1,
    ETAPES.findIndex((e) => secondes < e.secondes) === -1 ? ETAPES.length - 1 : ETAPES.findIndex((e) => secondes < e.secondes)
  );

  return (
    <div
      role="status"
      aria-live="polite"
      className="rounded-2xl border border-bordure bg-surface p-5"
    >
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <p className="text-sm font-bold text-fort">{titre}</p>
        <span className="font-mono text-xs text-doux">
          {String(Math.floor(secondes / 60)).padStart(2, "0")}:{String(secondes % 60).padStart(2, "0")}
        </span>
      </div>

      <ol className="space-y-2.5">
        {ETAPES.map((etape, i) => {
          const faite = i < indexCourant;
          const courante = i === indexCourant;
          return (
            <li key={etape.libelle} className="flex items-center gap-2.5">
              <span
                aria-hidden="true"
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] ${
                  faite
                    ? "border-succes bg-succes text-black"
                    : courante
                      ? "border-accent text-accent"
                      : "border-bordure text-tres-doux"
                }`}
              >
                {faite ? <FaCheck size={9} /> : courante ? <span className="h-2 w-2 animate-pulse rounded-full bg-accent" /> : i + 1}
              </span>
              <span className={`text-sm ${faite ? "text-doux line-through" : courante ? "text-fort" : "text-tres-doux"}`}>
                {etape.libelle}
              </span>
            </li>
          );
        })}
      </ol>

      <p className="mt-4 text-xs leading-relaxed text-doux">
        {secondes < 100
          ? "Comptez une à deux minutes. Vous pouvez quitter cet écran : la génération continue et vous la retrouverez ici."
          : "C'est un peu plus long que d'habitude, mais la génération est toujours en cours. Elle aboutira même si vous fermez l'application."}
      </p>
    </div>
  );
}
