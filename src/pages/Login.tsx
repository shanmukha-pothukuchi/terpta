import { useEffect, useState, type ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@workos-inc/authkit-react";
import { Loader2, TriangleAlert } from "lucide-react";
import { Tooltip } from "../components/ui";

/* ------------------------------------------------------------------ */
/* Domain gate helpers (shared with Callback)                          */
/* ------------------------------------------------------------------ */

/** TerpTA is restricted to UMD accounts. */
export function isUmdEmail(email: string): boolean {
  return /@(umd\.edu|terpmail\.umd\.edu)$/i.test(email.trim());
}

/**
 * sessionStorage key that carries a rejected address across the WorkOS
 * sign-out redirect so the login screen can echo it inline.
 */
export const REJECTED_EMAIL_KEY = "terpta:rejected-email";

export function stashRejectedEmail(email: string) {
  try {
    sessionStorage.setItem(REJECTED_EMAIL_KEY, email);
  } catch {
    /* storage unavailable — the error toastless echo is best-effort */
  }
}

/* ------------------------------------------------------------------ */
/* AuthCanvas — shared dark backdrop for /login and /callback          */
/* (radial glows, TerpTA wordmark top-left, footer links bottom)       */
/* ------------------------------------------------------------------ */

export function AuthCanvas({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-page px-6">
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(600px 300px at 50% 0%, rgba(255,255,255,0.05), transparent 70%), radial-gradient(700px 320px at 50% 110%, rgba(226,24,51,0.09), transparent 70%)",
        }}
      />
      <div className="absolute left-8 top-7 flex items-center gap-2">
        <span
          aria-hidden
          className="size-2 rounded-full bg-umd shadow-[0_0_10px_rgba(226,24,51,0.6)]"
        />
        <span className="text-[14px] font-semibold tracking-[-0.02em] text-ink">
          TerpTA
        </span>
      </div>
      {children}
      <div className="absolute inset-x-0 bottom-6 flex items-center justify-center gap-4 text-[12px] text-[#5B5B64]">
        <a href="#" className="text-faint no-underline hover:text-ink">
          Privacy
        </a>
        <a href="#" className="text-faint no-underline hover:text-ink">
          Help
        </a>
        <span className="font-mono">v0.4</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* LoginScreen — pure presentational card (DEV preview renders this)   */
/* ------------------------------------------------------------------ */

export function LoginScreen({
  loading,
  rejectedEmail,
  onGoogle,
}: {
  /** true while checking the session or redirecting to hosted sign-in. */
  loading: boolean;
  /** Non-UMD address to echo in the inline error box (null = no error). */
  rejectedEmail?: string | null;
  onGoogle?: () => void;
}) {
  return (
    <AuthCanvas>
      <div className="relative flex w-[400px] max-w-full flex-col gap-5 rounded-[14px] border border-line bg-[#111115] p-8 shadow-[0_30px_80px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.04)]">
        <div className="flex flex-col gap-2">
          <h1 className="text-[22px] font-semibold leading-[1.2] tracking-[-0.025em] text-ink">
            Sign in to TerpTA
          </h1>
          <p className="text-[13.5px] leading-[1.5] text-muted [text-wrap:pretty]">
            Weekly availability, duty assignment and hour logging for UMD
            teaching assistants.
          </p>
        </div>

        {rejectedEmail ? (
          <div
            role="alert"
            className="flex items-start gap-2.5 rounded-[10px] border border-[rgba(226,24,51,0.30)] bg-[rgba(226,24,51,0.10)] px-3 py-2.5 text-[12.5px] leading-[1.45] text-[#F4A3AE]"
          >
            <TriangleAlert
              size={16}
              strokeWidth={1.5}
              className="mt-px shrink-0 text-umd"
              aria-hidden
            />
            <div>
              <span className="font-medium text-ink">{rejectedEmail}</span>{" "}
              isn&rsquo;t a UMD account. Sign in with an @umd.edu or
              @terpmail.umd.edu account.
            </div>
          </div>
        ) : null}

        <div className="flex flex-col gap-2.5">
          {loading ? (
            <div className="flex h-10 cursor-default items-center justify-center gap-2.5 rounded-[10px] bg-[#EDEDEF] text-[13.5px] font-medium text-[#0B0B0E] opacity-85">
              <Loader2
                size={16}
                strokeWidth={1.5}
                className="animate-spin"
                style={{ animationDuration: "800ms" }}
                aria-hidden
              />
              Checking your account…
            </div>
          ) : (
            <button
              type="button"
              onClick={onGoogle}
              className="flex h-10 cursor-pointer items-center justify-center gap-2.5 rounded-[10px] bg-[#EDEDEF] text-[13.5px] font-medium text-[#0B0B0E] transition-[background-color,transform] duration-150 hover:bg-white active:scale-[0.99]"
            >
              Continue with Google
            </button>
          )}
          <Tooltip label="UMD CAS sign-in is coming soon" side="bottom" className="w-full">
            <button
              type="button"
              disabled
              className="flex h-10 w-full cursor-not-allowed items-center justify-center gap-2.5 rounded-[10px] border border-line bg-[rgba(255,255,255,0.04)] text-[13.5px] font-medium text-ink opacity-60"
            >
              Sign in with UMD CAS
              <span className="font-mono text-[10.5px] font-normal text-faint">
                soon
              </span>
            </button>
          </Tooltip>
        </div>

        <p className="text-center text-[12px] leading-[1.5] text-faint [text-wrap:pretty]">
          Restricted to <span className="font-mono text-muted">@umd.edu</span>{" "}
          and <span className="font-mono text-muted">@terpmail.umd.edu</span>.
          You&rsquo;ll land on your TA or coordinator home automatically.
        </p>
      </div>
    </AuthCanvas>
  );
}

/* ------------------------------------------------------------------ */
/* Login — wired page (AuthKit)                                        */
/* ------------------------------------------------------------------ */

export default function Login() {
  const { user, isLoading, signIn, signOut } = useAuth();
  const [redirecting, setRedirecting] = useState(false);
  // Read the address stashed by the domain gate before sign-out redirected us.
  const [rejectedEmail] = useState<string | null>(() => {
    try {
      return sessionStorage.getItem(REJECTED_EMAIL_KEY);
    } catch {
      return null;
    }
  });

  // Consume the stashed address so the next visit starts clean.
  useEffect(() => {
    if (rejectedEmail === null) return;
    try {
      sessionStorage.removeItem(REJECTED_EMAIL_KEY);
    } catch {
      /* ignore */
    }
  }, [rejectedEmail]);

  // A signed-in non-UMD account can land here directly (deep link, refresh
  // race). Echo the address and clear the WorkOS session so they can retry.
  const badUser = user !== null && user !== undefined && !isUmdEmail(user.email);
  useEffect(() => {
    if (isLoading || !badUser || !user) return;
    stashRejectedEmail(user.email);
    void signOut();
  }, [isLoading, badUser, user, signOut]);

  if (!isLoading && user && !badUser) {
    return <Navigate to="/" replace />;
  }

  const handleGoogle = () => {
    setRedirecting(true);
    void Promise.resolve(signIn()).catch(() => setRedirecting(false));
  };

  return (
    <LoginScreen
      loading={isLoading || redirecting || badUser}
      rejectedEmail={badUser && user ? user.email : rejectedEmail}
      onGoogle={handleGoogle}
    />
  );
}
