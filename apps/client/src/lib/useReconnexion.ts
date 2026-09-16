import { useEffect } from "react";

/**
 * Exécute une action au retour du réseau.
 *
 * Le bandeau « hors ligne » disparaissait tout seul, mais les données à
 * l'écran restaient celles du cache : l'athlète croyait voir sa semaine à jour
 * alors qu'il lisait une copie.
 */
export function useReconnexion(recharger: () => void): void {
  useEffect(() => {
    const surRetour = () => recharger();
    window.addEventListener("tricoach:reconnecte", surRetour);
    return () => window.removeEventListener("tricoach:reconnecte", surRetour);
  }, [recharger]);
}
