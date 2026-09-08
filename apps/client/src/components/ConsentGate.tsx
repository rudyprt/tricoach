import { useState } from "react";
import { Link } from "react-router-dom";
import { api, apiErrorMessage } from "../lib/api";
import { useAuth } from "../lib/AuthContext";
import { Spinner } from "./Spinner";

/**
 * Les conditions ont évolué depuis la dernière acceptation : le service reste
 * accessible, mais l'athlète est invité à re-consentir. Un simple bandeau, pas
 * un mur : bloquer l'accès à ses propres données serait disproportionné.
 */
export function ConsentGate() {
  const { user, refresh } = useAuth();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!user?.needsConsent) return null;

  async function accept() {
    setSaving(true);
    setError(null);
    try {
      await api.post("/privacy/consent");
      await refresh();
    } catch (err) {
      setError(apiErrorMessage(err, "Impossible d'enregistrer votre accord."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mb-4 rounded-2xl border border-amber-900/50 bg-amber-950/20 p-3.5">
      <p className="text-sm text-amber-200">
        Nos{" "}
        <Link to="/conditions" className="underline underline-offset-2">
          conditions d'utilisation
        </Link>{" "}
        et notre{" "}
        <Link to="/confidentialite" className="underline underline-offset-2">
          politique de confidentialité
        </Link>{" "}
        ont évolué.
      </p>
      {error && <p className="mt-1.5 text-xs text-red-400">{error}</p>}
      <button
        onClick={accept}
        disabled={saving}
        className="mt-2.5 flex items-center gap-2 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-black transition-colors hover:bg-amber-400 disabled:opacity-50"
      >
        {saving && <Spinner className="border-black/30 border-t-black" />}
        J'accepte
      </button>
    </div>
  );
}
