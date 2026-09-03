import { describe, expect, it } from "vitest";
import type { Id } from "../../../../convex/_generated/dataModel";
import {
  awayTaIds,
  buildWeekOverlay,
  coverageFor,
  isAwayOnDay,
  type WeekOverlayInput,
} from "./weekOverlay";
import { dateOfDayInWeek } from "../../../lib/week";

const sid = (s: string) => s as Id<"shifts">;
const tid = (s: string) => s as Id<"taProfiles">;

const input: WeekOverlayInput = {
  weekStart: "2026-09-14",
  weekEnd: "2026-09-20",
  dormantShiftRefs: [sid("shift-dormant")],
  eventShiftRefs: [sid("shift-exam")],
  absences: [
    {
      taProfileRef: tid("ta-priya"),
      name: "Priya Shah",
      reason: "Conference",
      dates: ["2026-09-16", "2026-09-17"],
    },
  ],
  coverages: [
    {
      shiftRef: sid("shift-disc-0101"),
      date: "2026-09-14",
      day: "M",
      absentTaRef: tid("ta-shan"),
      absentName: "Shan",
      coverTaRef: tid("ta-ravi"),
      coverName: "Ravi",
    },
  ],
};

const overlay = buildWeekOverlay(input);

describe("buildWeekOverlay", () => {
  it("indexes shift ids as strings for O(1) lookup", () => {
    expect(overlay.dormantShiftIds.has("shift-dormant")).toBe(true);
    expect(overlay.eventShiftIds.has("shift-exam")).toBe(true);
    expect(overlay.dormantShiftIds.has("shift-exam")).toBe(false);
  });
});

describe("awayTaIds", () => {
  it("lists everyone away for any day of the week", () => {
    expect([...awayTaIds(overlay)]).toEqual(["ta-priya"]);
  });

  it("is empty when no week is selected", () => {
    expect(awayTaIds(null).size).toBe(0);
  });
});

describe("coverageFor", () => {
  it("finds the substitution for a shift on its day", () => {
    expect(coverageFor(overlay, sid("shift-disc-0101"), "M")?.coverName).toBe("Ravi");
  });

  it("does not match a different day", () => {
    expect(coverageFor(overlay, sid("shift-disc-0101"), "Tu")).toBeUndefined();
  });

  it("matches on shift alone when no day is given", () => {
    expect(coverageFor(overlay, sid("shift-disc-0101"))?.absentName).toBe("Shan");
  });

  it("returns nothing without an overlay", () => {
    expect(coverageFor(null, sid("shift-disc-0101"), "M")).toBeUndefined();
  });
});

describe("isAwayOnDay", () => {
  const dateOfDay = (day: "M" | "Tu" | "W" | "Th" | "F") =>
    dateOfDayInWeek("2026-09-14", day);

  it("flags a TA on a day inside their absence", () => {
    // 2026-09-16 is the Wednesday of this week.
    expect(isAwayOnDay(overlay, tid("ta-priya"), "W", dateOfDay)?.reason).toBe(
      "Conference",
    );
    expect(isAwayOnDay(overlay, tid("ta-priya"), "Th", dateOfDay)).toBeTruthy();
  });

  it("does not flag a day outside the absence", () => {
    expect(isAwayOnDay(overlay, tid("ta-priya"), "M", dateOfDay)).toBeUndefined();
    expect(isAwayOnDay(overlay, tid("ta-priya"), "F", dateOfDay)).toBeUndefined();
  });

  it("does not flag a different TA", () => {
    expect(isAwayOnDay(overlay, tid("ta-shan"), "W", dateOfDay)).toBeUndefined();
  });

  it("returns nothing without an overlay or a day", () => {
    expect(isAwayOnDay(null, tid("ta-priya"), "W", dateOfDay)).toBeUndefined();
    expect(isAwayOnDay(overlay, tid("ta-priya"), undefined, dateOfDay)).toBeUndefined();
  });
});
