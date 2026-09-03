import { useEffect, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "@workos-inc/authkit-react";
import {
  CalendarClock,
  CalendarDays,
  ChevronsUpDown,
  Clock3,
  Command as CommandIcon,
  History,
  LayoutGrid,
  LogOut,
  SlidersHorizontal,
  Tags,
  Users,
  Wand2,
  type LucideIcon,
} from "lucide-react";
import { useCurrentUser } from "../lib/useCurrentUser";
import { usePeriod, PeriodProvider } from "../lib/period";
import type { Role } from "../lib/api";
import { CommandPalette } from "./CommandPalette";
import { DevRoleSwitcher } from "./DevRoleSwitcher";
import { ErrorBoundary } from "./ErrorBoundary";

interface NavItem {
  label: string;
  to: string;
  icon: LucideIcon;
}

const TA_NAV: NavItem[] = [
  { label: "Availability", to: "/ta/availability", icon: CalendarDays },
  { label: "My Schedule", to: "/ta/schedule", icon: CalendarClock },
  { label: "Hours", to: "/ta/hours", icon: Clock3 },
  { label: "Preferences", to: "/ta/onboarding", icon: SlidersHorizontal },
];

const COORDINATOR_NAV: NavItem[] = [
  { label: "Roster", to: "/coordinator/roster", icon: Users },
  { label: "Duty Types", to: "/coordinator/duty-types", icon: Tags },
  { label: "Shifts", to: "/coordinator/shifts", icon: LayoutGrid },
  { label: "Builder", to: "/coordinator/builder", icon: Wand2 },
  { label: "Hours", to: "/coordinator/hours", icon: Clock3 },
  { label: "Changelog", to: "/coordinator/changelog", icon: History },
];

function RoleBadge({ role }: { role?: Role }) {
  if (!role) return null;
  return (
    <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-neutral-600">
      {role === "coordinator" ? "Coordinator" : "TA"}
    </span>
  );
}

function CourseSwitcherStub() {
  const { label } = usePeriod();
  return (
    <button
      type="button"
      disabled
      title="Course/term switching lands with period setup"
      className="flex w-full items-center justify-between rounded-md border border-neutral-200 px-2.5 py-2 text-left text-sm text-neutral-500"
    >
      <span className="truncate">{label}</span>
      <ChevronsUpDown className="h-4 w-4 shrink-0 text-neutral-400" aria-hidden />
    </button>
  );
}

function UserMenu({ name, email }: { name?: string; email?: string }) {
  const { signOut } = useAuth();
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-neutral-100"
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-neutral-200 text-xs font-semibold text-neutral-700">
          {(name ?? email ?? "?").slice(0, 1).toUpperCase()}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium text-neutral-800">
            {name ?? "Account"}
          </span>
          <span className="block truncate text-xs text-neutral-500">
            {email}
          </span>
        </span>
      </button>
      {open ? (
        <>
          <button
            type="button"
            aria-label="Close menu"
            className="fixed inset-0 z-10 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div className="absolute bottom-full left-0 z-20 mb-1 w-full rounded-md border border-neutral-200 bg-white py-1 shadow-lg">
            <button
              type="button"
              onClick={() => void signOut()}
              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-50"
            >
              <LogOut className="h-4 w-4" aria-hidden />
              Sign out
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}

export function AppShell() {
  const me = useCurrentUser();
  const { user: workosUser } = useAuth();
  const [paletteOpen, setPaletteOpen] = useState(false);

  const role = me?.role;
  const nav = role === "coordinator" ? COORDINATOR_NAV : TA_NAV;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <PeriodProvider>
      <div className="flex min-h-screen">
        <aside className="flex w-60 shrink-0 flex-col border-r border-neutral-200">
          <div className="flex items-center justify-between px-4 pb-2 pt-4">
            <span className="text-base font-bold tracking-tight">TerpTA</span>
            <RoleBadge role={role} />
          </div>
          <div className="px-3 pb-3">
            <CourseSwitcherStub />
          </div>
          <nav className="flex-1 space-y-0.5 px-3">
            {role === undefined && me === undefined ? (
              <p className="px-2 py-1 text-xs text-neutral-400">Loading…</p>
            ) : (
              nav.map(({ label, to, icon: Icon }) => (
                <NavLink
                  key={to}
                  to={to}
                  className={({ isActive }) =>
                    "flex items-center gap-2 rounded-md px-2 py-2 text-sm " +
                    (isActive
                      ? "bg-neutral-100 font-medium text-neutral-900"
                      : "text-neutral-600 hover:bg-neutral-50 hover:text-neutral-900")
                  }
                >
                  <Icon className="h-4 w-4" aria-hidden />
                  {label}
                </NavLink>
              ))
            )}
          </nav>
          {role === "coordinator" ? (
            <div className="px-3 pb-1">
              <button
                type="button"
                onClick={() => setPaletteOpen(true)}
                className="flex w-full items-center gap-2 rounded-md border border-neutral-200 px-2.5 py-2 text-sm text-neutral-500 hover:bg-neutral-50"
              >
                <CommandIcon className="h-4 w-4" aria-hidden />
                Command menu
                <kbd className="ml-auto rounded border border-neutral-200 px-1 text-[10px] text-neutral-400">
                  ⌘K
                </kbd>
              </button>
            </div>
          ) : null}
          <div className="border-t border-neutral-200 p-2">
            <UserMenu
              name={me?.name ?? workosUser?.firstName ?? undefined}
              email={me?.email ?? workosUser?.email}
            />
          </div>
        </aside>
        <main className="min-w-0 flex-1 px-8 py-6">
          <ErrorBoundary>
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        role={role}
      />
      <DevRoleSwitcher currentRole={role} />
    </PeriodProvider>
  );
}
