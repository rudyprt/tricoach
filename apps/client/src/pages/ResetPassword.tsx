import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { FaLock } from "react-icons/fa6";
import { api, apiErrorMessage } from "../lib/api";
import { Spinner } from "../components/Spinner";

export function ResetPassword() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const mismatch = confirmation.length > 0 && password !== confirmation;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (mismatch) return;
    setError(null);
    setLoading(true);
    try {
      await api.post("/auth/reset-password", { token, password });
      navigate("/login?reinitialise=1", { replace: true });
    } catch (err) {
      setError(apiErrorMessage(err, "Impossible de réinitialiser le mot de passe."));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="animate-fade-in-up w-full max-w-sm space-y-4 rounded-2xl border border-zinc-800 bg-zinc-950/80 p-6 shadow-2xl shadow-black/50 backdrop-blur-sm">
        <h1 className="text-xl font-black italic tracking-wide text-white">
          Nouveau <span className="text-rose-500">mot de passe</span>
        </h1>

        {!token ? (
          <>
            <p className="text-sm text-zinc-400">
              Ce lien de réinitialisation est incomplet. Demandez-en un nouveau depuis la page de connexion.
            </p>
            <Link
              to="/mot-de-passe-oublie"
              className="block rounded-lg bg-rose-500 px-3 py-2.5 text-center text-sm font-semibold text-black transition-colors hover:bg-rose-400"
            >
              Demander un nouveau lien
            </Link>
          </>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <p className="rounded-md border border-red-900 bg-red-950/50 px-3 py-2 text-sm text-red-400">{error}</p>
            )}
            <div className="space-y-1">
              <label className="text-sm text-zinc-300">Nouveau mot de passe</label>
              <div className="relative">
                <FaLock className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" size={14} />
                <input
                  type="password"
                  required
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="8 caractères minimum"
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-900 py-2 pl-9 pr-3 text-sm text-white outline-none transition-colors focus:border-rose-500"
                />
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-sm text-zinc-300">Confirmation</label>
              <div className="relative">
                <FaLock className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" size={14} />
                <input
                  type="password"
                  required
                  value={confirmation}
                  onChange={(e) => setConfirmation(e.target.value)}
                  className={`w-full rounded-lg border bg-zinc-900 py-2 pl-9 pr-3 text-sm text-white outline-none transition-colors focus:border-rose-500 ${
                    mismatch ? "border-red-800" : "border-zinc-800"
                  }`}
                />
              </div>
              {mismatch && <p className="text-xs text-red-400">Les deux mots de passe ne correspondent pas.</p>}
            </div>
            <button
              type="submit"
              disabled={loading || mismatch || password.length < 8}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-rose-500 px-3 py-2.5 text-sm font-semibold text-black transition-all duration-150 hover:scale-[1.01] hover:bg-rose-400 active:scale-[0.99] disabled:opacity-50 disabled:hover:scale-100"
            >
              {loading && <Spinner className="border-black/30 border-t-black" />}
              {loading ? "Enregistrement..." : "Changer le mot de passe"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
