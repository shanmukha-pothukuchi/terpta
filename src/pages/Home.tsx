import { Navigate } from "react-router-dom";
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

  return (
    <Navigate
      to={me.role === "coordinator" ? "/coordinator/roster" : "/ta/availability"}
      replace
    />
  );
}
