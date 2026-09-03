/**
 * Week stepper: ◀ Sep 14 – 18 ▶, where the label doubles as the reset back to
 * the current week.
 *
 * The Hours screens had grown their own copy of this; a schedule that can be
 * paged to a specific week wants exactly the same control, so it lives here.
 *
 * Every part of it holds a constant size. Paging is a repeated gesture —
 * people hold the arrow and click through several weeks — so anything that
 * resizes or appears between clicks moves the target out from under them.
 */
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { IconButton } from "./ui";
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

      {/* Fixed width, not shrink-to-fit. The label runs from "Oct 19 – 23" to
          "Sep 28 – Oct 2", and letting it size itself moved the arrows out
          from under the pointer between one click and the next. Sized to the
          longest form a Mon–Fri week can produce, plus the reset icon.

          The reset lives in here rather than as its own button: a button that
          mounts the moment you leave the current week either shoves the arrows
          sideways mid-click or, if its space is reserved, leaves a hole that
          makes whatever sits beside it look adrift. Nothing here mounts or
          unmounts, so neither happens. */}
      <div className="flex w-[140px] flex-none flex-col items-center leading-tight">
        <button
          type="button"
          disabled={isCurrent}
          onClick={() => onChange(current)}
          title={isCurrent ? undefined : "Back to this week"}
          className={
            "flex items-center gap-1 whitespace-nowrap font-mono text-[12.5px] text-ink " +
            (isCurrent
              ? "cursor-default"
              : "cursor-pointer rounded-[5px] px-1 hover:bg-[rgba(255,255,255,0.06)]")
          }
        >
          {!isCurrent && (
            <CalendarDays
              size={12}
              strokeWidth={1.5}
              className="shrink-0 text-faint"
              aria-hidden
            />
          )}
          {weekLabel(weekStart)}
        </button>
        {!compact && (
          <span className="max-w-full truncate text-[11px] text-faint">
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

    </div>
  );
}
