import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FaPlay, FaPause, FaForward, FaXmark } from "react-icons/fa6";
import type { Session, SessionBlock } from "../lib/api";
import { Bouton } from "../ui/Bouton";

const BLOCS: { cle: keyof NonNullable<Session["structure"]>; label: string; couleur: string }[] = [
  { cle: "echauffement", label: "Échauffement", couleur: "text-info" },
  { cle: "corps", label: "Corps de séance", couleur: "text-accent-clair" },
  { cle: "retourCalme", label: "Retour au calme", couleur: "text-succes" },
];

function chrono(secondes: number): string {
  const m = Math.floor(Math.abs(secondes) / 60);
  const s = Math.abs(secondes) % 60;
  return `${secondes < 0 ? "+" : ""}${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/**
 * Déroulé guidé d'une séance.
 *
 * Le jour J, l'athlète n'avait qu'un pavé de texte à relire entre deux
 * longueurs ou au feu rouge. Ce mode affiche un bloc à la fois, en très gros,
 * avec le temps restant — et maintient l'écran allumé, sans quoi le téléphone
 * s'éteint au bout de trente secondes et il faut le rallumer les mains
 * mouillées.
 */
export function SeanceGuidee({ session, onFermer }: { session: Session; onFermer: () => void }) {
  const blocs = BLOCS.filter(({ cle }) => session.structure?.[cle]).map(({ cle, label, couleur }) => ({
    label,
    couleur,
    bloc: session.structure![cle] as SessionBlock,
  }));

  const [index, setIndex] = useState(0);
  const [restant, setRestant] = useState((blocs[0]?.bloc.dureeMin ?? 0) * 60);
  const [enCours, setEnCours] = useState(false);
  const verrou = useRef<WakeLockSentinel | null>(null);

  const courant = blocs[index];

  useEffect(() => {
    if (!enCours) return;
    const minuterie = setInterval(() => setRestant((r) => r - 1), 1000);
    return () => clearInterval(minuterie);
  }, [enCours]);

  useEffect(() => {
    // Le verrou d'écran n'existe pas partout (Safari l'a depuis peu) : son
    // absence ne doit rien casser, elle rend juste la séance moins confortable.
    async function verrouiller() {
      try {
        verrou.current = (await navigator.wakeLock?.request("screen")) ?? null;
      } catch {
        verrou.current = null;
      }
    }
    if (enCours) void verrouiller();
    else void verrou.current?.release().catch(() => undefined);

    return () => {
      void verrou.current?.release().catch(() => undefined);
    };
  }, [enCours]);

  function passer() {
    if (index + 1 >= blocs.length) {
      onFermer();
      return;
    }
    setIndex(index + 1);
    setRestant(blocs[index + 1].bloc.dureeMin * 60);
  }

  if (!courant) return null;

  const total = courant.bloc.dureeMin * 60;
  const part = total > 0 ? Math.min(100, Math.max(0, ((total - restant) / total) * 100)) : 0;

  /*
   * Rendu dans un portail, et non à sa place dans l'arbre.
   *
   * Le conteneur de page porte `animate-fade-in-up`, donc une `transform` :
   * tout ancêtre transformé devient le bloc de référence des éléments
   * `position: fixed`, qui cessent alors de se caler sur la fenêtre. Le mode
   * séance s'affichait donc au milieu du programme, chronomètre hors écran.
   */
  return createPortal(
    <div
      /* Repère lu par la mise à jour automatique : recharger pendant une
         séance ferait perdre le chronomètre et le bloc en cours. */
      data-plein-ecran="seance"
      className="fixed inset-0 z-[70] flex flex-col bg-fond"
      style={{ paddingTop: "var(--marge-haute)", paddingBottom: "var(--marge-basse)" }}
    >
      <div className="flex items-center justify-between px-4 py-3">
        <p className="text-sm text-doux">
          Bloc {index + 1} sur {blocs.length}
        </p>
        <button
          onClick={onFermer}
          aria-label="Quitter le mode séance"
          className="flex h-cible w-cible items-center justify-center rounded-full text-doux hover:text-fort"
        >
          <FaXmark size={18} />
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 text-center">
        <p className={`mb-2 text-sm font-bold uppercase tracking-wide ${courant.couleur}`}>{courant.label}</p>

        <p
          // Le chronomètre est lu en mouvement, parfois de loin : il doit être
          // la chose la plus lisible de l'écran.
          className={`font-mono text-6xl font-bold tabular-nums ${restant < 0 ? "text-attention" : "text-fort"}`}
          aria-live="off"
        >
          {chrono(restant)}
        </p>

        <div
          role="progressbar"
          aria-valuenow={Math.round(part)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`Progression du bloc ${courant.label}`}
          className="mt-4 h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-surface-haute"
        >
          <div style={{ width: `${part}%` }} className="h-full rounded-full bg-accent transition-all duration-1000" />
        </div>

        {courant.bloc.cible && (
          <p className="mt-6 font-mono text-lg text-accent-clair">{courant.bloc.cible}</p>
        )}
        <p className="mt-2 max-w-sm text-base leading-relaxed text-doux">{courant.bloc.description}</p>

        {courant.bloc.exercices && courant.bloc.exercices.length > 0 && (
          <ul className="mt-4 w-full max-w-sm space-y-1.5 text-left">
            {courant.bloc.exercices.map((ex, i) => (
              <li key={i} className="rounded-lg bg-surface px-3 py-2 text-sm">
                <span className="font-mono font-semibold text-fort">{ex.repetitions}</span>
                <span className="text-doux"> à {ex.allure}</span>
                {ex.recuperation && <span className="text-tres-doux"> · récup {ex.recuperation}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex gap-2 px-4 py-4">
        <Bouton
          variante={enCours ? "secondaire" : "principal"}
          pleineLargeur
          icone={enCours ? <FaPause size={13} /> : <FaPlay size={13} />}
          onClick={() => setEnCours((v) => !v)}
        >
          {enCours ? "Pause" : restant === total ? "Démarrer" : "Reprendre"}
        </Bouton>
        <Bouton variante="secondaire" pleineLargeur icone={<FaForward size={13} />} onClick={passer}>
          {index + 1 >= blocs.length ? "Terminer" : "Bloc suivant"}
        </Bouton>
      </div>
    </div>,
    document.body
  );
}
