import { describe, expect, it } from "vitest";
import { dayOfIso } from "./lib/week";

describe("dayOfIso", () => {
  it("maps weekdays to their day code", () => {
    // 2026-10-05 is a Monday.
    expect(dayOfIso("2026-10-05")).toBe("M");
    expect(dayOfIso("2026-10-06")).toBe("Tu");
    expect(dayOfIso("2026-10-07")).toBe("W");
    expect(dayOfIso("2026-10-08")).toBe("Th");
    expect(dayOfIso("2026-10-09")).toBe("F");
  });

  it("returns null at the weekend", () => {
    expect(dayOfIso("2026-10-10")).toBeNull(); // Saturday
    expect(dayOfIso("2026-10-11")).toBeNull(); // Sunday
  });

  it("returns null for anything that is not an ISO date", () => {
    expect(dayOfIso("")).toBeNull();
    expect(dayOfIso("10/05/2026")).toBeNull();
    expect(dayOfIso("2026-10-05T00:00:00Z")).toBeNull();
  });

  it("does not slip a day west of Greenwich", () => {
    // `new Date("2026-01-01")` is UTC midnight, which is Dec 31 in the US.
    // Parsing the parts by hand keeps this a Thursday everywhere.
    expect(dayOfIso("2026-01-01")).toBe("Th");
  });
});
