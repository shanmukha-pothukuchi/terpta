/**
 * Week stepper: ◀ Sep 14 – 18 ▶ with a Today reset.
 *
 * The Hours screens had grown their own copy of this; a schedule that can be
 * paged to a specific week wants exactly the same control, so it lives here.
 */
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { Button, IconButton } from "./ui";
import { addDaysIso, relativeWeekLabel, thisMonday, weekLabel } from "../lib/week";

export interface WeekNavProps {
  /** ISO Monday of the visible week. */
  weekStart: string;
  onChange: (weekStart: string) => void;
  /** Hides the "this week" caption where the row is already tight. */
  compact?: boolean;
  className?: string;
}

export function WeekNav({ weekStart, onChange, compact, className }: WeekNavProps) {
  const current = thisMonday();
  const isCurrent = weekStart === current;

  return (
    <div className={"flex items-center gap-1.5 " + (className ?? "")}>
      <IconButton
        size="sm"
        variant="ghost"
        aria-label="Previous week"
        onClick={() => onChange(addDaysIso(weekStart, -7))}
      >
        <ChevronLeft size={16} strokeWidth={1.5} aria-hidden />
      </IconButton>

      <div className="flex min-w-0 flex-col items-center leading-tight">
        <span className="whitespace-nowrap font-mono text-[12.5px] text-ink">
          {weekLabel(weekStart)}
        </span>
        {!compact && (
          <span className="whitespace-nowrap text-[11px] text-faint">
            {relativeWeekLabel(weekStart, current)}
          </span>
        )}
      </div>

      <IconButton
        size="sm"
        variant="ghost"
        aria-label="Next week"
        onClick={() => onChange(addDaysIso(weekStart, 7))}
      >
        <ChevronRight size={16} strokeWidth={1.5} aria-hidden />
      </IconButton>

      {/* Only offered when it would do something — paging back is easy to do
          by accident and hard to undo by counting clicks. */}
      {!isCurrent && (
        <Button variant="ghost" size="sm" onClick={() => onChange(current)}>
          <CalendarDays size={14} strokeWidth={1.5} aria-hidden />
          Today
        </Button>
      )}
    </div>
  );
}
