import { useState } from "react";
import { useMutation } from "convex/react";
import { GraduationCap, Loader2, ShieldCheck } from "lucide-react";
import { usersChooseRole, type Role } from "../lib/api";

/**
 * Shown to authenticated users whose `users` row has no role yet.
 * The users:me query is reactive, so the caller re-renders automatically
 * once the mutation lands.
 */
export function RoleChooser() {
  const chooseRole = useMutation(usersChooseRole);
  const [pending, setPending] = useState<Role | null>(null);
  const [error, setError] = useState<string | null>(null);

  const choose = async (role: Role) => {
    setPending(role);
    setError(null);
    try {
      await chooseRole({ role });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to set role.");
      setPending(null);
    }
  };

  const options: {
    role: Role;
    title: string;
    description: string;
    icon: typeof GraduationCap;
  }[] = [
    {
      role: "ta",
      title: "I'm a TA",
      description: "Submit availability, view your schedule, and log hours.",
      icon: GraduationCap,
    },
    {
      role: "coordinator",
      title: "I'm a coordinator",
      description: "Set up staffing periods, build schedules, and manage TAs.",
      icon: ShieldCheck,
    },
  ];

  return (
    <div className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center px-6">
      <h1 className="text-xl font-semibold tracking-tight">
        How will you use TerpTA?
      </h1>
      <p className="mt-1 text-sm text-neutral-500">
        Pick the role that matches how you work with this course.
      </p>
      <div className="mt-6 grid w-full gap-3 sm:grid-cols-2">
        {options.map(({ role, title, description, icon: Icon }) => (
          <button
            key={role}
            type="button"
            disabled={pending !== null}
            onClick={() => void choose(role)}
            className="rounded-lg border border-neutral-200 p-4 text-left hover:border-neutral-400 hover:bg-neutral-50 disabled:opacity-60"
          >
            {pending === role ? (
              <Loader2 className="h-5 w-5 animate-spin text-neutral-500" aria-hidden />
            ) : (
              <Icon className="h-5 w-5 text-neutral-700" aria-hidden />
            )}
            <div className="mt-2 text-sm font-medium">{title}</div>
            <div className="mt-1 text-xs text-neutral-500">{description}</div>
          </button>
        ))}
      </div>
      {error ? <p className="mt-4 text-sm text-red-600">{error}</p> : null}
    </div>
  );
}
