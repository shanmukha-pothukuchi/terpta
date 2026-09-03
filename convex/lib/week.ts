/**
 * ISO week arithmetic for the backend.
 *
 * Mirrors `src/lib/week.ts` — the two cannot import each other across the
 * Convex boundary, so they are kept deliberately small and both tested. Dates
 * are parsed from their parts rather than by `new Date(iso)`, which reads a
 * bare date as UTC midnight and lands on the previous day west of Greenwich.
 */
export type DayCode = "M" | "Tu" | "W" | "Th" | "F";

export const DAY_CODES: DayCode[] = ["M", "Tu", "W", "Th", "F"];

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseIsoDate(iso: string): Date | null {
  const m = iso.match(ISO_DATE);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

export function toIsoDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function addDaysIso(iso: string, days: number): string {
  const d = parseIsoDate(iso);
  if (!d) return iso;
  d.setDate(d.getDate() + days);
  return toIsoDate(d);
}

/** Weekday code for an ISO date, or null at the weekend. */
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
  start: string;
  /** Sunday, so `date <= end` contains a weekend one-off too. */
  end: string;
  days: Array<{ day: DayCode; date: string }>;
}

export function weekRange(weekStart: string): WeekRange {
  return {
    start: weekStart,
    end: addDaysIso(weekStart, 6),
    days: DAY_CODES.map((day) => ({ day, date: dateOfDayInWeek(weekStart, day) })),
  };
}

/** Both ends inclusive, the way date exceptions are stored. */
export function isDateInRange(date: string, start: string, end: string): boolean {
  return start <= date && date <= end;
}

export function rangesOverlap(
  aStart: string,
  aEnd: string,
  bStart: string,
  bEnd: string,
): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}

/** Is a weekly shift repeating during this week? */
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
