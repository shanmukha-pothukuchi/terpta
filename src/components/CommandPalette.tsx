import { Command } from "cmdk";
import { useNavigate } from "react-router-dom";
import {
  CalendarClock,
  CalendarDays,
  Clock3,
  History,
  LayoutGrid,
  Settings2,
  SlidersHorizontal,
  Tags,
  Users,
  Wand2,
  type LucideIcon,
} from "lucide-react";
import type { Role } from "../lib/api";

interface PaletteCommand {
  label: string;
  to: string;
  icon: LucideIcon;
}

const TA_COMMANDS: PaletteCommand[] = [
  { label: "Availability", to: "/ta/availability", icon: CalendarDays },
  { label: "My Schedule", to: "/ta/schedule", icon: CalendarClock },
  { label: "Hours", to: "/ta/hours", icon: Clock3 },
  { label: "Preferences", to: "/ta/onboarding", icon: SlidersHorizontal },
];

const COORDINATOR_COMMANDS: PaletteCommand[] = [
  { label: "Roster", to: "/coordinator/roster", icon: Users },
  { label: "Duty Types", to: "/coordinator/duty-types", icon: Tags },
  { label: "Shifts", to: "/coordinator/shifts", icon: LayoutGrid },
  { label: "Builder", to: "/coordinator/builder", icon: Wand2 },
  { label: "Hours", to: "/coordinator/hours", icon: Clock3 },
  { label: "Changelog", to: "/coordinator/changelog", icon: History },
  { label: "Period Setup", to: "/coordinator/setup", icon: Settings2 },
];

/** cmdk-based command palette skeleton: navigation commands only, for now. */
export function CommandPalette({
  open,
  onOpenChange,
  role,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  role?: Role;
}) {
  const navigate = useNavigate();
  const commands = role === "coordinator" ? COORDINATOR_COMMANDS : TA_COMMANDS;

  const go = (to: string) => {
    onOpenChange(false);
    navigate(to);
  };

  return (
    <Command.Dialog
      open={open}
      onOpenChange={onOpenChange}
      label="Command menu"
      overlayClassName="fixed inset-0 z-40 bg-black/40"
      contentClassName="fixed left-1/2 top-24 z-50 w-full max-w-lg -translate-x-1/2 overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-xl"
    >
      <Command.Input
        placeholder="Go to…"
        className="w-full border-b border-neutral-200 px-4 py-3 text-sm outline-none placeholder:text-neutral-400"
      />
      <Command.List className="max-h-72 overflow-y-auto p-2">
        <Command.Empty className="px-3 py-6 text-center text-sm text-neutral-500">
          No results.
        </Command.Empty>
        <Command.Group
          heading="Navigate"
          className="text-xs font-medium text-neutral-400 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5"
        >
          {commands.map(({ label, to, icon: Icon }) => (
            <Command.Item
              key={to}
              value={label}
              onSelect={() => go(to)}
              className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm text-neutral-800 data-[selected=true]:bg-neutral-100"
            >
              <Icon className="h-4 w-4 text-neutral-500" aria-hidden />
              {label}
            </Command.Item>
          ))}
        </Command.Group>
      </Command.List>
    </Command.Dialog>
  );
}
