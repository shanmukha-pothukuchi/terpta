import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { useConvexAuth } from "convex/react";
import { useAuth } from "@workos-inc/authkit-react";
import { ShieldAlert } from "lucide-react";
import { AppShell } from "./components/AppShell";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { EmptyState, FullPageSpinner } from "./components/ui";
import { EnsureUserSynced } from "./lib/useEnsureUserSynced";
import { useSignOut } from "./lib/useSignOut";

/** Grace period before we call a stalled WorkOS -> Convex handoff broken. */
const HANDOFF_TIMEOUT_MS = 6000;

/**
 * Shown when WorkOS has a session but Convex never accepted the access token.
 * Redirecting to /login here would ping-pong forever, because /login sends
 * signed-in users straight back to /.
 */
function HandoffFailed({ onSignOut }: { onSignOut: () => void }) {
  return (
    <div className="mx-auto mt-24 max-w-md px-6">
      <EmptyState
        icon={ShieldAlert}
        title="Couldn’t finish signing you in"
        hint="You’re signed in with WorkOS, but the TerpTA server rejected the session. Signing out and back in usually clears it; the browser console has the details."
      >
        <button
          type="button"
          onClick={onSignOut}
          className="cursor-pointer text-[12.5px] text-muted underline underline-offset-2 hover:text-ink"
        >
          Sign out
        </button>
      </EmptyState>
    </div>
  );
}

/**
 * Auth-gated layout: everything except /login and /callback renders inside
 * this. Unauthenticated users are sent to /login.
 */
export default function App() {
  const { isLoading: convexLoading, isAuthenticated } = useConvexAuth();
  const { isLoading: authKitLoading, user } = useAuth();
  const signOut = useSignOut();

  // Only start the clock once WorkOS has a user but Convex has not caught up.
  const handoffPending = !authKitLoading && !!user && !isAuthenticated;
  const [handoffTimedOut, setHandoffTimedOut] = useState(false);
  useEffect(() => {
    if (!handoffPending) {
      setHandoffTimedOut(false);
      return;
    }
    const timer = setTimeout(() => setHandoffTimedOut(true), HANDOFF_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [handoffPending]);

  if (isAuthenticated) {
    return (
      <ErrorBoundary>
        <EnsureUserSynced />
        <AppShell />
      </ErrorBoundary>
    );
  }
  if (authKitLoading || convexLoading) {
    return <FullPageSpinner label="Signing you in…" />;
  }
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  return handoffTimedOut ? (
    <HandoffFailed onSignOut={() => void signOut()} />
  ) : (
    <FullPageSpinner label="Signing you in…" />
  );
}
