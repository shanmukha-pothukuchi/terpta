/**
 * What is different about one specific week.
 *
 * The board is a repeating template: these shifts, these people, every week.
 * That is the right default and the wrong thing to publish against, because
 * real weeks have holes in them — a TA away, a one-off event, somebody
 * standing in for a single meeting. This is the thin layer the Builder paints
 * over the template once a week is selected.
 *
 * Kept in its own module (rather than folded into BuilderModel) so the board
 * still renders identically when no week is selected.
 */
import type { Id } from "../../../../convex/_generated/dataModel";
import type { DayCode } from "../../../lib/format";
import { dateOfDayInWeek, isDateInRange } from "../../../lib/week";

export interface WeekAbsence {
  taProfileRef: Id<"taProfiles">;
  name: string;
  reason: string;
  /** The dates inside this week that the TA is away. */
  dates: string[];
}

export interface WeekCoverage {
  _id: Id<"shiftCoverages">;
  shiftRef: Id<"shifts">;
  date: string;
  day: DayCode | null;
  absentTaRef: Id<"taProfiles">;
  absentName: string;
  coverTaRef: Id<"taProfiles"> | null;
  coverName: string | null;
}

export interface WeekOverlay {
  weekStart: string;
  weekEnd: string;
  /** Weekly shifts whose term does not cover this week. */
  dormantShiftIds: Set<string>;
  /** One-off shifts dated inside this week. */
  eventShiftIds: Set<string>;
  absences: WeekAbsence[];
  coverages: WeekCoverage[];
}

/** Raw shape as `api.weeks.builderWeek` returns it. */
export interface WeekOverlayInput {
  weekStart: string;
  weekEnd: string;
  dormantShiftRefs: Id<"shifts">[];
  eventShiftRefs: Id<"shifts">[];
  absences: WeekAbsence[];
  coverages: WeekCoverage[];
}

export function buildWeekOverlay(input: WeekOverlayInput): WeekOverlay {
  return {
    weekStart: input.weekStart,
    weekEnd: input.weekEnd,
    dormantShiftIds: new Set(input.dormantShiftRefs.map(String)),
    eventShiftIds: new Set(input.eventShiftRefs.map(String)),
    absences: input.absences,
    coverages: input.coverages,
  };
}

/** Every TA away for at least one day of the week, by profile id. */
export function awayTaIds(overlay: WeekOverlay | null): Set<string> {
  if (!overlay) return new Set();
  return new Set(overlay.absences.map((a) => String(a.taProfileRef)));
}

/**
 * Substitution for one shift on one weekday, if there is one.
 *
 * Weekly shifts occur once per week, so a day code is enough to find the
 * coverage without the caller having to work out the date itself.
 */
export function coverageFor(
  overlay: WeekOverlay | null,
  shiftRef: Id<"shifts"> | string,
  day?: DayCode,
): WeekCoverage | undefined {
  if (!overlay) return undefined;
  const id = String(shiftRef);
  return overlay.coverages.find(
    (c) => String(c.shiftRef) === id && (day === undefined || c.day === day),
  );
}

/**
 * The one-off hole a drop should fill, or undefined to fall through to the
 * standing roster.
 *
 * Dropping a name from the roster onto a slot that is short for one meeting
 * means "stand in that day" — not "join this shift every week for the rest of
 * term". Everything else keeps the meaning it had: moving an existing chip is
 * a standing-roster edit and turning it into a one-date stand-in would strand
 * the TA's other shift; a slot with no open coverage has no one-off hole to
 * fill; a coverage already filled is not open; and the TA who is out cannot
 * stand in for themselves.
 */
export function coverageDropTarget(
  overlay: WeekOverlay | null,
  shiftRef: Id<"shifts"> | string,
  day: DayCode | undefined,
  taProfileRef: Id<"taProfiles"> | string,
  opts: { isMove: boolean },
): WeekCoverage | undefined {
  if (opts.isMove) return undefined;
  const coverage = coverageFor(overlay, shiftRef, day);
  if (!coverage || coverage.coverTaRef !== null) return undefined;
  if (String(coverage.absentTaRef) === String(taProfileRef)) return undefined;
  return coverage;
}

/** A seat whose holder is away on the date, with no record of a stand-in yet. */
export interface AwayHole {
  absentTaRef: Id<"taProfiles"> | string;
  date: string;
}

/**
 * The seat on a shift that is empty this week because its holder marked the
 * date as an exception, and nobody has been recorded as standing in.
 *
 * Distinct from an open coverage: a coverage is a hole the coordinator (or an
 * approved swap) already wrote down; this is one the TA's own calendar made,
 * which no record exists for yet.
 */
export function awayHole(
  overlay: WeekOverlay | null,
  shift: SeatShift,
  assignments: Array<{ taProfileRef: Id<"taProfiles"> | string }>,
): AwayHole | undefined {
  const seats = weekSeats(overlay, shift, assignments);
  if (!seats.date) return undefined;
  const date = seats.date;
  const recorded = new Set(
    (overlay?.coverages ?? [])
      .filter((c) => String(c.shiftRef) === String(shift._id) && c.date === date)
      .map((c) => String(c.absentTaRef)),
  );
  const hole = seats.away.find(
    (a) => a.reason !== null && !recorded.has(String(a.taProfileRef)),
  );
  return hole ? { absentTaRef: hole.taProfileRef, date } : undefined;
}

/**
 * The away seat a drop should stand in for, or undefined to fall through.
 *
 * Same reasoning as {@link coverageDropTarget}: a name from the roster onto a
 * slot whose holder is away that day means "stand in that day". Before this,
 * such a drop fell through to the standing roster and put the TA on the shift
 * every week — the one thing the coordinator was not asking for. Moving an
 * existing chip still edits the roster, and a TA already on the shift (the
 * away one included) has no seat to stand in for.
 */
export function awayDropTarget(
  overlay: WeekOverlay | null,
  shift: SeatShift,
  assignments: Array<{ taProfileRef: Id<"taProfiles"> | string }>,
  taProfileRef: Id<"taProfiles"> | string,
  opts: { isMove: boolean },
): AwayHole | undefined {
  if (opts.isMove) return undefined;
  const id = String(taProfileRef);
  if (assignments.some((a) => String(a.taProfileRef) === id)) return undefined;
  return awayHole(overlay, shift, assignments);
}

/**
 * Is this TA away on the day this shift meets?
 *
 * Distinct from {@link coverageFor}: an absence the coordinator has not acted
 * on yet leaves the assignment in place, which is exactly the case worth
 * flagging on the board before publishing.
 */
export function isAwayOnDay(
  overlay: WeekOverlay | null,
  taProfileRef: Id<"taProfiles"> | string,
  day: DayCode | undefined,
  dateOfDay: (day: DayCode) => string,
): WeekAbsence | undefined {
  if (!overlay || !day) return undefined;
  const id = String(taProfileRef);
  const date = dateOfDay(day);
  return overlay.absences.find(
    (a) => String(a.taProfileRef) === id && a.dates.includes(date),
  );
}

/** The little the week logic needs to know about a shift. */
export interface SeatShift {
  _id: Id<"shifts"> | string;
  recurrence?: "weekly" | "once";
  day?: DayCode;
  date?: string;
  requiredCount: number;
}

/** What one shift looks like on its date in the selected week. */
export interface WeekSeats {
  /** The date it meets this week, or null if it does not. */
  date: string | null;
  /** Assignees who are away that day. */
  away: Array<{ taProfileRef: string; reason: string | null }>;
  /** Assignees who are coming. */
  present: number;
  /** A recorded stand-in, by profile id, if any. */
  coverTaRef: string | null;
  /** Seats with nobody in them on the day: required minus present minus cover. */
  short: number;
}

/**
 * Who is actually in the room for a shift on its date this week.
 *
 * The board and the diagnostics used to answer this differently: the board
 * from the overlay, the panel from the standing roster, which cannot know
 * that the only TA on Tuesday is away. A slot could be dashed red while the
 * panel counted it as fine. One function, both callers.
 */
export function weekSeats(
  overlay: WeekOverlay | null,
  shift: SeatShift,
  assignments: Array<{ taProfileRef: Id<"taProfiles"> | string }>,
): WeekSeats {
  const none: WeekSeats = {
    date: null,
    away: [],
    present: assignments.length,
    coverTaRef: null,
    short: 0,
  };
  if (!overlay) return none;
  let date: string | null = null;
  if (shift.recurrence === "weekly" && shift.day) {
    if (overlay.dormantShiftIds.has(String(shift._id))) return none;
    date = dateOfDayInWeek(overlay.weekStart, shift.day);
  } else if (shift.recurrence === "once" && shift.date) {
    if (!isDateInRange(shift.date, overlay.weekStart, overlay.weekEnd)) return none;
    date = shift.date;
  }
  if (!date) return none;

  const coverage = overlay.coverages.find(
    (c) => String(c.shiftRef) === String(shift._id) && c.date === date,
  );
  const away: WeekSeats["away"] = [];
  for (const a of assignments) {
    const id = String(a.taProfileRef);
    const absence = overlay.absences.find(
      (x) => String(x.taProfileRef) === id && x.dates.includes(date),
    );
    if (absence) away.push({ taProfileRef: id, reason: absence.reason });
    else if (coverage && String(coverage.absentTaRef) === id) {
      away.push({ taProfileRef: id, reason: null });
    }
  }
  const present = assignments.length - away.length;
  const coverTaRef = coverage?.coverTaRef ? String(coverage.coverTaRef) : null;
  const short = Math.max(0, shift.requiredCount - present - (coverTaRef ? 1 : 0));
  return { date, away, present, coverTaRef, short };
}
