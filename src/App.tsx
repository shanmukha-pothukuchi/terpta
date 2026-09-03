import { Navigate } from "react-router-dom";
import { useConvexAuth } from "convex/react";
import { AppShell } from "./components/AppShell";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { FullPageSpinner } from "./components/ui";

/**
 * Auth-gated layout: everything except /login and /callback renders inside
 * this. Unauthenticated users are sent to /login.
 */
export default function App() {
  const { isLoading, isAuthenticated } = useConvexAuth();

  if (isLoading) {
    return <FullPageSpinner label="Signing you in…" />;
  }
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return (
    <ErrorBoundary>
      <AppShell />
    </ErrorBoundary>
  );
}
