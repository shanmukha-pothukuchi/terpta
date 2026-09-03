import { describe, expect, it } from "vitest";
import type { Id } from "../../../../convex/_generated/dataModel";
import {
  awayTaIds,
  buildWeekOverlay,
  coverageDropTarget,
  coverageFor,
  isAwayOnDay,
  type WeekOverlayInput,
} from "./weekOverlay";
import { dateOfDayInWeek } from "../../../lib/week";

const sid = (s: string) => s as Id<"shifts">;
const tid = (s: string) => s as Id<"taProfiles">;
const cid = (s: string) => s as Id<"shiftCoverages">;

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
      _id: cid("cov-1"),
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

describe("coverageDropTarget", () => {
  // The fixture overlay's only coverage is already filled by Ravi; an open one
  // is the case that matters, so build a second overlay with both.
  const withOpen = buildWeekOverlay({
    ...input,
    coverages: [
      ...input.coverages,
      {
        _id: cid("cov-open"),
        shiftRef: sid("shift-disc-0103"),
        date: "2026-09-15",
        day: "Tu",
        absentTaRef: tid("ta-shan"),
        absentName: "Shan",
        coverTaRef: null,
        coverName: null,
      },
    ],
  });
  const drop = (opts: { isMove: boolean }, ta = tid("ta-sree")) =>
    coverageDropTarget(withOpen, sid("shift-disc-0103"), "Tu", ta, opts);

  it("routes a roster drop onto an open hole to the one-off coverage", () => {
    expect(drop({ isMove: false })?._id).toBe("cov-open");
  });

  it("leaves a moved chip as a standing-roster edit", () => {
    expect(drop({ isMove: true })).toBeUndefined();
  });

  it("does not let the absent TA stand in for themselves", () => {
    expect(drop({ isMove: false }, tid("ta-shan"))).toBeUndefined();
  });

  it("ignores a coverage that already has a stand-in", () => {
    expect(
      coverageDropTarget(withOpen, sid("shift-disc-0101"), "M", tid("ta-sree"), {
        isMove: false,
      }),
    ).toBeUndefined();
  });

  it("falls through when the slot has no coverage at all", () => {
    expect(
      coverageDropTarget(withOpen, sid("shift-disc-9999"), "F", tid("ta-sree"), {
        isMove: false,
      }),
    ).toBeUndefined();
  });

  it("falls through with no week selected", () => {
    expect(
      coverageDropTarget(null, sid("shift-disc-0103"), "Tu", tid("ta-sree"), {
        isMove: false,
      }),
    ).toBeUndefined();
  });
});
