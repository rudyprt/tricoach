import { useCallback, useContext, useMemo, useState, createContext, type ReactNode } from "react";
import { Dialog } from "./Dialog";
import { Bouton, type VarianteBouton } from "./Bouton";

/**
 * Remplace `window.confirm` et `window.prompt`.
 *
 * Les boîtes natives ne sont pas stylables, s'affichent en anglais système sur
 * certains appareils, et sur iPhone en application installée elles surgissent
 * comme une alerte du système d'exploitation — l'athlète ne sait plus s'il
 * parle à TriCoach ou à son téléphone. Celle du réajustement de semaine
 * demandait en plus un texte libre dans un champ d'une ligne.
 */

interface DemandeConfirmation {
  titre: string;
  description?: string;
  /** Libellé du bouton d'action. « Annuler » est toujours l'autre. */
  confirmer?: string;
  variante?: VarianteBouton;
  /** Présent : la boîte propose une saisie et renvoie son contenu. */
  saisie?: {
    label: string;
    placeholder?: string;
    facultatif?: boolean;
    multiligne?: boolean;
    maxLength?: number;
  };
}

type Resultat = { confirme: boolean; texte: string };

interface ContexteConfirmation {
  demander: (demande: DemandeConfirmation) => Promise<Resultat>;
}

const Contexte = createContext<ContexteConfirmation | null>(null);

export function useConfirmation(): ContexteConfirmation {
  const contexte = useContext(Contexte);
  if (!contexte) throw new Error("useConfirmation doit être utilisé dans un ConfirmationProvider.");
  return contexte;
}

export function ConfirmationProvider({ children }: { children: ReactNode }) {
  const [demande, setDemande] = useState<DemandeConfirmation | null>(null);
  const [texte, setTexte] = useState("");
  const [resoudre, setResoudre] = useState<((r: Resultat) => void) | null>(null);

  const demander = useCallback((d: DemandeConfirmation) => {
    setDemande(d);
    setTexte("");
    return new Promise<Resultat>((resolve) => {
      // Enveloppé dans une fonction : `setState` exécuterait autrement la
      // fonction de résolution au lieu de la stocker.
      setResoudre(() => resolve);
    });
  }, []);

  const repondre = useCallback(
    (confirme: boolean) => {
      resoudre?.({ confirme, texte: texte.trim() });
      setDemande(null);
      setResoudre(null);
    },
    [resoudre, texte]
  );

  const valeur = useMemo(() => ({ demander }), [demander]);
  const saisieManquante = Boolean(demande?.saisie && !demande.saisie.facultatif && !texte.trim());

  return (
    <Contexte.Provider value={valeur}>
      {children}
      <Dialog
        ouvert={demande !== null}
        onClose={() => repondre(false)}
        titre={demande?.titre ?? ""}
        description={demande?.description}
        actions={
          <>
            <Bouton variante="secondaire" pleineLargeur onClick={() => repondre(false)}>
              Annuler
            </Bouton>
            <Bouton
              variante={demande?.variante ?? "principal"}
              pleineLargeur
              disabled={saisieManquante}
              onClick={() => repondre(true)}
            >
              {demande?.confirmer ?? "Confirmer"}
            </Bouton>
          </>
        }
      >
        {demande?.saisie ? (
          <label className="block">
            <span className="mb-1.5 block text-sm text-fort">{demande.saisie.label}</span>
            {demande.saisie.multiligne ? (
              <textarea
                autoFocus
                rows={4}
                maxLength={demande.saisie.maxLength ?? 500}
                placeholder={demande.saisie.placeholder}
                value={texte}
                onChange={(e) => setTexte(e.target.value)}
                className="w-full resize-none rounded-xl border border-bordure bg-fond px-3 py-2.5 text-sm text-fort placeholder:text-tres-doux focus:border-accent"
              />
            ) : (
              <input
                autoFocus
                maxLength={demande.saisie.maxLength ?? 200}
                placeholder={demande.saisie.placeholder}
                value={texte}
                onChange={(e) => setTexte(e.target.value)}
                className="w-full rounded-xl border border-bordure bg-fond px-3 py-2.5 text-sm text-fort placeholder:text-tres-doux focus:border-accent"
              />
            )}
            {demande.saisie.facultatif && (
              <span className="mt-1.5 block text-xs text-tres-doux">Facultatif — vous pouvez laisser vide.</span>
            )}
          </label>
        ) : null}
      </Dialog>
    </Contexte.Provider>
  );
}
