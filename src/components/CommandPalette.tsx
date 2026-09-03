import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Command, useCommandState } from "cmdk";
import { useNavigate } from "react-router-dom";
import { useQuery } from "convex/react";
import { Search } from "lucide-react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { usePeriod } from "../lib/period";
import type { Role } from "../lib/api";

/**
 * ⌘K command palette (cmdk), styled per Shell.dc.html.
 * Groups: Navigate (role screens) / Actions (coordinator, builder intents via
 * router state) / TAs (coordinator roster → roster page opens the TA drawer).
 *
 * Contracts consumed by sibling pages:
 * - Builder:  location.state.intent ∈ "generate" | "show-unfilled" | "publish"
 * - Roster:   location.state.openTa = Id<"taProfiles"> (open that TA's drawer)
 */

export type BuilderIntent = "generate" | "show-unfilled" | "publish";

export interface PaletteTa {
  taProfileRef: string;
  name: string;
  email: string;
}

interface NavEntry {
  label: string;
  to: string;
  kbd?: string;
}

const TA_NAV: NavEntry[] = [
  { label: "Availability", to: "/ta/availability" },
  { label: "My Schedule", to: "/ta/schedule" },
  { label: "Hours", to: "/ta/hours" },
  { label: "Preferences", to: "/ta/onboarding" },
];

const COORDINATOR_NAV: NavEntry[] = [
  { label: "Roster", to: "/coordinator/roster", kbd: "G R" },
  { label: "Duty Types", to: "/coordinator/duty-types", kbd: "G D" },
  { label: "Shifts", to: "/coordinator/shifts", kbd: "G S" },
  { label: "Builder", to: "/coordinator/builder", kbd: "G B" },
  { label: "Hours", to: "/coordinator/hours", kbd: "G H" },
  { label: "Changelog", to: "/coordinator/changelog", kbd: "G C" },
];

const ACTIONS: Array<{ label: string; intent: BuilderIntent; kbd?: string }> = [
  { label: "Generate schedule", intent: "generate", kbd: "⌘ ⇧ G" },
  { label: "Show unfilled", intent: "show-unfilled" },
  { label: "Publish…", intent: "publish", kbd: "⌘ ⇧ P" },
];

const KBD_CHIP =
  "rounded-[5px] border border-[rgba(255,255,255,0.10)] bg-[rgba(255,255,255,0.04)] px-[5px] py-px font-mono text-[10.5px] text-[#8A8A93]";

const GROUP_HEADING =
  "[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1 " +
  "[&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium " +
  "[&_[cmdk-group-heading]]:tracking-[0.02em] [&_[cmdk-group-heading]]:text-faint";

function PaletteItem({
  value,
  onSelect,
  children,
  meta,
  kbd,
}: {
  value: string;
  onSelect: () => void;
  children: ReactNode;
  meta?: string;
  kbd?: string;
}) {
  return (
    <Command.Item
      value={value}
      onSelect={onSelect}
      className="flex h-[34px] cursor-pointer items-center gap-2.5 rounded-lg px-2.5 text-[13px] text-[#C9C9CF] data-[selected=true]:bg-[rgba(255,255,255,0.07)] data-[selected=true]:text-[#F4F4F5]"
    >
      <span className="flex-1 truncate">{children}</span>
      {meta ? <span className="shrink-0 text-[11px] text-faint">{meta}</span> : null}
      {kbd ? (
        <span className="shrink-0 font-mono text-[10.5px] text-[#8A8A93]">{kbd}</span>
      ) : null}
    </Command.Item>
  );
}

function ResultCount() {
  const count = useCommandState((s) => s.filtered.count);
  return <span>{count} results</span>;
}

/**
 * Pure palette UI — no Convex/auth hooks, so a DEV preview harness can render
 * it directly (wrap in a MemoryRouter-free tree; all effects are DOM-only).
 */
export function CommandPaletteView({
  open,
  onClose,
  role,
  tas = [],
  tasLoading = false,
  onNavigate,
  onAction,
  onOpenTa,
}: {
  open: boolean;
  onClose: () => void;
  role?: Role;
  tas?: PaletteTa[];
  tasLoading?: boolean;
  onNavigate: (to: string) => void;
  onAction: (intent: BuilderIntent) => void;
  onOpenTa: (taProfileRef: string) => void;
}) {
  const [q, setQ] = useState("");
  const isCoordinator = role === "coordinator";
  const navEntries = isCoordinator ? COORDINATOR_NAV : TA_NAV;

  useEffect(() => {
    if (open) setQ("");
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50">
      <style>{`@keyframes tta-fade-up{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}`}</style>
      <button
        type="button"
        aria-label="Close command palette"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-black/45 backdrop-blur-[2px]"
      />
      <div className="pointer-events-none absolute inset-x-0 top-[120px] flex justify-center px-4">
        <Command
          loop
          label="Command menu"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              onClose();
            }
          }}
          className="pointer-events-auto w-[580px] max-w-full overflow-hidden rounded-[14px] border border-[rgba(255,255,255,0.10)] bg-raised shadow-[0_30px_90px_rgba(0,0,0,0.6),0_0_0_1px_rgba(0,0,0,0.6),inset_0_1px_0_rgba(255,255,255,0.05)]"
          style={{ animation: "tta-fade-up 160ms ease-out" }}
        >
          <div className="flex h-12 items-center gap-2.5 border-b border-line px-4">
            <Search size={16} strokeWidth={1.5} className="shrink-0 text-faint" aria-hidden />
            <Command.Input
              autoFocus
              value={q}
              onValueChange={setQ}
              placeholder="Type a command or search TAs…"
              className="h-full min-w-0 flex-1 bg-transparent text-[14px] text-ink caret-umd outline-none placeholder:text-faint"
            />
            <span className={KBD_CHIP}>esc</span>
          </div>

          <Command.List className="max-h-[380px] overflow-y-auto p-1.5">
            <Command.Empty className="px-2.5 py-[22px] text-center text-[13px] text-faint">
              No matches for “{q}”
            </Command.Empty>

            <Command.Group heading="Navigate" className={GROUP_HEADING}>
              {navEntries.map((n) => (
                <PaletteItem
                  key={n.to}
                  value={`${n.label} page`}
                  meta="Page"
                  kbd={n.kbd}
                  onSelect={() => onNavigate(n.to)}
                >
                  {n.label}
                </PaletteItem>
              ))}
            </Command.Group>

            {isCoordinator ? (
              <Command.Group heading="Actions" className={GROUP_HEADING}>
                {ACTIONS.map((a) => (
                  <PaletteItem
                    key={a.intent}
                    value={`${a.label} builder`}
                    meta="Builder"
                    kbd={a.kbd}
                    onSelect={() => onAction(a.intent)}
                  >
                    {a.label}
                  </PaletteItem>
                ))}
              </Command.Group>
            ) : null}

            {isCoordinator && (tasLoading || tas.length > 0) ? (
              <Command.Group heading="TAs" className={GROUP_HEADING}>
                {tasLoading ? (
                  <Command.Loading className="px-2.5 py-2 text-[12.5px] text-faint">
                    Loading TAs…
                  </Command.Loading>
                ) : (
                  tas.map((ta) => (
                    <PaletteItem
                      key={ta.taProfileRef}
                      value={`${ta.name} ${ta.email}`}
                      meta={ta.email}
                      onSelect={() => onOpenTa(ta.taProfileRef)}
                    >
                      {ta.name}
                    </PaletteItem>
                  ))
                )}
              </Command.Group>
            ) : null}
          </Command.List>

          <div className="flex h-9 items-center gap-3.5 border-t border-line px-3.5 font-mono text-[11px] text-faint">
            <span>↑↓ navigate</span>
            <span>↵ select</span>
            <span>esc close</span>
            <span className="flex-1" />
            <ResultCount />
          </div>
        </Command>
      </div>
    </div>,
    document.body,
  );
}

/**
 * Connected palette: pulls the coordinator roster for the selected period and
 * routes selections. Pass `fixtureTas` to bypass the roster query's data
 * (the query is skipped while closed or when not a coordinator).
 */
export function CommandPalette({
  open,
  onOpenChange,
  role,
  fixtureTas,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  role?: Role;
  fixtureTas?: PaletteTa[];
}) {
  const navigate = useNavigate();
  const { periodId } = usePeriod();
  const rosterArgs =
    open && fixtureTas === undefined && role === "coordinator" && periodId !== null
      ? { periodRef: periodId }
      : ("skip" as const);
  const roster = useQuery(api.roster.list, rosterArgs);

  const tas: PaletteTa[] =
    fixtureTas ??
    (roster ?? []).map((r) => ({
      taProfileRef: r.taProfileRef,
      name: r.name,
      email: r.email,
    }));

  const close = () => onOpenChange(false);

  return (
    <CommandPaletteView
      open={open}
      onClose={close}
      role={role}
      tas={tas}
      tasLoading={rosterArgs !== "skip" && roster === undefined}
      onNavigate={(to) => {
        close();
        navigate(to);
      }}
      onAction={(intent) => {
        close();
        navigate("/coordinator/builder", { state: { intent } });
      }}
      onOpenTa={(taProfileRef) => {
        close();
        navigate("/coordinator/roster", {
          state: { openTa: taProfileRef as Id<"taProfiles"> },
        });
      }}
    />
  );
}
