import { useCallback } from "react";
import { useAuth } from "@workos-inc/authkit-react";

/**
 * Sign out without bouncing through WorkOS's hosted logout page.
 *
 * AuthKit's default `signOut()` navigates to the hosted logout URL, which then
 * needs an App homepage URL configured on the WorkOS environment to come back;
 * without one it renders "Couldn't sign in — contact your organization admin".
 * `navigate: false` clears the local session and revokes the WorkOS session in
 * the background instead, and we do the redirect ourselves.
 *
 * The redirect is a full page load on purpose: it re-initialises AuthKit from
 * empty storage, so no stale user state can bounce us back into the app.
 */
export function useSignOut() {
  const { signOut } = useAuth();

  return useCallback(async () => {
    try {
      await signOut({ navigate: false });
    } catch (error) {
      // Already signed out, or the revoke call failed — the local session is
      // gone either way, so continue to the login screen.
      console.error("Sign-out did not complete cleanly", error);
    }
    window.location.assign(`${import.meta.env.BASE_URL}login`);
  }, [signOut]);
}
