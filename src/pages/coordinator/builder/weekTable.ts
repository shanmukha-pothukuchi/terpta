/**
 * The selected week as a Scribble `@tabular`, for pasting into the course site.
 *
 * The course page is written in Scribble, and the staffing table on it was
 * being retyped by hand every time the board changed — which is exactly the
 * kind of copy that goes stale without anybody noticing it has. This renders
 * the same week the Builder is showing as the s-expression that page wants,
 * so keeping the site honest is a copy and a paste.
 *
 * Week-scoped on purpose. The board is a repeating template; a table posted
 * for students should say who is actually coming, so a TA who is away that
 * week drops out and a recorded stand-in takes their place.
 */
import { DAY_CODES, type DayCode } from "../../../lib/format";
import { dateOfDayInWeek, dayOfIso, isDateInRange } from "../../../lib/week";
import { coverageFor, isAwayOnDay, type WeekOverlay } from "./weekOverlay";
import { firstName, type BuilderModel, type ShiftRow } from "./model";

/** One staffed block of the week, already resolved to who is actually coming. */
export interface TableBlock {
  day: DayCode;
  startMin: number;
  endMin: number;
  /** Empty when the shift is on the board but nobody is staffing it. */
  names: string[];
}

/** The hour rows the table spans: `start` inclusive, `end` exclusive. */
export interface HourSpan {
  start: number;
  end: number;
}

/** A 9–5 table when there is nothing to measure, so the panel opens on shape. */
export const DEFAULT_SPAN: HourSpan = { start: 9, end: 17 };

/**
 * How a TA is named in a table students read.
 *
 * First names, the way the course page already writes them — a surname
 * initial is a disambiguator, not a default, and printing "Priya S." when
 * there is only one Priya reads as bureaucratic. Two Priyas on the roster and
 * both get their initial; two Priya S.s and both get their whole names,
 * because a cell that names either of them names neither.
 */
export function firstNameMap(names: Iterable<string>): Map<string, string> {
  const all = [...new Set(names)].filter((n) => n.trim().length > 0);
  const draft = new Map(all.map((n) => [n, firstName(n)]));
  const collisions = (map: Map<string, string>) => {
    const counts = new Map<string, number>();
    for (const short of map.values()) {
      counts.set(short.toLowerCase(), (counts.get(short.toLowerCase()) ?? 0) + 1);
    }
    return counts;
  };

  let counts = collisions(draft);
  for (const [name, short] of draft) {
    if ((counts.get(short.toLowerCase()) ?? 0) > 1) draft.set(name, withInitial(name));
  }
  counts = collisions(draft);
  for (const [name, short] of draft) {
    if ((counts.get(short.toLowerCase()) ?? 0) > 1) draft.set(name, name);
  }
  return draft;
}

/** "Priya Shah" → "Priya S."; a one-word name keeps its one word. */
function withInitial(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return parts[0] ?? name;
  return `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`;
}

/**
 * Who is in the room, for one shift on one day of the selected week.
 *
 * Same rule the board draws by: a TA marked away that date is not coming, a
 * TA a coverage names as absent is not coming, and a recorded stand-in is —
 * even though the assignment still belongs to the person they stand in for.
 */
function namesOn(
  model: BuilderModel,
  week: WeekOverlay | null,
  shift: ShiftRow,
  day: DayCode,
  nameOf: (full: string) => string,
): string[] {
  const coverage = coverageFor(week, shift._id, day);
  const assigned = model.assignmentsByShift.get(shift._id as string) ?? [];
  const names: string[] = [];

  if (coverage?.coverName) names.push(nameOf(coverage.coverName));
  for (const a of assigned) {
    const away =
      (week
        ? isAwayOnDay(week, a.taProfileRef, day, (d) => dateOfDayInWeek(week.weekStart, d))
        : undefined) !== undefined ||
      String(coverage?.absentTaRef ?? "") === String(a.taProfileRef);
    if (away) continue;
    names.push(nameOf(model.taName(a.taProfileRef)));
  }
  return [...new Set(names)];
}

/**
 * Every staffed block of the selected week, weekly shifts and one-off events
 * alike, narrowed to the kinds of work the table is meant to carry.
 *
 * A shift whose term does not reach this week is left out rather than drawn
 * grey: the board greys it because a coordinator is editing a template, but a
 * table on the course page is a claim about one week, and a claim about an
 * hour nobody is holding is simply false.
 */
export function weekTableBlocks(
  model: BuilderModel,
  week: WeekOverlay | null,
  dutyTypeRefs?: ReadonlySet<string>,
): TableBlock[] {
  const carries = (s: ShiftRow) =>
    dutyTypeRefs === undefined || dutyTypeRefs.has(s.dutyTypeRef as string);
  const nameOf = (() => {
    const map = firstNameMap([...model.rosterByTa.values()].map((r) => r.name));
    return (full: string) => map.get(full) ?? firstName(full);
  })();

  const blocks: TableBlock[] = [];
  const add = (shift: ShiftRow, day: DayCode) => {
    if (shift.startMin === undefined || shift.endMin === undefined) return;
    blocks.push({
      day,
      startMin: shift.startMin,
      endMin: shift.endMin,
      names: namesOn(model, week, shift, day, nameOf),
    });
  };

  for (const s of model.weekly) {
    if (!carries(s) || s.day === undefined) continue;
    if (week?.dormantShiftIds.has(s._id as string)) continue;
    add(s, s.day as DayCode);
  }
  // A one-off dated inside this week is part of the week whether or not it
  // repeats; without it a review session or a makeup hour goes unposted.
  for (const s of model.events) {
    if (!carries(s) || s.date === undefined || !week) continue;
    if (!isDateInRange(s.date, week.weekStart, week.weekEnd)) continue;
    const day = dayOfIso(s.date);
    if (day) add(s, day);
  }
  return blocks;
}

/**
 * The hours worth printing, from the blocks themselves.
 *
 * Rounded outward to whole hours because the table's rows are hours: a
 * discussion running 3:30–4:45 belongs to the 3 PM and 4 PM rows both.
 */
export function hourSpan(blocks: readonly TableBlock[]): HourSpan {
  if (blocks.length === 0) return DEFAULT_SPAN;
  let start = 24;
  let end = 0;
  for (const b of blocks) {
    start = Math.min(start, Math.floor(b.startMin / 60));
    end = Math.max(end, Math.ceil(b.endMin / 60));
  }
  return { start, end: Math.max(end, start + 1) };
}

/** "9 AM" / "12 PM" / "1 PM" — the first column, the way the course page writes it. */
export function hourLabel(hour: number): string {
  const h = ((hour % 24) + 24) % 24;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12} ${h < 12 ? "AM" : "PM"}`;
}

/**
 * A row's label at any granularity: "9 AM" on the hour, "9:30 AM" off it.
 *
 * The meridiem is kept on every row rather than only the hour ones, because
 * a reader scanning the column for "1:30" should not have to look upward to
 * find out which half of the day they are in.
 */
export function rowLabel(startMin: number): string {
  const hour = Math.floor(startMin / 60);
  const minute = startMin % 60;
  if (minute === 0) return hourLabel(hour);
  const h = ((hour % 24) + 24) % 24;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(minute).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

/** One row: its label and the five weekday cells, blank where nobody is on. */
export interface TableRow {
  /** Minutes from midnight the row opens at. */
  startMin: number;
  label: string;
  cells: string[];
}

/**
 * `stepMin` is how tall a row is. Hours read best on a course page, but a
 * course cutting office hours on the half hour gets a table that lies at
 * that granularity: a 12:30-1:30 block covers the 12 PM and 1 PM rows both,
 * so the page claims an hour of cover on either side that nobody is holding.
 * Matching the row to the grid the hours were cut on fixes that.
 */
export function tableRows(
  blocks: readonly TableBlock[],
  span: HourSpan,
  stepMin = 60,
): TableRow[] {
  const rows: TableRow[] = [];
  const step = Math.max(5, Math.round(stepMin));
  for (let from = span.start * 60; from < span.end * 60; from += step) {
    const to = from + step;
    const cells = DAY_CODES.map((day) => {
      const names = blocks
        .filter((b) => b.day === day && b.startMin < to && b.endMin > from)
        .flatMap((b) => b.names);
      // Alphabetical, not board order. Board order is the order the blocks
      // happen to start in, which changes between one row and the next: the
      // same two people came out "Tinu, Priyam" at 3:30 and "Priyam, Tinu"
      // at 4, on a page students read down a column of.
      return [...new Set(names)].sort((a, b) => a.localeCompare(b)).join(", ");
    });
    rows.push({ startMin: from, label: rowLabel(from), cells });
  }
  return rows;
}

/** Scribble string literal, with the two characters that can end one escaped. */
function scribbleString(text: string): string {
  return `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * The rows as Scribble source, column-aligned the way the page is written.
 *
 * An hour nobody is on becomes `'cont` across all five days, which is how
 * Scribble spells "this cell continues the one to its left": the time label
 * spans the row instead of trailing five empty boxes. A row with anybody in
 * it keeps real cells, so an empty Tuesday stays visibly empty rather than
 * swallowing Monday's name.
 */
export function scribbleTabular(rows: readonly TableRow[]): string {
  const header = ["@bold{Start Time}", ...DAY_CODES.map((d) => `@bold{${DAY_LONG[d]}}`)];
  const body = rows.map((row) => {
    const blank = row.cells.every((c) => c === "");
    return [
      scribbleString(row.label),
      ...(blank ? row.cells.map(() => "'cont") : row.cells.map(scribbleString)),
    ];
  });

  const all = [header, ...body];
  const widths = header.map((_, col) => Math.max(...all.map((r) => r[col].length)));
  // The time column is right-aligned against the header and set off by two
  // spaces; the day columns are left-aligned one space apart, and the last
  // takes no padding so no line carries trailing whitespace.
  const line = (cells: string[]) =>
    cells
      .map((cell, col) => {
        if (col === 0) return `${cell.padStart(widths[0])}  `;
        if (col === cells.length - 1) return cell;
        return `${cell.padEnd(widths[col])} `;
      })
      .join("");

  const lists = all.map((cells) => `(list ${line(cells)})`);
  return [
    "@tabular[#:style 'boxed",
    "         #:row-properties '(bottom-border ())",
    `     (list ${lists[0]}`,
    ...lists.slice(1, -1).map((l) => `           ${l}`),
    `           ${lists[lists.length - 1]})]`,
  ].join("\n");
}

const DAY_LONG: Record<DayCode, string> = {
  M: "Monday",
  Tu: "Tuesday",
  W: "Wednesday",
  Th: "Thursday",
  F: "Friday",
};

/** Convenience for the panel: blocks → source, in one call. */
export function weekTableSource(
  model: BuilderModel,
  week: WeekOverlay | null,
  span: HourSpan,
  dutyTypeRefs?: ReadonlySet<string>,
): string {
  return scribbleTabular(tableRows(weekTableBlocks(model, week, dutyTypeRefs), span));
}
