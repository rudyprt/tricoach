import { useEffect, useState } from "react";
import { FaHeartPulse } from "react-icons/fa6";
import { api, apiErrorMessage } from "../lib/api";
import { Spinner } from "./Spinner";

interface EtatSante {
  consenti: boolean;
  depuis: string | null;
}

/**
 * Consentement aux données de santé, depuis « Mon compte ».
 *
 * La politique de confidentialité promet que ce consentement se retire ici et
 * que les données déjà enregistrées sont alors effacées : blessures et
 * douleurs du profil, ressentis après séance et après course, motif médical
 * des interruptions. Le geste demande une confirmation, puisqu'il ne se
 * rattrape pas.
 */
export function DonneesSanteCard() {
  const [etat, setEtat] = useState<EtatSante | null>(null);
  const [confirmer, setConfirmer] = useState(false);
  const [enCours, setEnCours] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let actif = true;
    api
      .get<EtatSante>("/privacy/sante")
      .then(({ data }) => {
        if (actif) setEtat(data);
      })
      .catch(() => undefined);
    return () => {
      actif = false;
    };
  }, []);

  async function retirer() {
    setEnCours(true);
    setError(null);
    try {
      const { data } = await api.delete<EtatSante>("/privacy/sante");
      setEtat({ consenti: data.consenti, depuis: data.depuis });
      setConfirmer(false);
      setMessage("Consentement retiré : vos données de santé ont été effacées.");
    } catch (err) {
      setError(apiErrorMessage(err, "Impossible de retirer le consentement."));
    } finally {
      setEnCours(false);
    }
  }

  return (
    <div className="rounded-2xl border border-bordure bg-zinc-950/80 p-4">
      <div className="mb-2 flex items-center gap-2">
        <FaHeartPulse className="text-doux" size={13} />
        <h2 className="text-sm font-bold text-white">Données de santé</h2>
      </div>
      {!etat ? (
        <p className="text-sm text-tres-doux">Chargement...</p>
      ) : etat.consenti ? (
        <>
          <p className="mb-3 text-sm text-doux">
            Vous avez accepté le {new Date(etat.depuis!).toLocaleDateString("fr-FR")} que TriCoach enregistre vos
            blessures, douleurs et ressentis pour adapter vos programmes.
          </p>
          {!confirmer ? (
            <button
              onClick={() => {
                setMessage(null);
                setConfirmer(true);
              }}
              className="rounded-lg border border-bordure px-3 py-2 text-sm text-zinc-300 transition-colors hover:border-rose-700 hover:text-white"
            >
              Retirer mon consentement
            </button>
          ) : (
            <div className="space-y-2 rounded-xl border border-red-900/60 bg-red-950/20 p-3">
              <p className="text-sm text-zinc-200">
                Vos blessures, douleurs, ressentis après séance et après course, et le motif médical de vos
                interruptions seront effacés définitivement. Vos programmes et vos séances restent.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={retirer}
                  disabled={enCours}
                  className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-red-600 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-500 disabled:opacity-40"
                >
                  {enCours && <Spinner className="border-white/30 border-t-white" />}
                  Retirer et effacer
                </button>
                <button
                  onClick={() => setConfirmer(false)}
                  className="rounded-lg border border-bordure px-4 py-2 text-sm text-zinc-300 hover:border-bordure-forte"
                >
                  Annuler
                </button>
              </div>
            </div>
          )}
        </>
      ) : (
        <p className="text-sm text-doux">
          Vous n'avez pas donné votre consentement : aucune donnée de santé n'est enregistrée. Vous pouvez le donner
          sous le champ des blessures ou du ressenti d'une séance.
        </p>
      )}
      {message && (
        <p role="status" className="mt-2 text-sm text-emerald-400">
          {message}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm text-accent-clair">
          {error}
        </p>
      )}
    </div>
  );
}
