import { useMutation } from "convex/react";
import { FlaskConical } from "lucide-react";
import { usersDevSetRole, type Role } from "../lib/api";

/** Dev-only role switcher; never renders in production builds. */
export function DevRoleSwitcher({ currentRole }: { currentRole?: Role }) {
  const devSetRole = useMutation(usersDevSetRole);

  if (!import.meta.env.DEV) {
    return null;
  }

  const setRole = (role: Role) => {
    void devSetRole({ role }).catch((e: unknown) => {
      console.error("devSetRole failed", e);
    });
  };

  return (
    <div className="fixed bottom-3 right-3 z-50 flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-900 shadow-sm">
      <FlaskConical className="h-3.5 w-3.5" aria-hidden />
      <span className="font-medium">dev role:</span>
      {(["ta", "coordinator"] as const).map((role) => (
        <button
          key={role}
          type="button"
          onClick={() => setRole(role)}
          className={
            "rounded-full px-2 py-0.5 " +
            (currentRole === role
              ? "bg-amber-200 font-semibold"
              : "hover:bg-amber-100")
          }
        >
          {role}
        </button>
      ))}
    </div>
  );
}
