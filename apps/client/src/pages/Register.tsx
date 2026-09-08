import { useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { FaUser, FaEnvelope, FaLock, FaEye, FaEyeSlash, FaCheck } from "react-icons/fa6";
import { api, apiErrorMessage, browserTimeZone } from "../lib/api";
import { useAuth } from "../lib/AuthContext";
import { Spinner } from "../components/Spinner";
import { AthletesBackdrop } from "../components/AthletesBackdrop";

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function Register() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [touched, setTouched] = useState<{ email?: boolean; password?: boolean }>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { refresh } = useAuth();
  const navigate = useNavigate();

  const emailValid = email.length === 0 || isValidEmail(email);
  const passwordScore = useMemo(() => {
    let score = 0;
    if (password.length >= 8) score++;
    if (password.length >= 12) score++;
    if (/[0-9]/.test(password) && /[a-zA-Z]/.test(password)) score++;
    return score;
  }, [password]);
  const canSubmit = name.trim().length > 0 && isValidEmail(email) && password.length >= 8;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setTouched({ email: true, password: true });
    if (!canSubmit) return;
    setError(null);
    setLoading(true);
    try {
      await api.post("/auth/register", { name, email, password, timezone: browserTimeZone() });
      await refresh();
      navigate("/plans-intro");
    } catch (err) {
      setError(apiErrorMessage(err, "Impossible de créer le compte."));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative h-[100dvh] overflow-hidden px-4">
      <AthletesBackdrop />

      <div className="mx-auto flex h-full max-w-sm flex-col items-center justify-between py-[1.5vh] sm:py-[2vh]">
        <h1 className="pt-1 text-2xl font-black italic tracking-widest sm:text-3xl">
          <span className="text-red-500">SWIM</span>
          <span className="mx-1.5 text-zinc-600">/</span>
          <span className="text-white">BIKE</span>
          <span className="mx-1.5 text-zinc-600">/</span>
          <span className="text-blue-500">RUN</span>
        </h1>

        <div className="w-full">
          <div className="mb-2.5 flex flex-col items-center text-center">
            <span
              className="mb-1.5 flex h-9 w-9 items-center justify-center rounded-full bg-rose-600/15 text-base font-black italic text-rose-500"
              style={{ filter: "drop-shadow(0 0 14px rgba(244,63,94,0.45))" }}
            >
              T
            </span>
            <h2 className="text-base font-black italic tracking-wide text-white">
              TRI<span className="text-rose-500">COACH</span>
            </h2>
            <p className="mt-0.5 text-xs text-zinc-500">
              Créez votre compte pour recevoir un programme personnalisé par IA.
            </p>
          </div>

          <form
            onSubmit={handleSubmit}
            className="animate-fade-in-up space-y-2.5 rounded-2xl border border-zinc-800 bg-zinc-950/80 p-4 shadow-2xl shadow-black/50 backdrop-blur-sm sm:p-5"
          >
            {error && (
              <p className="rounded-md border border-red-900 bg-red-950/50 px-3 py-1.5 text-xs text-red-400">{error}</p>
            )}

            <div className="space-y-1">
              <label className="text-xs text-zinc-300">Nom d'utilisateur</label>
              <div className="relative">
                <FaUser className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" size={13} />
                <input
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Choisissez un nom d'utilisateur"
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-900 py-1.5 pl-9 pr-3 text-sm text-white outline-none transition-colors focus:border-rose-500"
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-xs text-zinc-300">Email</label>
              <div className="relative">
                <FaEnvelope className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" size={13} />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onBlur={() => setTouched((t) => ({ ...t, email: true }))}
                  placeholder="vous@exemple.com"
                  className={`w-full rounded-lg border bg-zinc-900 py-1.5 pl-9 pr-3 text-sm text-white outline-none transition-colors focus:border-rose-500 ${
                    touched.email && !emailValid ? "border-red-800" : "border-zinc-800"
                  }`}
                />
              </div>
              {touched.email && !emailValid && <p className="text-xs text-red-400">Adresse email invalide.</p>}
            </div>

            <div className="space-y-1">
              <label className="text-xs text-zinc-300">Mot de passe</label>
              <div className="relative">
                <FaLock className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" size={13} />
                <input
                  type={showPassword ? "text" : "password"}
                  required
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onBlur={() => setTouched((t) => ({ ...t, password: true }))}
                  placeholder="8 caractères minimum"
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-900 py-1.5 pl-9 pr-9 text-sm text-white outline-none transition-colors focus:border-rose-500"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? "Masquer le mot de passe" : "Afficher le mot de passe"}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 transition-colors hover:text-zinc-300"
                >
                  {showPassword ? <FaEyeSlash size={13} /> : <FaEye size={13} />}
                </button>
              </div>

              {password.length > 0 && (
                <div className="flex items-center gap-2 pt-0.5">
                  <div className="flex h-1 flex-1 gap-1 overflow-hidden rounded-full">
                    {[0, 1, 2].map((i) => (
                      <span
                        key={i}
                        className={`h-full flex-1 rounded-full transition-colors ${
                          i < passwordScore
                            ? passwordScore === 1
                              ? "bg-red-500"
                              : passwordScore === 2
                                ? "bg-amber-500"
                                : "bg-emerald-500"
                            : "bg-zinc-800"
                        }`}
                      />
                    ))}
                  </div>
                  {password.length >= 8 ? (
                    <FaCheck size={11} className="shrink-0 text-emerald-500" />
                  ) : (
                    <span className="shrink-0 text-xs text-zinc-500">{password.length}/8</span>
                  )}
                </div>
              )}
            </div>

            <button
              type="submit"
              disabled={loading}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-rose-500 px-3 py-2 text-sm font-semibold text-black transition-all duration-150 hover:scale-[1.01] hover:bg-rose-400 active:scale-[0.99] disabled:opacity-50 disabled:hover:scale-100"
            >
              {loading && <Spinner className="border-black/30 border-t-black" />}
              {loading ? "Création..." : "Créer mon compte"}
            </button>

            <p className="text-center text-xs text-zinc-500">
              Déjà un compte ?{" "}
              <Link to="/login" className="text-rose-400 hover:underline">
                Se connecter
              </Link>
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}
