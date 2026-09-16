import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { FaCheck, FaBolt, FaCrown, FaClock } from "react-icons/fa6";
import { api, apiErrorMessage, isBillingUnavailableError, type Plan } from "../lib/api";
import { useAuth } from "../lib/AuthContext";
import { Spinner } from "../components/Spinner";

const STANDARD_FEATURES = [
  "Ajustement hebdomadaire automatique du programme",
  "Suivi de progression : forme, volume, performance",
  "Historique illimité de vos séances",
];

const PREMIUM_FEATURES = [
  "Tout ce qui est inclus dans Standard",
  "Répartition de votre temps par zone d'intensité",
  "Détection de surentraînement",
  "Réponses illimitées au chat coach IA",
];

// Annoncées comme à venir, et non comme incluses : la connexion aux montres
// n'est pas encore implémentée.
const PREMIUM_SOON = ["Connexion directe Strava / Garmin"];

function daysRemaining(dateStr: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(dateStr);
  target.setHours(0, 0, 0, 0);
  return Math.max(0, Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)));
}

export function Plans() {
  const { user, refresh } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const isIntro = location.pathname === "/plans-intro";
  const [loadingPlan, setLoadingPlan] = useState<Plan | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function choosePlan(plan: Plan) {
    setError(null);
    setLoadingPlan(plan);
    try {
      await api.patch("/auth/plan", { plan });
      await refresh();
      navigate(isIntro ? "/onboarding" : "/dashboard");
    } catch (err) {
      // Tant qu'aucun paiement n'est branché, le serveur refuse d'activer une
      // offre payante : on l'explique au lieu d'afficher une erreur technique.
      setError(
        isBillingUnavailableError(err)
          ? apiErrorMessage(err, "Le paiement en ligne n'est pas encore disponible.")
          : apiErrorMessage(err, "Impossible de mettre à jour votre offre.")
      );
    } finally {
      setLoadingPlan(null);
    }
  }

  async function cancelSubscription() {
    setError(null);
    setLoadingPlan("free");
    try {
      await api.patch("/auth/plan", { plan: "free" });
      await refresh();
    } catch (err) {
      setError(apiErrorMessage(err, "Impossible de résilier votre offre."));
    } finally {
      setLoadingPlan(null);
    }
  }

  function continueWithFree() {
    navigate(isIntro ? "/onboarding" : "/dashboard");
  }

  const remaining = user ? daysRemaining(user.trialEndsAt) : 0;

  return (
    <div className="relative min-h-screen px-4 py-8">
      <div className="mx-auto max-w-md">
        <div className="mb-6 text-center">
          {isIntro ? (
            <>
              <p className="text-sm font-semibold uppercase tracking-widest text-rose-500">
                🎉 Votre essai gratuit a commencé
              </p>
              <h1 className="mt-2 text-2xl font-black italic tracking-wide text-white">
                {user?.trialDays ?? 14} jours gratuits, <span className="text-rose-500">sans engagement</span>
              </h1>
              <p className="mt-2 text-sm text-doux">
                De quoi vivre un cycle complet : générez votre première semaine, réalisez vos séances, puis
                enchaînez sur la suivante — c'est là que le coach ajuste votre charge. Voici ce qui vous attend
                ensuite.
              </p>
            </>
          ) : (
            <>
              <h1 className="text-2xl font-black italic tracking-wide text-white">Mon abonnement</h1>
              <p className="mt-2 text-sm text-doux">
                {user?.plan !== "free" ? (
                  <>Offre actuelle : <span className="text-rose-400">{user?.plan === "premium" ? "Premium" : "Standard"}</span></>
                ) : user?.isTrialActive ? (
                  <>Essai gratuit en cours — encore {remaining} jour{remaining > 1 ? "s" : ""}.</>
                ) : (
                  <>Votre essai gratuit est terminé. Choisissez une offre pour continuer.</>
                )}
              </p>
            </>
          )}
        </div>

        {error && (
          <p className="mb-4 rounded-md border border-red-900 bg-red-950/50 px-3 py-2 text-sm text-red-400">{error}</p>
        )}

        {user && !user.selfServeBilling && (
          <p className="mb-4 rounded-md border border-amber-900/60 bg-amber-950/30 px-3 py-2 text-sm text-amber-300">
            Le paiement en ligne arrive bientôt. Ces offres sont présentées à titre indicatif : contactez-nous pour
            activer un abonnement.
          </p>
        )}

        <div className="space-y-4">
          <div className="rounded-2xl border border-bordure bg-zinc-950/80 p-5 shadow-2xl shadow-black/50 backdrop-blur-sm">
            <div className="mb-1 flex items-center gap-2">
              <FaBolt className="text-rose-500" size={16} />
              <h2 className="text-lg font-bold text-white">Standard</h2>
            </div>
            <p className="mb-4">
              <span className="text-3xl font-black text-white">19,99&nbsp;€</span>
              <span className="text-sm text-doux"> / mois</span>
            </p>
            <ul className="mb-5 space-y-2">
              {STANDARD_FEATURES.map((f) => (
                <li key={f} className="flex items-start gap-2 text-sm text-zinc-300">
                  <FaCheck size={12} className="mt-1 shrink-0 text-emerald-500" />
                  {f}
                </li>
              ))}
            </ul>
            <button
              onClick={() => choosePlan("standard")}
              disabled={loadingPlan !== null || user?.plan === "standard"}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-rose-500 px-3 py-2.5 text-sm font-semibold text-black transition-all duration-150 hover:scale-[1.01] hover:bg-rose-400 active:scale-[0.99] disabled:opacity-50 disabled:hover:scale-100"
            >
              {loadingPlan === "standard" && <Spinner className="border-black/30 border-t-black" />}
              {user?.plan === "standard" ? "Offre actuelle" : "Choisir Standard"}
            </button>
          </div>

          <div className="relative rounded-2xl border border-rose-800/60 bg-gradient-to-b from-rose-950/40 to-zinc-950/80 p-5 shadow-2xl shadow-black/50 backdrop-blur-sm">
            <span className="absolute -top-2.5 right-5 rounded-full bg-rose-600 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
              Recommandé
            </span>
            <div className="mb-1 flex items-center gap-2">
              <FaCrown className="text-rose-500" size={16} />
              <h2 className="text-lg font-bold text-white">Premium</h2>
            </div>
            <p className="mb-4">
              <span className="text-3xl font-black text-white">34,90&nbsp;€</span>
              <span className="text-sm text-doux"> / mois</span>
            </p>
            <ul className="mb-5 space-y-2">
              {PREMIUM_FEATURES.map((f) => (
                <li key={f} className="flex items-start gap-2 text-sm text-zinc-300">
                  <FaCheck size={12} className="mt-1 shrink-0 text-emerald-500" />
                  {f}
                </li>
              ))}
              {PREMIUM_SOON.map((f) => (
                <li key={f} className="flex items-start gap-2 text-sm text-doux">
                  <FaClock size={12} className="mt-1 shrink-0 text-tres-doux" />
                  {f} <span className="text-xs text-tres-doux">(bientôt)</span>
                </li>
              ))}
            </ul>
            <button
              onClick={() => choosePlan("premium")}
              disabled={loadingPlan !== null || user?.plan === "premium"}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-rose-500 px-3 py-2.5 text-sm font-semibold text-black transition-all duration-150 hover:scale-[1.01] hover:bg-rose-400 active:scale-[0.99] disabled:opacity-50 disabled:hover:scale-100"
            >
              {loadingPlan === "premium" && <Spinner className="border-black/30 border-t-black" />}
              {user?.plan === "premium" ? "Offre actuelle" : "Choisir Premium"}
            </button>
          </div>
        </div>

        <div className="mt-5 space-y-2 text-center">
          <button onClick={continueWithFree} className="text-sm text-doux underline-offset-4 hover:text-zinc-300 hover:underline">
            {isIntro ? "Continuer avec la semaine gratuite" : "Retour"}
          </button>
          {!isIntro && user && user.plan !== "free" && (
            <div>
              <button
                onClick={cancelSubscription}
                disabled={loadingPlan !== null}
                className="text-sm text-tres-doux underline-offset-4 hover:text-doux hover:underline disabled:opacity-50"
              >
                Revenir à l'offre gratuite
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
