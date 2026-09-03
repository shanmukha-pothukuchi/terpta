import { useEffect, useRef } from "react";
import { useAction } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useCurrentUser } from "./useCurrentUser";

/**
 * Backstop for the WorkOS user.created webhook.
 *
 * `users.current` returns null when the signed-in WorkOS account has no row
 * yet. That is normally a brief window before the webhook lands, but on a
 * deployment whose webhook is not configured it never resolves on its own, so
 * pull the profile from WorkOS once instead of waiting forever.
 */
export function useEnsureUserSynced() {
  const me = useCurrentUser();
  const syncSelf = useAction(api.users.syncSelf);
  const requested = useRef(false);

  useEffect(() => {
    if (me !== null || requested.current) return;
    requested.current = true;
    void syncSelf({}).catch((error) => {
      console.error("Could not sync your TerpTA account from WorkOS", error);
    });
  }, [me, syncSelf]);
}

/** Renders nothing; runs {@link useEnsureUserSynced} inside the auth gate. */
export function EnsureUserSynced() {
  useEnsureUserSynced();
  return null;
}
