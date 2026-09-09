import { Suspense, lazy, useState } from "react";
import { BrowserRouter, Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./lib/AuthContext";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { Layout } from "./components/Layout";
import { AnimatedBackground } from "./components/AnimatedBackground";
import { SplashScreen } from "./components/SplashScreen";
import { Login } from "./pages/Login";
import { Register } from "./pages/Register";
import { Onboarding } from "./pages/Onboarding";
import { Dashboard } from "./pages/Dashboard";
const Historique = lazy(() => import("./pages/Historique").then((m) => ({ default: m.Historique })));
import { Chat } from "./pages/Chat";
import { Plans } from "./pages/Plans";
import { Objectif } from "./pages/Objectif";
import { ForgotPassword } from "./pages/ForgotPassword";
import { ResetPassword } from "./pages/ResetPassword";
const Zones = lazy(() => import("./pages/Zones").then((m) => ({ default: m.Zones })));
const Admin = lazy(() => import("./pages/Admin").then((m) => ({ default: m.Admin })));
const Compte = lazy(() => import("./pages/Compte").then((m) => ({ default: m.Compte })));
const StravaReturn = lazy(() => import("./pages/StravaReturn").then((m) => ({ default: m.StravaReturn })));
const VerifyEmail = lazy(() => import("./pages/VerifyEmail").then((m) => ({ default: m.VerifyEmail })));
const Conditions = lazy(() => import("./pages/Legal").then((m) => ({ default: m.Conditions })));
const Confidentialite = lazy(() => import("./pages/Legal").then((m) => ({ default: m.Confidentialite })));
const MentionsLegales = lazy(() => import("./pages/Legal").then((m) => ({ default: m.MentionsLegales })));

function AppShell() {
  const [showSplash, setShowSplash] = useState(true);
  const [initialPath] = useState(() => window.location.pathname);
  const { user } = useAuth();
  const navigate = useNavigate();

  function handleSplashFinish() {
    setShowSplash(false);
    if (!user && initialPath === "/") {
      navigate("/register", { replace: true });
    }
  }

  return (
    <>
      <AnimatedBackground />
      {showSplash && <SplashScreen onFinish={handleSplashFinish} />}
      <Suspense
        fallback={
          <div className="flex min-h-screen items-center justify-center">
            <span className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-700 border-t-rose-500" />
          </div>
        }
      >
        <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/mot-de-passe-oublie" element={<ForgotPassword />} />
        <Route path="/reinitialiser-mot-de-passe" element={<ResetPassword />} />
        <Route path="/verifier-email" element={<VerifyEmail />} />
        <Route
          path="/strava/retour"
          element={
            <ProtectedRoute>
              <StravaReturn />
            </ProtectedRoute>
          }
        />
        <Route path="/conditions" element={<Conditions />} />
        <Route path="/confidentialite" element={<Confidentialite />} />
        <Route path="/mentions-legales" element={<MentionsLegales />} />
        <Route
          path="/plans-intro"
          element={
            <ProtectedRoute>
              <Plans />
            </ProtectedRoute>
          }
        />
        <Route
          path="/onboarding"
          element={
            <ProtectedRoute>
              <Onboarding />
            </ProtectedRoute>
          }
        />
        <Route
          element={
            <ProtectedRoute>
              <Layout />
            </ProtectedRoute>
          }
        >
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/historique" element={<Historique />} />
          <Route path="/chat" element={<Chat />} />
          <Route path="/abonnement" element={<Plans />} />
          <Route path="/objectif" element={<Objectif />} />
          <Route path="/zones" element={<Zones />} />
          <Route path="/admin" element={<Admin />} />
          <Route path="/compte" element={<Compte />} />
        </Route>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </Suspense>
    </>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppShell />
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
