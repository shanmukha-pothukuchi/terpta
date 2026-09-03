import { describe, expect, it } from "vitest";
import { shortShiftName } from "../../lib/format";

describe("shortShiftName", () => {
  it("drops the duty-type word the column heading already says", () => {
    expect(shortShiftName("Discussion 0101", "Discussion")).toBe("0101");
    expect(shortShiftName("Office Hours Tue", "Office Hours")).toBe("Tue");
  });

  it("eats the separator between the prefix and the identifier", () => {
    expect(shortShiftName("Discussion · 0101", "Discussion")).toBe("0101");
    expect(shortShiftName("Discussion - 0101", "Discussion")).toBe("0101");
    expect(shortShiftName("Discussion: 0101", "Discussion")).toBe("0101");
  });

  it("ignores case when matching the prefix", () => {
    expect(shortShiftName("discussion 0101", "Discussion")).toBe("0101");
  });

  it("leaves a name alone when it does not start with the duty type", () => {
    expect(shortShiftName("Lab 0101", "Discussion")).toBe("Lab 0101");
    expect(shortShiftName("0101", "Discussion")).toBe("0101");
  });

  it("keeps the full name rather than rendering nothing", () => {
    expect(shortShiftName("Discussion", "Discussion")).toBe("Discussion");
    expect(shortShiftName("Discussion ", "Discussion")).toBe("Discussion");
  });

  it("handles an empty duty-type name", () => {
    expect(shortShiftName("Discussion 0101", "")).toBe("Discussion 0101");
  });
});
