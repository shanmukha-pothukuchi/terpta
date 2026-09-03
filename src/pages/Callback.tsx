import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@workos-inc/authkit-react";
import { useSignOut } from "../lib/useSignOut";
import { Loader2 } from "lucide-react";
import { AuthCanvas, isUmdEmail, stashRejectedEmail } from "./Login";

/* ------------------------------------------------------------------ */
/* CallbackScreen — pure presentational (DEV preview renders this)     */
/* ------------------------------------------------------------------ */

export function CallbackScreen({ label = "Completing sign-in…" }: { label?: string }) {
  return (
    <AuthCanvas>
      <div className="relative flex items-center gap-2.5 text-[13px] text-muted">
        <Loader2
          size={16}
          strokeWidth={1.5}
          className="animate-spin"
          style={{ animationDuration: "800ms" }}
          aria-hidden
        />
        {label}
      </div>
    </AuthCanvas>
  );
}

/* ------------------------------------------------------------------ */
/* Callback — wired page                                               */
/*                                                                     */
/* AuthKit redirects here after hosted sign-in. The AuthKitProvider    */
/* client exchanges the code automatically on load; we wait for the    */
/* session, gate on the UMD domain, then route onward (Home handles    */
/* the role-based redirect).                                           */
/* ------------------------------------------------------------------ */

export default function Callback() {
  const { user, isLoading } = useAuth();
  const signOut = useSignOut();
  const navigate = useNavigate();

  useEffect(() => {
    if (isLoading) return;
    if (!user) {
      // Exchange failed or was cancelled on the hosted page.
      navigate("/login", { replace: true });
      return;
    }
    if (!isUmdEmail(user.email)) {
      // Wrong domain: stash the address for the login screen's inline error,
      // then drop the WorkOS session. The logout redirect lands on the app
      // root, which bounces unauthenticated visitors to /login.
      stashRejectedEmail(user.email);
      void signOut();
      return;
    }
    navigate("/", { replace: true });
  }, [isLoading, user, navigate, signOut]);

  return <CallbackScreen />;
}
