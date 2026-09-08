import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { FaEnvelope, FaLock, FaEye, FaEyeSlash } from "react-icons/fa6";
import { api, apiErrorMessage, browserTimeZone } from "../lib/api";
import { useAuth } from "../lib/AuthContext";
import { Spinner } from "../components/Spinner";

export function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { refresh } = useAuth();
  const navigate = useNavigate();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await api.post("/auth/login", { email, password, timezone: browserTimeZone() });
      await refresh();
      navigate("/dashboard");
    } catch (err) {
      setError(apiErrorMessage(err, "Impossible de se connecter."));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <form onSubmit={handleSubmit} className="animate-fade-in-up w-full max-w-sm space-y-4 rounded-2xl border border-zinc-800 bg-zinc-950/80 p-6 shadow-2xl shadow-black/50 backdrop-blur-sm">
        <h1 className="text-xl font-black italic tracking-wide text-white">
          TRI<span className="text-rose-500">COACH</span>
        </h1>
        {error && <p className="rounded-md border border-red-900 bg-red-950/50 px-3 py-2 text-sm text-red-400">{error}</p>}
        <div className="space-y-1">
          <label className="text-sm text-zinc-300">Email</label>
          <div className="relative">
            <FaEnvelope className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" size={14} />
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-zinc-800 bg-zinc-900 py-2 pl-9 pr-3 text-sm text-white outline-none transition-colors focus:border-rose-500"
            />
          </div>
        </div>
        <div className="space-y-1">
          <label className="text-sm text-zinc-300">Mot de passe</label>
          <div className="relative">
            <FaLock className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" size={14} />
            <input
              type={showPassword ? "text" : "password"}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-zinc-800 bg-zinc-900 py-2 pl-9 pr-9 text-sm text-white outline-none transition-colors focus:border-rose-500"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? "Masquer le mot de passe" : "Afficher le mot de passe"}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 transition-colors hover:text-zinc-300"
            >
              {showPassword ? <FaEyeSlash size={14} /> : <FaEye size={14} />}
            </button>
          </div>
        </div>
        <button
          type="submit"
          disabled={loading}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-rose-500 px-3 py-2.5 text-sm font-semibold text-black transition-all duration-150 hover:scale-[1.01] hover:bg-rose-400 active:scale-[0.99] disabled:opacity-50 disabled:hover:scale-100"
        >
          {loading && <Spinner className="border-black/30 border-t-black" />}
          {loading ? "Connexion..." : "Se connecter"}
        </button>
        <p className="text-center text-sm">
          <Link to="/mot-de-passe-oublie" className="text-zinc-500 underline-offset-4 hover:text-zinc-300 hover:underline">
            Mot de passe oublié ?
          </Link>
        </p>
        <p className="text-center text-sm text-zinc-500">
          Pas de compte ?{" "}
          <Link to="/register" className="text-rose-400 hover:underline">
            Créer un compte
          </Link>
        </p>
      </form>
    </div>
  );
}
