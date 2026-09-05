import { describe, expect, it } from "vitest";
import {
  buildGridBlocks,
  type ScheduleScope,
  type TeamOccurrence,
  type WeekOccurrence,
} from "./Schedule";

function mine(over: Partial<WeekOccurrence> = {}): WeekOccurrence {
  return {
    key: "occ",
    dutyTypeRef: "dt-oh",
    shiftRef: "sh-oh",
    date: "2026-09-14",
    day: "M",
    startMin: 780,
    endMin: 900,
    title: "Office Hours",
    color: "#7D93B2",
    state: "normal",
    otherName: null,
    note: null,
    swapTarget: null,
    ...over,
  };
}

function theirs(over: Partial<TeamOccurrence> = {}): TeamOccurrence {
  return {
    key: "team",
    shiftRef: "sh-oh",
    dutyTypeRef: "dt-oh",
    date: "2026-09-14",
    day: "M",
    startMin: 780,
    endMin: 900,
    title: "Office Hours",
    color: "#7D93B2",
    taName: "Ravi Patel",
    state: "normal",
    ...over,
  };
}

const build = (m: WeekOccurrence[], t: TeamOccurrence[], scope: ScheduleScope) =>
  buildGridBlocks(m, t, scope);

describe("buildGridBlocks", () => {
  it("names the people on the same meeting, even in the just-me scope", () => {
    const [block] = build([mine()], [theirs(), theirs({ key: "t2", taName: "Aisha Khan" })], "mine");
    expect(block.withNames).toEqual(["Ravi Patel", "Aisha Khan"]);
  });

  it("keeps the team off the grid until the everyone scope is picked", () => {
    expect(build([mine()], [theirs()], "mine")).toHaveLength(1);
    const everyone = build([mine()], [theirs()], "everyone");
    expect(everyone).toHaveLength(2);
    expect(everyone[1]).toMatchObject({
      mine: false,
      title: "Ravi Patel",
      subtitle: "Office Hours",
      swapTarget: null,
    });
  });

  it("matches on the meeting, not merely the shift", () => {
    // Same weekly shift, a different week: nobody is working it with you.
    const [block] = build([mine()], [theirs({ date: "2026-09-21" })], "mine");
    expect(block.withNames).toEqual([]);
  });

  it("does not count a TA who handed that date to somebody else", () => {
    const [block] = build(
      [mine()],
      [theirs({ state: "off" }), theirs({ key: "t2", taName: "Sam Ortiz", state: "covering" })],
      "mine",
    );
    expect(block.withNames).toEqual(["Sam Ortiz"]);
  });

  it("lists nobody as working a meeting you handed off yourself", () => {
    const [block] = build([mine({ state: "off", otherName: "Ravi Patel" })], [theirs()], "mine");
    expect(block.withNames).toEqual([]);
  });

  it("carries your own state and swap target through untouched", () => {
    const swapTarget = { assignmentRef: "a1", label: "Office Hours" };
    const [block] = build([mine({ state: "excepted", note: "Away", swapTarget })], [], "mine");
    expect(block).toMatchObject({ mine: true, state: "excepted", note: "Away", swapTarget });
  });
});
