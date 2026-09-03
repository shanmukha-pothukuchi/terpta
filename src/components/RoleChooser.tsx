import { useState } from "react";
import { useMutation } from "convex/react";
import { GraduationCap, ShieldCheck, type LucideIcon } from "lucide-react";
import { Button } from "./ui";
import { usersChooseRole, type Role } from "../lib/api";

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

const ROLE_OPTIONS: {
  role: Role;
  title: string;
  confirmLabel: string;
  description: string;
  icon: LucideIcon;
}[] = [
  {
    role: "ta",
    title: "TA",
    confirmLabel: "Continue as TA",
    description: "Submit availability, view your schedule, and log hours.",
    icon: GraduationCap,
  },
  {
    role: "coordinator",
    title: "Coordinator",
    confirmLabel: "Continue as coordinator",
    description: "Set up staffing periods, build schedules, and manage TAs.",
    icon: ShieldCheck,
  },
];

/* ------------------------------------------------------------------ */
/* RoleChooserView — pure presentational (DEV preview renders this)    */
/* ------------------------------------------------------------------ */

export function RoleChooserView({
  selected,
  pending,
  error,
  onSelect,
  onConfirm,
}: {
  selected: Role | null;
  pending?: boolean;
  error?: string | null;
  onSelect: (role: Role) => void;
  onConfirm: () => void;
}) {
  const selectedOption = ROLE_OPTIONS.find((o) => o.role === selected);
  return (
    <div className="mx-auto flex min-h-full w-full max-w-[560px] flex-col justify-center px-6 py-16">
      <h1 className="text-[17px] font-semibold tracking-[-0.01em] text-ink">
        How will you use TerpTA?
      </h1>
      <p className="mt-1 text-[12.5px] text-muted">
        Pick the role that matches how you work with this course.
      </p>

      <div role="radiogroup" aria-label="Role" className="mt-5 grid gap-3 sm:grid-cols-2">
        {ROLE_OPTIONS.map(({ role, title, description, icon: Icon }) => {
          const active = selected === role;
          return (
            <button
              key={role}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={pending}
              onClick={() => onSelect(role)}
              className={cx(
                "cursor-pointer rounded-[10px] border p-5 text-left transition-colors duration-100",
                "disabled:cursor-not-allowed disabled:opacity-60",
                active
                  ? "border-[rgba(255,255,255,0.28)] bg-raised shadow-[0_0_0_3px_rgba(255,255,255,0.05)]"
                  : "border-line bg-surface hover:border-line-strong hover:bg-raised",
              )}
            >
              <span
                className={cx(
                  "grid size-9 place-items-center rounded-[9px]",
                  active
                    ? "bg-[rgba(255,255,255,0.09)] text-ink shadow-[inset_0_0_0_1px_rgba(255,255,255,0.14)]"
                    : "bg-[rgba(255,255,255,0.05)] text-muted shadow-[inset_0_0_0_1px_rgba(255,255,255,0.10)]",
                )}
              >
                <Icon size={18} strokeWidth={1.5} aria-hidden />
              </span>
              <span className="mt-3 block text-[13px] font-medium text-ink">{title}</span>
              <span className="mt-1 block text-[12.5px] leading-[1.45] text-muted">
                {description}
              </span>
            </button>
          );
        })}
      </div>

      <div className="mt-5 flex items-center justify-between gap-3">
        {error ? (
          <p role="alert" className="text-[12.5px] text-[#ff8b9b]">
            {error}
          </p>
        ) : (
          <span className="text-[12px] text-faint">
            Coordinators manage the course; TAs work its shifts.
          </span>
        )}
        <Button
          variant="primary"
          disabled={!selected}
          loading={pending}
          onClick={onConfirm}
          className="shrink-0"
        >
          {selectedOption ? selectedOption.confirmLabel : "Continue"}
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* RoleChooser — wired (Convex users:chooseRole)                       */
/*                                                                     */
/* Shown to authenticated users whose `users` row has no role yet.     */
/* The users:me query is reactive, so the caller re-renders on its own */
/* once the mutation lands (pending stays true to avoid a flicker).    */
/* ------------------------------------------------------------------ */

export function RoleChooser() {
  const chooseRole = useMutation(usersChooseRole);
  const [selected, setSelected] = useState<Role | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = async () => {
    if (!selected) return;
    setPending(true);
    setError(null);
    try {
      await chooseRole({ role: selected });
      // Success: users:me re-runs reactively and Home redirects; keep the
      // button in its loading state until this component unmounts.
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to set role.");
      setPending(false);
    }
  };

  return (
    <RoleChooserView
      selected={selected}
      pending={pending}
      error={error}
      onSelect={setSelected}
      onConfirm={() => void confirm()}
    />
  );
}
