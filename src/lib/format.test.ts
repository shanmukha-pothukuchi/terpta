import { describe, expect, it } from "vitest";
import { shortShiftName, termName } from "./format";

describe("termName", () => {
  it("decodes UMD term codes into a season and year", () => {
    expect(termName("202608")).toBe("Fall 2026");
    expect(termName("202701")).toBe("Spring 2027");
    expect(termName("202605")).toBe("Summer 2026");
    expect(termName("202612")).toBe("Winter 2026");
  });

  it("passes anything else through untouched", () => {
    // Already-decoded labels and free text must not be mangled.
    expect(termName("Fall 2026")).toBe("Fall 2026");
    expect(termName("")).toBe("");
    expect(termName("202699")).toBe("202699");
  });
});

describe("shortShiftName", () => {
  it("drops the duty type when the description repeats it", () => {
    expect(shortShiftName("Discussion 0101", "Discussion")).toBe("0101");
  });

  it("leaves a description that does not repeat it alone", () => {
    expect(shortShiftName("Midterm 1 proctoring", "Exam Proctoring")).toBe("Midterm 1 proctoring");
  });
});
