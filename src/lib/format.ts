/* Shared formatters — Geist Mono values, board-style output.
   Times render like "8:00" / "7:30" (12-hour clock, no meridiem — the
   design mocks only spell out " PM" for one-off evening events);
   compact form drops ":00". */

export type DayCode = "M" | "Tu" | "W" | "Th" | "F";

/** Canonical week order used across grids and schedules. */
export const DAY_CODES: DayCode[] = ["M", "Tu", "W", "Th", "F"];

export const DAY_LABELS: Record<DayCode, string> = {
  M: "Monday",
  Tu: "Tuesday",
  W: "Wednesday",
  Th: "Thursday",
  F: "Friday",
};

export const DAY_SHORT: Record<DayCode, string> = {
  M: "Mon",
  Tu: "Tue",
  W: "Wed",
  Th: "Thu",
  F: "Fri",
};

/**
 * Minutes-from-midnight → "8:00a" / "7:30p" (board style).
 * `compact` drops ":00" on the hour → "8a" / "7:30p".
 */
export function formatTime(minutes: number, opts: { compact?: boolean } = {}): string {
  const total = ((Math.round(minutes) % 1440) + 1440) % 1440;
  const h24 = Math.floor(total / 60);
  const m = total % 60;
  const suffix = h24 < 12 ? "a" : "p";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  if (opts.compact && m === 0) return `${h12}${suffix}`;
  return `${h12}:${String(m).padStart(2, "0")}${suffix}`;
}

/** "8:00a–9:15a" (en dash, no spaces). */
export function formatTimeRange(
  startMin: number,
  endMin: number,
  opts: { compact?: boolean } = {},
): string {
  return `${formatTime(startMin, opts)}–${formatTime(endMin, opts)}`;
}

/** "Tu 8:00a–9:15a" — day code + range, for meeting rows. */
export function formatMeeting(day: DayCode, startMin: number, endMin: number): string {
  return `${day} ${formatTimeRange(startMin, endMin)}`;
}

/**
 * ISO date ("2025-10-14") or timestamp → "Oct 14".
 * Pass { year: true } for "Oct 14, 2025".
 */
export function formatDate(iso: string | number | Date, opts: { year?: boolean } = {}): string {
  const d =
    typeof iso === "string"
      ? // Parse date-only strings as local time, not UTC midnight.
        /^\d{4}-\d{2}-\d{2}$/.test(iso)
        ? new Date(`${iso}T00:00:00`)
        : new Date(iso)
      : new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  const s = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return opts.year ? `${s}, ${d.getFullYear()}` : s;
}

/** Hours vs cap → "11/10h". Trims trailing ".0" (7.5 stays "7.5"). */
export function formatHours(used: number, cap: number): string {
  return `${trimNum(used)}/${trimNum(cap)}h`;
}

/** Bare hour count → "7.5h". */
export function formatHourCount(hours: number): string {
  return `${trimNum(hours)}h`;
}

function trimNum(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10);
}

/**
 * "Discussion 0101" shown under a "Discussion" heading -> "0101".
 *
 * Shift descriptions coming from the section importer repeat the duty type,
 * so anywhere the duty type is already on screen the prefix is dead weight —
 * and in a narrow day column it was pushing the section number, the only part
 * that identifies the shift, out of view. Returns the name unchanged when it
 * does not start with the prefix, or when stripping it would leave nothing.
 */
export function shortShiftName(name: string, dutyTypeName: string): string {
  const trimmed = name.trim();
  const prefix = dutyTypeName.trim();
  if (!prefix || trimmed.length <= prefix.length) return trimmed;
  if (trimmed.slice(0, prefix.length).toLowerCase() !== prefix.toLowerCase()) {
    return trimmed;
  }
  const rest = trimmed.slice(prefix.length).replace(/^[\s·:-]+/, "");
  return rest.length > 0 ? rest : trimmed;
}
