import { useEffect, useState } from "react";

/**
 * Signale une attente anormalement longue.
 *
 * L'hébergement gratuit met le serveur en veille après quinze minutes sans
 * visite : la première requête qui le réveille peut mettre près d'une minute.
 * Pendant ce temps l'interface ne montre qu'un cercle qui tourne, et des
 * testeurs ont cru à un blocage — certains ont relancé leur inscription alors
 * que la première était déjà partie. Dire ce qui se passe coûte une phrase et
 * évite ces doublons.
 */
const SEUIL_MS = 8000;

export function useAttenteLongue(enCours: boolean): boolean {
  const [longue, setLongue] = useState(false);

  useEffect(() => {
    if (!enCours) {
      setLongue(false);
      return;
    }
    const minuterie = setTimeout(() => setLongue(true), SEUIL_MS);
    return () => clearTimeout(minuterie);
  }, [enCours]);

  return longue;
}
