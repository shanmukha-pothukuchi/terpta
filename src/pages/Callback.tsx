import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@workos-inc/authkit-react";
import { FullPageSpinner } from "../components/ui";

/**
 * AuthKit redirects here after hosted sign-in. The AuthKitProvider client
 * exchanges the code automatically on load; we just wait for the session and
 * route onward (Home handles role-based redirect).
 */
export default function Callback() {
  const { user, isLoading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (isLoading) return;
    navigate(user ? "/" : "/login", { replace: true });
  }, [isLoading, user, navigate]);

  return <FullPageSpinner label="Completing sign-in…" />;
}
