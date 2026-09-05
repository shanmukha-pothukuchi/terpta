import { describe, expect, it } from "vitest";
import { describeScope, scopeFromStore, scopeToStore } from "./calendarLinks";

const all = ["oh", "disc", "grade"];
const names: Record<string, string> = { oh: "Office Hours", disc: "Discussion", grade: "Grading" };
const nameOf = (id: string) => names[id];

describe("scopeToStore", () => {
  it("stores nothing when every kind is checked, so later kinds ride along", () => {
    expect(scopeToStore(new Set(all), all)).toBeUndefined();
  });

  it("stores the checked kinds in board order", () => {
    expect(scopeToStore(new Set(["grade", "oh"]), all)).toEqual(["oh", "grade"]);
  });

  it("stores an empty list when nothing is checked, for the form to refuse", () => {
    expect(scopeToStore(new Set(), all)).toEqual([]);
  });

  it("calls an empty board everything, so the link carries what comes", () => {
    expect(scopeToStore(new Set(), [])).toBeUndefined();
  });
});

describe("scopeFromStore", () => {
  it("checks everything for an absent scope", () => {
    expect([...scopeFromStore(undefined, all)]).toEqual(all);
  });

  it("drops a kind that no longer exists", () => {
    expect([...scopeFromStore(["oh", "gone"], all)]).toEqual(["oh"]);
  });
});

describe("describeScope", () => {
  it("says everything for an absent scope", () => {
    expect(describeScope(undefined, nameOf)).toBe("Everything");
  });

  it("names one, two and three kinds like a sentence", () => {
    expect(describeScope(["oh"], nameOf)).toBe("Office Hours");
    expect(describeScope(["oh", "disc"], nameOf)).toBe("Office Hours and Discussion");
    expect(describeScope(["oh", "disc", "grade"], nameOf)).toBe(
      "Office Hours, Discussion and Grading",
    );
  });

  it("says so when a kind has since been removed", () => {
    expect(describeScope(["gone"], nameOf)).toBe("a removed kind of work");
  });
});
