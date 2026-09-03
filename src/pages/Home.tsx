import { Navigate } from "react-router-dom";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { UserRoundPlus } from "lucide-react";
import { useCurrentUser } from "../lib/useCurrentUser";
import { useSignOut } from "../lib/useSignOut";
import { RoleChooser } from "../components/RoleChooser";
import { FullPageSpinner, EmptyState } from "../components/ui";

/** Role-based landing: TA -> availability, coordinator -> roster. */
export default function Home() {
  const me = useCurrentUser();
  const signOut = useSignOut();

  if (me === undefined) {
    return <FullPageSpinner label="Loading your account…" />;
  }

  if (me === null) {
    // Authenticated with WorkOS, but the user.created webhook has not synced
    // a users row yet. The query is reactive, so this resolves on its own.
    return (
      <div className="mx-auto mt-24 max-w-md">
        <EmptyState
          icon={UserRoundPlus}
          title="Finishing account setup…"
          hint="Your account is being synced. This usually takes a few seconds."
        >
          <button
            type="button"
            onClick={() => void signOut()}
            className="cursor-pointer text-[12.5px] text-muted underline underline-offset-2 hover:text-ink"
          >
            Sign out
          </button>
        </EmptyState>
      </div>
    );
  }

  if (!me.role) {
    return <RoleChooser />;
  }

  if (me.role === "coordinator") {
    return <Navigate to="/coordinator/roster" replace />;
  }
  // A TA with no profile at all has never been through setup.
  if (me.taProfiles.length === 0) {
    return <Navigate to="/ta/onboarding" replace />;
  }
  return <TaLanding periodRef={me.taProfiles[0].periodRef} />;
}

/**
 * Sends a TA to setup until they finish it once, then to their availability.
 * The wizard is still reachable later from Preferences.
 */
function TaLanding({ periodRef }: { periodRef: Id<"staffingPeriods"> }) {
  const profile = useQuery(api.ta.getProfile, { periodRef });
  if (profile === undefined) {
    return <FullPageSpinner label="Loading your account…" />;
  }
  return (
    <Navigate
      to={
        profile === null || profile.onboardingCompletedAt === undefined
          ? "/ta/onboarding"
          : "/ta/availability"
      }
      replace
    />
  );
}
