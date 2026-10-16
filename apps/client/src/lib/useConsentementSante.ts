import { useEffect, useState } from "react";
import { api } from "./api";

/**
 * Le consentement aux données de santé est-il donné ? null tant que la
 * réponse n'est pas arrivée (ou en cas d'échec) : le serveur tranche alors.
 *
 * Sert aux formulaires qui recueillent une donnée de santé (ressenti, motif
 * d'une pause) : sans consentement, ils affichent la case sous le champ.
 */
export function useConsentementSante(actif = true) {
  const [consenti, setConsenti] = useState<boolean | null>(null);
  useEffect(() => {
    if (!actif) return;
    let vivant = true;
    api
      .get<{ consenti: boolean }>("/privacy/sante")
      .then(({ data }) => {
        if (vivant && typeof data?.consenti === "boolean") setConsenti(data.consenti);
      })
      .catch(() => undefined);
    return () => {
      vivant = false;
    };
  }, [actif]);
  return consenti;
}
