import { useState } from "react";
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
import { Historique } from "./pages/Historique";
import { Chat } from "./pages/Chat";
import { Plans } from "./pages/Plans";
import { Objectif } from "./pages/Objectif";
import { ForgotPassword } from "./pages/ForgotPassword";
import { ResetPassword } from "./pages/ResetPassword";
import { Zones } from "./pages/Zones";
import { Admin } from "./pages/Admin";

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
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/mot-de-passe-oublie" element={<ForgotPassword />} />
        <Route path="/reinitialiser-mot-de-passe" element={<ResetPassword />} />
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
        </Route>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
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
