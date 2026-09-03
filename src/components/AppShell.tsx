import { useEffect, useState, type ReactNode } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "@workos-inc/authkit-react";
import {
  CalendarCheck,
  CalendarDays,
  CalendarRange,
  Check,
  ChevronDown,
  ChevronsUpDown,
  Clock,
  History,
  LogOut,
  Plus,
  Search,
  SlidersHorizontal,
  Tag,
  Users,
  Wand2,
  type LucideIcon,
} from "lucide-react";
import { useCurrentUser } from "../lib/useCurrentUser";
import { useSignOut } from "../lib/useSignOut";
import { usePeriod, PeriodProvider, type PeriodStatus } from "../lib/period";
import type { Role } from "../lib/api";
import { Toaster } from "./ui";
import { CommandPalette } from "./CommandPalette";
import { DevRoleSwitcher } from "./DevRoleSwitcher";
import { ErrorBoundary } from "./ErrorBoundary";

/* App shell per Shell.dc.html / Nav.dc.html: 208px left nav (full height),
   52px top bar, scrollable content. Dark-only, tokens from src/index.css. */

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

interface NavItem {
  label: string;
  to: string;
  icon: LucideIcon;
}

const TA_NAV: NavItem[] = [
  { label: "Availability", to: "/ta/availability", icon: CalendarCheck },
  { label: "My Schedule", to: "/ta/schedule", icon: CalendarDays },
  { label: "Hours", to: "/ta/hours", icon: Clock },
  { label: "Preferences", to: "/ta/preferences", icon: SlidersHorizontal },
];

const COORDINATOR_NAV: NavItem[] = [
  { label: "Roster", to: "/coordinator/roster", icon: Users },
  { label: "Duty Types", to: "/coordinator/duty-types", icon: Tag },
  { label: "Shifts", to: "/coordinator/shifts", icon: CalendarRange },
  { label: "Builder", to: "/coordinator/builder", icon: Wand2 },
  { label: "Hours", to: "/coordinator/hours", icon: Clock },
  { label: "Changelog", to: "/coordinator/changelog", icon: History },
];

const STATUS_LABEL: Record<PeriodStatus, string> = {
  draft: "Draft",
  collecting: "Collecting",
  generated: "Generated",
  published: "Published",
};

/* ------------------------------------------------------------------ */
/* Left nav — 208px, surface bg, red active icon, mono footer          */
/* ------------------------------------------------------------------ */

function SideNav({ role, userLoading }: { role?: Role; userLoading: boolean }) {
  const { selected, loading: periodLoading } = usePeriod();
  const items = role === "coordinator" ? COORDINATOR_NAV : TA_NAV;

  const footer = periodLoading
    ? "Loading…"
    : selected
      ? `${selected.term} · ${STATUS_LABEL[selected.status]}`
      : "No period selected";

  return (
    <aside className="row-span-2 flex flex-col gap-0.5 border-r border-line bg-surface px-2.5 pb-4 pt-3.5">
      <div className="flex items-center gap-2 px-2 pb-4 pt-1">
        <span
          className="size-2 rounded-full bg-umd shadow-[0_0_10px_rgba(226,24,51,0.6)]"
          aria-hidden
        />
        <span className="text-[14px] font-semibold tracking-[-0.02em]">TerpTA</span>
      </div>
      <nav className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
        {userLoading ? (
          <>
            {[0, 1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-8 animate-pulse rounded-lg bg-[rgba(255,255,255,0.03)]"
              />
            ))}
          </>
        ) : role === undefined ? (
          <p className="px-2 py-1 text-[12px] text-faint">Choose a role to get started.</p>
        ) : (
          items.map(({ label, to, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                cx(
                  "flex h-8 shrink-0 items-center gap-2.5 rounded-lg px-2 text-[13px] transition-colors duration-150",
                  isActive
                    ? "bg-[rgba(255,255,255,0.06)] text-[#F4F4F5]"
                    : "text-muted hover:bg-[rgba(255,255,255,0.06)] hover:text-ink",
                )
              }
            >
              {({ isActive }) => (
                <>
                  <Icon
                    size={16}
                    strokeWidth={1.5}
                    className={cx("shrink-0", isActive ? "text-umd" : "text-faint")}
                    aria-hidden
                  />
                  {label}
                </>
              )}
            </NavLink>
          ))
        )}
      </nav>
      <div className="flex items-center gap-2 border-t border-[rgba(255,255,255,0.06)] px-2 pt-2 font-mono text-[11px] text-faint">
        {footer}
      </div>
    </aside>
  );
}

/* ------------------------------------------------------------------ */
/* Top bar pieces                                                      */
/* ------------------------------------------------------------------ */

function useEscape(active: boolean, onEscape: () => void) {
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onEscape();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, onEscape]);
}

function CourseSwitcher({ role }: { role?: Role }) {
  const { entries, selected, loading, selectPeriod } = usePeriod();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  useEscape(open, () => setOpen(false));

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex h-[30px] cursor-pointer items-center gap-2 rounded-lg border border-line bg-[rgba(255,255,255,0.03)] pl-3 pr-2.5 transition-colors duration-150 hover:bg-[rgba(255,255,255,0.07)]"
      >
        {selected ? (
          <>
            <span className="font-mono text-[12.5px] font-medium">{selected.courseId}</span>
            <span className="text-[#5B5B64]">·</span>
            <span className="text-[12.5px] text-[#C9C9CF]">{selected.term}</span>
          </>
        ) : (
          <span className="text-[12.5px] text-faint">
            {loading ? "Loading…" : "No course"}
          </span>
        )}
        <ChevronsUpDown size={14} strokeWidth={1.5} className="text-faint" aria-hidden />
      </button>
      {open ? (
        <>
          <button
            type="button"
            aria-label="Close menu"
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div
            role="menu"
            className="absolute left-0 top-[34px] z-50 min-w-[240px] rounded-[10px] border border-line-strong bg-popover p-1 shadow-[0_16px_48px_rgba(0,0,0,0.55)]"
          >
            {entries.length === 0 ? (
              <p className="px-2.5 py-3 text-[12.5px] text-faint">
                {loading ? "Loading…" : "No staffing periods yet"}
              </p>
            ) : (
              entries.map((e) => {
                const isSelected = e.periodId === selected?.periodId;
                return (
                  <button
                    key={e.periodId}
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      selectPeriod(e.periodId);
                      setOpen(false);
                    }}
                    className="flex h-8 w-full cursor-pointer items-center gap-2 rounded-[7px] px-2.5 text-left transition-colors duration-100 hover:bg-[rgba(255,255,255,0.06)]"
                  >
                    <span className="font-mono text-[12.5px] font-medium">{e.courseId}</span>
                    <span className="text-[#5B5B64]">·</span>
                    <span className="flex-1 truncate text-[12.5px] text-muted">{e.term}</span>
                    {isSelected ? (
                      <Check size={14} strokeWidth={1.5} className="text-ink" aria-hidden />
                    ) : null}
                  </button>
                );
              })
            )}
            {role === "coordinator" ? (
              <>
                <div className="mx-1 my-1 border-t border-line" aria-hidden />
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setOpen(false);
                    navigate("/coordinator/setup");
                  }}
                  className="flex h-8 w-full cursor-pointer items-center gap-2 rounded-[7px] px-2.5 text-left text-[12.5px] text-muted transition-colors duration-100 hover:bg-[rgba(255,255,255,0.06)] hover:text-ink"
                >
                  <Plus size={14} strokeWidth={1.5} aria-hidden />
                  New staffing period…
                </button>
              </>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}

function PaletteTrigger({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex h-[30px] w-[260px] cursor-pointer items-center gap-2 rounded-lg border border-line bg-[rgba(255,255,255,0.03)] pl-2.5 pr-2 text-[12.5px] text-faint transition-colors duration-150 hover:border-[rgba(255,255,255,0.14)] hover:bg-[rgba(255,255,255,0.06)]"
    >
      <Search size={14} strokeWidth={1.5} aria-hidden />
      <span className="flex-1 text-left">Search or jump to…</span>
      <span className="rounded-[5px] border border-[rgba(255,255,255,0.10)] bg-[rgba(255,255,255,0.04)] px-[5px] py-px font-mono text-[10.5px] text-[#8A8A93]">
        ⌘K
      </span>
    </button>
  );
}

function RoleBadge({ role }: { role?: Role }) {
  if (!role) return null;
  return (
    <span className="flex h-6 items-center rounded-[6px] border border-[rgba(226,24,51,0.28)] bg-[rgba(226,24,51,0.12)] px-2 text-[11.5px] font-medium tracking-[0.01em] text-[#F4A3AE]">
      {role === "coordinator" ? "Coordinator" : "TA"}
    </span>
  );
}

function initialsOf(name?: string, email?: string) {
  const source = name?.trim() || email || "?";
  const words = source.split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return source.slice(0, 2).toUpperCase();
}

function UserMenu({
  name,
  email,
  onSignOut,
}: {
  name?: string;
  email?: string;
  onSignOut: () => void;
}) {
  const [open, setOpen] = useState(false);
  useEscape(open, () => setOpen(false));
  const firstName = name?.trim().split(/\s+/)[0] ?? "Account";

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex h-[30px] cursor-pointer items-center gap-2 rounded-lg pl-1 pr-1.5 transition-colors duration-150 hover:bg-[rgba(255,255,255,0.06)]"
      >
        <span className="flex size-6 items-center justify-center rounded-full bg-gradient-to-br from-[#2B2B33] to-[#3A3A45] text-[10.5px] font-semibold text-ink">
          {initialsOf(name, email)}
        </span>
        <span className="text-[12.5px]">{firstName}</span>
        <ChevronDown size={14} strokeWidth={1.5} className="text-faint" aria-hidden />
      </button>
      {open ? (
        <>
          <button
            type="button"
            aria-label="Close menu"
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div
            role="menu"
            className="absolute right-0 top-[36px] z-50 w-56 rounded-[10px] border border-line-strong bg-popover p-1 shadow-[0_16px_48px_rgba(0,0,0,0.55)]"
          >
            <div className="border-b border-line px-2.5 py-2">
              <p className="truncate text-[12.5px] font-medium text-ink">{name ?? "Account"}</p>
              {email ? <p className="truncate text-[11.5px] text-faint">{email}</p> : null}
            </div>
            <button
              type="button"
              role="menuitem"
              onClick={onSignOut}
              className="mt-1 flex h-8 w-full cursor-pointer items-center gap-2 rounded-[7px] px-2.5 text-left text-[12.5px] text-ink transition-colors duration-100 hover:bg-[rgba(255,255,255,0.06)]"
            >
              <LogOut size={14} strokeWidth={1.5} className="text-faint" aria-hidden />
              Sign out
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Shell layout — pure view, so a DEV preview harness can render it    */
/* (wrap in a router + StaticPeriodProvider; pass data via props).     */
/* ------------------------------------------------------------------ */

export function AppShellView({
  role,
  userLoading = false,
  userName,
  userEmail,
  onSignOut,
  onOpenPalette,
  children,
}: {
  role?: Role;
  userLoading?: boolean;
  userName?: string;
  userEmail?: string;
  onSignOut: () => void;
  onOpenPalette: () => void;
  children: ReactNode;
}) {
  const { selected, loading: periodLoading } = usePeriod();
  // The nav lists screens that belong to a course. Until one is chosen —
  // during the role pick, account sync, or a coordinator's very first
  // visit — every item leads to "no period selected", so the rail is noise
  // beside a screen that is asking one question. The switcher in the header
  // is how a course gets chosen or created, and it stays.
  const showNav =
    role !== undefined && !userLoading && (periodLoading || selected !== null);

  return (
    <div
      className={cx(
        "grid h-dvh grid-rows-[52px_1fr] bg-page text-ink",
        showNav ? "grid-cols-[208px_1fr]" : "grid-cols-[1fr]",
      )}
    >
      {showNav ? <SideNav role={role} userLoading={userLoading} /> : null}
      <header className="flex h-[52px] items-center gap-3 border-b border-line px-5">
        {showNav ? null : (
          <span className="flex items-center gap-2 pr-2">
            <span
              className="size-2 rounded-full bg-umd shadow-[0_0_10px_rgba(226,24,51,0.6)]"
              aria-hidden
            />
            <span className="text-[14px] font-semibold tracking-[-0.02em]">TerpTA</span>
          </span>
        )}
        <CourseSwitcher role={role} />
        <div className="flex-1" />
        {role === "coordinator" ? <PaletteTrigger onOpen={onOpenPalette} /> : null}
        <RoleBadge role={role} />
        <UserMenu name={userName} email={userEmail} onSignOut={onSignOut} />
      </header>
      <main className="min-w-0 overflow-y-auto">
        <div className="px-7 py-6">{children}</div>
      </main>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Connected shell                                                     */
/* ------------------------------------------------------------------ */

function ShellInner() {
  const me = useCurrentUser();
  const { user: workosUser } = useAuth();
  const signOut = useSignOut();
  const [paletteOpen, setPaletteOpen] = useState(false);

  const role = me?.role;

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

  const name =
    me?.name ??
    [workosUser?.firstName, workosUser?.lastName].filter(Boolean).join(" ") ??
    undefined;

  return (
    <>
      <AppShellView
        role={role}
        userLoading={me === undefined}
        userName={name || undefined}
        userEmail={me?.email ?? workosUser?.email}
        onSignOut={() => void signOut()}
        onOpenPalette={() => setPaletteOpen(true)}
      >
        <ErrorBoundary>
          <Outlet />
        </ErrorBoundary>
      </AppShellView>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} role={role} />
      <Toaster />
      <DevRoleSwitcher currentRole={role} />
    </>
  );
}

export function AppShell() {
  return (
    <PeriodProvider>
      <ShellInner />
    </PeriodProvider>
  );
}
