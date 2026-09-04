import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../lib/AuthContext";
import { Spinner } from "./Spinner";

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center gap-2 text-zinc-500">
        <Spinner />
        Chargement...
      </div>
    );
  }
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  if (!user.profile && location.pathname !== "/onboarding" && location.pathname !== "/plans-intro") {
    return <Navigate to="/onboarding" replace />;
  }
  return <>{children}</>;
}
