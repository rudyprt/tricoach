import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { FaEnvelope } from "react-icons/fa6";
import { api, apiErrorMessage } from "../lib/api";
import { Spinner } from "../components/Spinner";

export function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await api.post("/auth/forgot-password", { email });
      setSent(true);
    } catch (err) {
      setError(apiErrorMessage(err, "Impossible d'envoyer le lien de réinitialisation."));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="animate-fade-in-up w-full max-w-sm space-y-4 rounded-2xl border border-bordure bg-zinc-950/80 p-6 shadow-2xl shadow-black/50 backdrop-blur-sm">
        <h1 className="text-xl font-black italic tracking-wide text-white">
          Mot de passe <span className="text-rose-500">oublié</span>
        </h1>

        {sent ? (
          <>
            <p className="text-sm text-doux">
              Si un compte existe pour cette adresse, un e-mail contenant un lien de réinitialisation vient d'être
              envoyé. Le lien est valable une heure.
            </p>
            <Link
              to="/login"
              className="block rounded-lg bg-rose-500 px-3 py-2.5 text-center text-sm font-semibold text-black transition-colors hover:bg-rose-400"
            >
              Retour à la connexion
            </Link>
          </>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <p className="text-sm text-doux">
              Indiquez l'adresse de votre compte : nous vous enverrons un lien pour choisir un nouveau mot de passe.
            </p>
            {error && (
              <p className="rounded-md border border-red-900 bg-red-950/50 px-3 py-2 text-sm text-red-400">{error}</p>
            )}
            <div className="space-y-1">
              <label className="text-sm text-zinc-300">Email</label>
              <div className="relative">
                <FaEnvelope
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-doux"
                  size={14}
                />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-lg border border-bordure bg-zinc-900 py-2 pl-9 pr-3 text-sm text-white outline-none transition-colors focus:border-rose-500"
                />
              </div>
            </div>
            <button
              type="submit"
              disabled={loading}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-rose-500 px-3 py-2.5 text-sm font-semibold text-black transition-all duration-150 hover:scale-[1.01] hover:bg-rose-400 active:scale-[0.99] disabled:opacity-50 disabled:hover:scale-100"
            >
              {loading && <Spinner className="border-black/30 border-t-black" />}
              {loading ? "Envoi..." : "Envoyer le lien"}
            </button>
            <p className="text-center text-sm text-doux">
              <Link to="/login" className="text-rose-400 hover:underline">
                Retour à la connexion
              </Link>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
