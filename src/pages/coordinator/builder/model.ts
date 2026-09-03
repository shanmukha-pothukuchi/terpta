/* Shared view-model types + pure derivations for the coordinator Builder.
   All data shapes come straight from the Convex function return types so the
   screen stays in lockstep with the backend. */

import type { FunctionReturnType } from "convex/server";
import type { Id } from "../../../../convex/_generated/dataModel";
import { api } from "../../../../convex/_generated/api";
import { DAY_CODES, DAY_SHORT, type DayCode } from "../../../lib/format";
import { formatTime } from "../../../lib/format";
import { assignLanes, type LaneSpan } from "../../../lib/lanes";

export type ShiftRow = FunctionReturnType<typeof api.shifts.list>[number];
export type DutyType = FunctionReturnType<typeof api.dutyTypes.list>[number];
export type RosterRow = FunctionReturnType<typeof api.roster.list>[number];
export type BoardData = FunctionReturnType<typeof api.builder.board>;
export type BoardAssignment = BoardData["assignments"][number];
export type BoardConflict = BoardData["conflicts"][number];
export type TaDetailData = NonNullable<
  FunctionReturnType<typeof api.builder.taDetail>
>;

/** Diagnostics highlight key. `ta:<id>` highlights one TA everywhere. */
export type Highlight =
  | null
  | "unfilled"
  /** Somebody assigned is away in the selected week and nobody stands in. */
  | "short"
  | "conflict"
  | "over"
  | "under"
  | "zero"
  | `ta:${string}`;

export interface BuilderModel {
  weekly: ShiftRow[];
  events: ShiftRow[]; // recurrence === "once", sorted by date
  asyncShifts: ShiftRow[];
  assignmentsByShift: Map<string, BoardAssignment[]>;
  conflictsByAssignment: Map<string, BoardConflict[]>;
  conflictShiftIds: Set<string>;
  loadByTa: Map<string, { weeklyHours: number; maxHoursPerWeek: number }>;
  overTaIds: Set<string>;
  underTaIds: Set<string>;
  zeroTaIds: Set<string>;
  taName: (id: Id<"taProfiles">) => string;
  rosterByTa: Map<string, RosterRow>;
  dutyById: Map<string, DutyType>;
  sectionById: Map<string, BoardData["sections"][number]>;
  /** Grid window in minutes-from-midnight, snapped to whole hours. */
  gridStartMin: number;
  gridEndMin: number;
}

export function buildModel(
  shifts: ShiftRow[],
  dutyTypes: DutyType[],
  roster: RosterRow[],
  board: BoardData,
): BuilderModel {
  const dutyById = new Map(dutyTypes.map((d) => [d._id as string, d]));
  const sectionById = new Map(board.sections.map((s) => [s._id as string, s]));

  // A window is a range office hours get cut from, not a slot to fill; the
  // blocks cut from it are ordinary weekly shifts and do appear.
  const weekly = shifts
    .filter(
      (s) =>
        s.recurrence === "weekly" &&
        !(dutyById.get(s.dutyTypeRef as string)?.mode === "window" && s.windowRef === undefined),
    )
    .sort((a, b) => (a.startMin ?? 0) - (b.startMin ?? 0));
  const events = shifts
    .filter((s) => s.recurrence === "once")
    .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
  const asyncShifts = shifts.filter((s) => s.recurrence === undefined);

  const assignmentsByShift = new Map<string, BoardAssignment[]>();
  for (const a of board.assignments) {
    const key = a.shiftRef as string;
    const list = assignmentsByShift.get(key);
    if (list) list.push(a);
    else assignmentsByShift.set(key, [a]);
  }

  const conflictsByAssignment = new Map<string, BoardConflict[]>();
  const conflictShiftIds = new Set<string>();
  for (const c of board.conflicts) {
    const key = c.assignmentRef as string;
    const list = conflictsByAssignment.get(key);
    if (list) list.push(c);
    else conflictsByAssignment.set(key, [c]);
    conflictShiftIds.add(c.shiftRef as string);
  }

  const loadByTa = new Map<string, { weeklyHours: number; maxHoursPerWeek: number }>();
  const overTaIds = new Set<string>();
  const underTaIds = new Set<string>();
  for (const l of board.taLoads) {
    loadByTa.set(l.taProfileRef as string, {
      weeklyHours: l.weeklyHours,
      maxHoursPerWeek: l.maxHoursPerWeek,
    });
    if (l.weeklyHours > l.maxHoursPerWeek + 1e-9) overTaIds.add(l.taProfileRef as string);
    else if (l.weeklyHours > 0 && l.weeklyHours < 0.3 * l.maxHoursPerWeek) {
      underTaIds.add(l.taProfileRef as string);
    }
  }

  const assignedTaIds = new Set(board.assignments.map((a) => a.taProfileRef as string));
  const zeroTaIds = new Set(
    roster
      .filter((r) => !assignedTaIds.has(r.taProfileRef as string))
      .map((r) => r.taProfileRef as string),
  );

  const rosterByTa = new Map(roster.map((r) => [r.taProfileRef as string, r]));
  const taName = (id: Id<"taProfiles">) =>
    rosterByTa.get(id as string)?.name ?? "(unknown)";

  // Default window is 8 AM – 9 PM so evening office hours land on the grid
  // instead of off the bottom of it. Real shifts still widen it either way.
  let gridStartMin = 8 * 60;
  let gridEndMin = 21 * 60;
  for (const s of weekly) {
    if (s.startMin !== undefined) {
      gridStartMin = Math.min(gridStartMin, Math.floor(s.startMin / 60) * 60);
    }
    if (s.endMin !== undefined) {
      gridEndMin = Math.max(gridEndMin, Math.ceil(s.endMin / 60) * 60);
    }
  }

  return {
    weekly,
    events,
    asyncShifts,
    assignmentsByShift,
    conflictsByAssignment,
    conflictShiftIds,
    loadByTa,
    overTaIds,
    underTaIds,
    zeroTaIds,
    taName,
    rosterByTa,
    dutyById,
    sectionById,
    gridStartMin,
    gridEndMin,
  };
}

/**
 * Lane placement for every weekly shift, keyed by shift id.
 *
 * Shifts are positioned absolutely inside their day column, so two shifts at
 * the same day+time would paint on top of each other. Cluster each day's
 * shifts by overlap and hand every block a column; a shift with no neighbour
 * gets `{ lane: 0, lanes: 1 }` and still spans the whole day column.
 */
export function weeklyLaneSpans(model: BuilderModel): Map<string, LaneSpan> {
  const spans = new Map<string, LaneSpan>();
  for (const day of DAY_CODES) {
    const items = model.weekly
      .filter((s) => s.day === day)
      .map((s) => {
        const start = s.startMin ?? model.gridStartMin;
        return { id: s._id as string, start, end: s.endMin ?? start + 60 };
      });
    for (const [id, span] of assignLanes(items)) spans.set(id, span);
  }
  return spans;
}

/** First name only — chips read like the board ("Priya", not full names). */
export function firstName(name: string): string {
  return name.split(/\s+/)[0] ?? name;
}

/** "Section 0101" / "Office hours" style label for lists + selects. */
export function shiftLongLabel(model: BuilderModel, shift: ShiftRow): string {
  const section =
    shift.sectionRef !== undefined
      ? model.sectionById.get(shift.sectionRef as string)
      : undefined;
  if (section) return `Section ${section.sectionNumber}`;
  const duty = model.dutyById.get(shift.dutyTypeRef as string);
  return duty?.name ?? shift.description ?? "Shift";
}

/** "Mon/Wed 9:00a" — day list + start time for diagnostics rows. */
export function shiftWhen(shift: ShiftRow): string {
  if (shift.recurrence === "weekly" && shift.day !== undefined) {
    return `${DAY_SHORT[shift.day as DayCode]} ${
      shift.startMin !== undefined ? formatTime(shift.startMin, { compact: true }) : ""
    }`.trim();
  }
  if (shift.recurrence === "once" && shift.date !== undefined) return shift.date;
  return "";
}

/** Room for a section-backed weekly shift, from the matching meeting. */
export function roomOf(model: BuilderModel, shift: ShiftRow): string {
  if (shift.sectionRef === undefined) return "";
  const section = model.sectionById.get(shift.sectionRef as string);
  if (!section) return "";
  const meeting = section.meetings.find(
    (m) =>
      m.day === shift.day &&
      shift.startMin !== undefined &&
      m.startMin === shift.startMin,
  );
  return meeting?.room ?? section.meetings[0]?.room ?? "";
}

/** Availability hint for an unfilled slot, colored per the board. */
export function availabilityHint(
  count: number,
  wide: boolean,
): { text: string; color: string } {
  if (count === 0) return { text: wide ? "no TA free" : "none free", color: "#F4A3AE" };
  if (count === 1) return { text: "only 1 TA free", color: "#F7C566" };
  return {
    text: wide ? `${count} TAs available` : `${count} available`,
    color: "#7FE3B1",
  };
}

export { DAY_CODES };
