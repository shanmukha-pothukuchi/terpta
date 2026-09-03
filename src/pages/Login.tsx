import { Navigate } from "react-router-dom";
import { useAuth } from "@workos-inc/authkit-react";
import { LogIn } from "lucide-react";
import { FullPageSpinner } from "../components/ui";

export default function Login() {
  const { user, isLoading, signIn } = useAuth();

  if (isLoading) {
    return <FullPageSpinner label="Checking session…" />;
  }
  if (user) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-6">
      <h1 className="text-3xl font-bold tracking-tight">TerpTA</h1>
      <p className="mt-2 text-sm text-neutral-500">
        TA scheduling for UMD courses — availability, shifts, and hours in one
        place.
      </p>
      <button
        type="button"
        onClick={() => void signIn()}
        className="mt-8 flex items-center gap-2 rounded-md bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-neutral-700"
      >
        <LogIn className="h-4 w-4" aria-hidden />
        Sign in with Google
      </button>
      <p className="mt-4 text-xs text-neutral-400">
        Use your umd.edu or terpmail.umd.edu account.
      </p>
    </div>
  );
}
