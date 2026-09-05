import { describe, expect, it } from "vitest";
import {
  addDaysIso,
  dateOfDayInWeek,
  nextDateOfDay,
  dayOfIso,
  isDateInRange,
  mondayOf,
  rangesOverlap,
  relativeWeekLabel,
  weeklyShiftRunsInWeek,
  weekLabel,
  weekRange,
} from "./week";

describe("mondayOf", () => {
  it("returns the Monday of the containing week", () => {
    // 2026-09-14 is a Monday.
    expect(mondayOf("2026-09-14")).toBe("2026-09-14");
    expect(mondayOf("2026-09-16")).toBe("2026-09-14");
    expect(mondayOf("2026-09-18")).toBe("2026-09-14");
    expect(mondayOf("2026-09-19")).toBe("2026-09-14"); // Saturday
  });

  it("puts Sunday in the week that just ended, not the one starting", () => {
    expect(mondayOf("2026-09-20")).toBe("2026-09-14");
    expect(mondayOf("2026-09-21")).toBe("2026-09-21");
  });

  it("crosses month and year boundaries", () => {
    expect(mondayOf("2026-01-01")).toBe("2025-12-29");
    expect(mondayOf("2026-03-01")).toBe("2026-02-23");
  });
});

describe("addDaysIso", () => {
  it("crosses months, years and DST without slipping a day", () => {
    expect(addDaysIso("2026-09-14", 6)).toBe("2026-09-20");
    expect(addDaysIso("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDaysIso("2026-01-01", -1)).toBe("2025-12-31");
    // US DST ends 2026-11-01; a +1 here must still be Nov 2, not Nov 1 again.
    expect(addDaysIso("2026-11-01", 1)).toBe("2026-11-02");
  });
});

describe("dayOfIso", () => {
  it("maps weekdays and rejects the weekend", () => {
    expect(dayOfIso("2026-09-14")).toBe("M");
    expect(dayOfIso("2026-09-18")).toBe("F");
    expect(dayOfIso("2026-09-19")).toBeNull();
    expect(dayOfIso("2026-09-20")).toBeNull();
  });

  it("returns null for anything that is not an ISO date", () => {
    expect(dayOfIso("09/14/2026")).toBeNull();
    expect(dayOfIso("2026-09-14T00:00:00Z")).toBeNull();
  });
});

describe("weekRange", () => {
  it("spans Monday to Sunday but lists only weekdays", () => {
    const w = weekRange("2026-09-14");
    expect(w.start).toBe("2026-09-14");
    // Sunday, so `date <= end` contains a Saturday one-off too.
    expect(w.end).toBe("2026-09-20");
    expect(w.days).toEqual([
      { day: "M", date: "2026-09-14" },
      { day: "Tu", date: "2026-09-15" },
      { day: "W", date: "2026-09-16" },
      { day: "Th", date: "2026-09-17" },
      { day: "F", date: "2026-09-18" },
    ]);
  });
});

describe("dateOfDayInWeek", () => {
  it("places a weekday code onto its date in that week", () => {
    expect(dateOfDayInWeek("2026-09-14", "M")).toBe("2026-09-14");
    expect(dateOfDayInWeek("2026-09-14", "Th")).toBe("2026-09-17");
  });
});

describe("range helpers", () => {
  it("treats both ends as inclusive", () => {
    expect(isDateInRange("2026-09-14", "2026-09-14", "2026-09-18")).toBe(true);
    expect(isDateInRange("2026-09-18", "2026-09-14", "2026-09-18")).toBe(true);
    expect(isDateInRange("2026-09-19", "2026-09-14", "2026-09-18")).toBe(false);
  });

  it("counts a single shared day as an overlap", () => {
    expect(rangesOverlap("2026-09-14", "2026-09-18", "2026-09-18", "2026-09-25")).toBe(true);
    expect(rangesOverlap("2026-09-14", "2026-09-17", "2026-09-18", "2026-09-25")).toBe(false);
  });
});

describe("weeklyShiftRunsInWeek", () => {
  const week = weekRange("2026-09-14");

  it("includes a shift with no bounds at all", () => {
    expect(weeklyShiftRunsInWeek({}, week)).toBe(true);
  });

  it("excludes a shift whose term ended before the week", () => {
    expect(
      weeklyShiftRunsInWeek({ startDate: "2026-08-31", endDate: "2026-09-11" }, week),
    ).toBe(false);
  });

  it("excludes a shift whose term starts after the week", () => {
    expect(weeklyShiftRunsInWeek({ startDate: "2026-09-21" }, week)).toBe(false);
  });

  it("includes a shift that starts mid-week", () => {
    expect(weeklyShiftRunsInWeek({ startDate: "2026-09-16" }, week)).toBe(true);
  });
});

describe("labels", () => {
  it("collapses the month when the week does not cross one", () => {
    expect(weekLabel("2026-09-14")).toBe("Sep 14 – 18");
  });

  it("names both months when it does", () => {
    expect(weekLabel("2026-09-28")).toBe("Sep 28 – Oct 2");
  });

  it("describes a week relative to the current one", () => {
    const from = "2026-09-14";
    expect(relativeWeekLabel("2026-09-14", from)).toBe("this week");
    expect(relativeWeekLabel("2026-09-21", from)).toBe("next week");
    expect(relativeWeekLabel("2026-09-07", from)).toBe("last week");
    expect(relativeWeekLabel("2026-10-05", from)).toBe("in 3 weeks");
    expect(relativeWeekLabel("2026-08-24", from)).toBe("3 weeks ago");
  });
});

describe("nextDateOfDay", () => {
  // 2026-09-16 is a Wednesday.
  it("is today when today is that day", () => {
    expect(nextDateOfDay("W", "2026-09-16")).toBe("2026-09-16");
  });

  it("is later this week when the day is still ahead", () => {
    expect(nextDateOfDay("F", "2026-09-16")).toBe("2026-09-18");
  });

  it("rolls to next week once the day has passed", () => {
    expect(nextDateOfDay("M", "2026-09-16")).toBe("2026-09-21");
  });
});
