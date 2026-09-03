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

export interface WeekAbsence {
  taProfileRef: Id<"taProfiles">;
  name: string;
  reason: string;
  /** The dates inside this week that the TA is away. */
  dates: string[];
}

export interface WeekCoverage {
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
