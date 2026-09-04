import { describe, expect, it } from "vitest";
import { formatCoverage, formatRange, mergeContinuous } from "./coverageExport";

const b = (day: "M" | "Tu" | "W" | "Th" | "F", startMin: number, endMin: number) => ({
  day,
  startMin,
  endMin,
});

describe("mergeContinuous", () => {
  it("joins blocks that touch", () => {
    expect(mergeContinuous([b("Th", 840, 900), b("Th", 900, 960)])).toEqual([
      b("Th", 840, 960),
    ]);
  });

  it("joins two TAs holding the same hour", () => {
    expect(mergeContinuous([b("M", 600, 720), b("M", 660, 780)])).toEqual([
      b("M", 600, 780),
    ]);
  });

  it("keeps a real gap apart", () => {
    expect(mergeContinuous([b("M", 600, 660), b("M", 720, 780)])).toEqual([
      b("M", 600, 660),
      b("M", 720, 780),
    ]);
  });

  it("orders by weekday then by clock, whatever order it is given", () => {
    expect(
      mergeContinuous([b("F", 600, 660), b("M", 720, 780), b("M", 600, 660)]).map(
        (r) => [r.day, r.startMin],
      ),
    ).toEqual([
      ["M", 600],
      ["M", 720],
      ["F", 600],
    ]);
  });

  it("drops a block with no length", () => {
    expect(mergeContinuous([b("M", 600, 600)])).toEqual([]);
  });
});

describe("formatRange", () => {
  it("says the meridiem once when both ends share it", () => {
    expect(formatRange(840, 900)).toBe("2:00-3:00pm");
    expect(formatRange(735, 825)).toBe("12:15-1:45pm");
  });

  it("says it twice when the range crosses noon", () => {
    expect(formatRange(660, 780)).toBe("11:00am-1:00pm");
  });

  it("calls midnight and noon by their twelves", () => {
    expect(formatRange(0, 60)).toBe("12:00-1:00am");
    expect(formatRange(720, 780)).toBe("12:00-1:00pm");
  });
});

describe("formatCoverage", () => {
  it("writes a section per kind of work", () => {
    expect(
      formatCoverage([
        { name: "Office Hours", blocks: [b("Th", 840, 900), b("Th", 900, 960)] },
        { name: "Discussion", blocks: [b("M", 600, 650)] },
      ]),
    ).toBe("Office Hours:\nTH 2:00-4:00pm\n\nDiscussion:\nM 10:00-10:50am");
  });

  it("leaves out a kind of work nobody is on", () => {
    expect(
      formatCoverage([
        { name: "Office Hours", blocks: [b("M", 600, 660)] },
        { name: "Grading", blocks: [] },
      ]),
    ).toBe("Office Hours:\nM 10:00-11:00am");
  });
});
