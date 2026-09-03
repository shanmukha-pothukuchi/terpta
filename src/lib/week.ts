/**
 * ISO week arithmetic, shared by every screen that shows "this week".
 *
 * Three screens had grown their own private `mondayOf` / `addDaysIso` pair.
 * They agree today, but a schedule that disagrees with an hour log about which
 * Monday a date belongs to is the kind of bug nobody notices until payroll.
 *
 * Dates are handled as local time throughout: `new Date("2026-09-14")` is UTC
 * midnight, which is the previous day everywhere west of Greenwich, so every
 * parse here goes through the year/month/day parts instead.
 */
import { DAY_CODES, type DayCode } from "./format";

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Parse an ISO date as local midnight. Returns null if it is not one. */
export function parseIsoDate(iso: string): Date | null {
  const m = iso.match(ISO_DATE);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

export function toIsoDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function todayIso(): string {
  return toIsoDate(new Date());
}

export function addDaysIso(iso: string, days: number): string {
  const d = parseIsoDate(iso);
  if (!d) return iso;
  d.setDate(d.getDate() + days);
  return toIsoDate(d);
}

/** Monday of the week containing `iso`. Sunday belongs to the week before. */
export function mondayOf(iso: string): string {
  const d = parseIsoDate(iso);
  if (!d) return iso;
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return toIsoDate(d);
}

/** Monday of the current week. */
export function thisMonday(): string {
  return mondayOf(todayIso());
}

/** The weekday code for an ISO date, or null at the weekend. */
export function dayOfIso(iso: string): DayCode | null {
  const d = parseIsoDate(iso);
  if (!d) return null;
  const dow = d.getDay();
  return dow >= 1 && dow <= 5 ? DAY_CODES[dow - 1]! : null;
}

/** The ISO date of `day` within the week starting at `weekStart`. */
export function dateOfDayInWeek(weekStart: string, day: DayCode): string {
  return addDaysIso(weekStart, DAY_CODES.indexOf(day));
}

export interface WeekRange {
  /** Monday, inclusive. */
  start: string;
  /** Sunday, inclusive — so `date <= end` is a complete containment test. */
  end: string;
  /** Mon–Fri, in order. */
  days: Array<{ day: DayCode; date: string }>;
}

export function weekRange(weekStart: string): WeekRange {
  return {
    start: weekStart,
    end: addDaysIso(weekStart, 6),
    days: DAY_CODES.map((day) => ({ day, date: dateOfDayInWeek(weekStart, day) })),
  };
}

/** Inclusive on both ends, the way date exceptions are stored. */
export function isDateInRange(date: string, start: string, end: string): boolean {
  return start <= date && date <= end;
}

/** Do [aStart,aEnd] and [bStart,bEnd] share any day? Both inclusive. */
export function rangesOverlap(
  aStart: string,
  aEnd: string,
  bStart: string,
  bEnd: string,
): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}

/**
 * Is a weekly shift running during this week? Its optional start/end dates
 * bound the stretch of term it repeats over.
 */
export function weeklyShiftRunsInWeek(
  shift: { startDate?: string; endDate?: string },
  week: WeekRange,
): boolean {
  return rangesOverlap(
    shift.startDate ?? "0000-01-01",
    shift.endDate ?? "9999-12-31",
    week.start,
    week.end,
  );
}

/** "Sep 14 – 18" / "Sep 28 – Oct 2" — the Mon–Fri span, for a week header. */
export function weekLabel(weekStart: string): string {
  const start = parseIsoDate(weekStart);
  const end = parseIsoDate(addDaysIso(weekStart, 4));
  if (!start || !end) return weekStart;
  const month = (d: Date) => d.toLocaleDateString(undefined, { month: "short" });
  return start.getMonth() === end.getMonth()
    ? `${month(start)} ${start.getDate()} – ${end.getDate()}`
    : `${month(start)} ${start.getDate()} – ${month(end)} ${end.getDate()}`;
}

/** "this week" / "next week" / "3 weeks ago", relative to today's Monday. */
export function relativeWeekLabel(weekStart: string, from = thisMonday()): string {
  const a = parseIsoDate(weekStart);
  const b = parseIsoDate(from);
  if (!a || !b) return "";
  const weeks = Math.round((a.getTime() - b.getTime()) / (7 * 24 * 60 * 60 * 1000));
  if (weeks === 0) return "this week";
  if (weeks === 1) return "next week";
  if (weeks === -1) return "last week";
  return weeks > 0 ? `in ${weeks} weeks` : `${-weeks} weeks ago`;
}
