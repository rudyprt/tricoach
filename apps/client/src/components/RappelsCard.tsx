import { useEffect, useState } from "react";
import { FaBell } from "react-icons/fa6";
import { api, apiErrorMessage } from "../lib/api";
import { useAuth } from "../lib/AuthContext";
import { activerPush, desactiverPush, etatPush, type EtatPush } from "../lib/push";

/**
 * Réglage des rappels. Un athlète qui ne revient pas ne s'entraîne pas : ces
 * messages sont ce qui ramène, mais ils doivent rester coupables d'un geste,
 * sans quoi ils deviennent du courrier indésirable.
 */
export function RappelsCard() {
  const { user, refresh } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [push, setPush] = useState<EtatPush | null>(null);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushMessage, setPushMessage] = useState<string | null>(null);

  useEffect(() => {
    void etatPush().then(setPush);
  }, []);

  async function basculerPush() {
    setPushBusy(true);
    setPushMessage(null);
    try {
      if (push === "actif") {
        await desactiverPush();
        setPush("inactif");
      } else {
        const obtenu = await activerPush();
        setPush(obtenu);
        if (obtenu === "refuse") {
          setPushMessage(
            "Votre navigateur a refusé les notifications. Réautorisez-les dans ses réglages pour ce site."
          );
        }
      }
    } catch {
      setPushMessage("Activation impossible sur cet appareil.");
    } finally {
      setPushBusy(false);
    }
  }

  async function testerPush() {
    setPushBusy(true);
    setPushMessage(null);
    try {
      await api.post("/push/test");
      setPushMessage("Notification envoyée. Elle devrait apparaître dans quelques secondes.");
    } catch (err) {
      setPushMessage(apiErrorMessage(err, "Envoi impossible."));
    } finally {
      setPushBusy(false);
    }
  }

  if (!user) return null;
  const actif = user.rappelsEmail;

  async function basculer() {
    setBusy(true);
    setError(null);
    try {
      await api.patch("/privacy/rappels", { rappelsEmail: !actif });
      await refresh();
    } catch (err) {
      setError(apiErrorMessage(err, "Enregistrement impossible."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl border border-bordure bg-zinc-950/80 p-4">
      <div className="mb-2 flex items-center gap-2">
        <FaBell className="text-doux" size={13} />
        <h2 className="text-sm font-bold text-white">Rappels par e-mail</h2>
      </div>
      <p className="mb-3 text-sm text-doux">
        Le dimanche soir quand votre semaine est à générer, et lorsque des séances passées attendent encore votre
        réponse. Jamais plus d'un message par soir.
      </p>

      {error && <p className="mb-2 text-sm text-red-400">{error}</p>}

      <button
        onClick={() => void basculer()}
        disabled={busy}
        aria-pressed={actif}
        className={`flex w-full items-center justify-between rounded-lg border px-3 py-2.5 text-sm transition-colors disabled:opacity-50 ${
          actif
            ? "border-rose-900/50 bg-rose-950/20 text-rose-200 hover:border-rose-700"
            : "border-bordure text-doux hover:border-bordure-forte hover:text-zinc-200"
        }`}
      >
        <span>{actif ? "Rappels activés" : "Rappels désactivés"}</span>
        <span
          className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${actif ? "bg-rose-600" : "bg-zinc-700"}`}
        >
          <span
            className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${actif ? "left-[1.125rem]" : "left-0.5"}`}
          />
        </span>
      </button>

      {push && push !== "indisponible" && (
        <div className="mt-3 border-t border-bordure pt-3">
          <p className="mb-1 text-sm font-semibold text-zinc-200">Notifications sur cet appareil</p>
          <p className="mb-2 text-xs text-doux">
            Elles arrivent sur votre écran tout de suite, sans passer par votre boîte mail.
          </p>

          {push === "installation_requise" ? (
            <p className="rounded-lg border border-bordure bg-zinc-900/40 px-3 py-2 text-xs text-doux">
              Sur iPhone, ajoutez d'abord TriCoach à votre écran d'accueil : les notifications ne sont possibles
              qu'une fois l'application installée.
            </p>
          ) : (
            <div className="flex gap-2">
              <button
                onClick={() => void basculerPush()}
                disabled={pushBusy || push === "refuse"}
                className={`flex-1 rounded-lg border px-3 py-2 text-sm transition-colors disabled:opacity-50 ${
                  push === "actif"
                    ? "border-rose-900/50 bg-rose-950/20 text-rose-200 hover:border-rose-700"
                    : "border-bordure text-doux hover:border-bordure-forte hover:text-zinc-200"
                }`}
              >
                {push === "actif" ? "Notifications activées" : "Activer les notifications"}
              </button>
              {push === "actif" && (
                <button
                  onClick={() => void testerPush()}
                  disabled={pushBusy}
                  className="rounded-lg border border-bordure px-3 py-2 text-sm text-doux transition-colors hover:border-bordure-forte hover:text-zinc-200 disabled:opacity-50"
                >
                  Tester
                </button>
              )}
            </div>
          )}

          {pushMessage && <p className="mt-2 text-xs text-doux">{pushMessage}</p>}
        </div>
      )}
    </div>
  );
}
