import { describe, expect, it } from "vitest";
import { solve } from "./solve";
import type { Day, SolveInput, SolverShift, SolverTaProfile } from "./types";

const window = (
  id: string,
  day: Day,
  startMin: number,
  endMin: number,
  cap = 1,
  /** The fewest TAs that should be on duty at any moment inside it. */
  minCount?: number,
): Extract<SolverShift, { kind: "window" }> => ({
  id,
  kind: "window",
  dutyTypeId: "oh",
  requiredCount: cap,
  ...(minCount !== undefined ? { minCount } : {}),
  day,
  startMin,
  endMin,
  startDate: "2026-08-31",
  endDate: "2026-12-11",
});

const ta = (id: string, extra: Partial<SolverTaProfile> = {}): SolverTaProfile => ({
  id,
  maxHoursPerWeek: 10,
  syncAsyncPreference: 0,
  dutyTypePrefs: [],
  sectionPrefs: [],
  ...extra,
});

const base = (over: Partial<SolveInput>): SolveInput => ({
  shifts: [],
  taProfiles: [],
  availability: [],
  dateExceptions: [],
  lockedAssignments: [],
  windowHoursPerTa: { oh: 2 },
  periodStart: "2026-08-31",
  periodEnd: "2026-12-11",
  ...over,
});

const minutes = (blocks: Array<{ startMin: number; endMin: number }>) =>
  blocks.reduce((n, b) => n + (b.endMin - b.startMin), 0);

describe("office-hour windows", () => {
  it("gives a few_long TA one two-hour block", () => {
    const out = solve(
      base({
        shifts: [window("w-mon", "M", 540, 1020)],
        taProfiles: [ta("a")],
      }),
    );
    expect(out.windowBlocks).toHaveLength(1);
    expect(out.windowBlocks[0]).toMatchObject({ taProfileId: "a", day: "M", startMin: 540, endMin: 660 });
    expect(out.diagnostics.unfilledWindowHours).toEqual([]);
  });

  it("gives a many_short TA hour blocks on different days", () => {
    const out = solve(
      base({
        shifts: [window("w-mon", "M", 540, 1020), window("w-wed", "W", 540, 1020)],
        taProfiles: [ta("a", { officeHoursStyle: "many_short" })],
      }),
    );
    expect(out.windowBlocks.map((b) => [b.day, b.endMin - b.startMin])).toEqual([
      ["M", 60],
      ["W", 60],
    ]);
  });

  it("assumes a TA who painted nothing is free, and respects one who painted", () => {
    const out = solve(
      base({
        shifts: [window("w-mon", "M", 540, 1020)],
        taProfiles: [ta("blank"), ta("painted")],
        availability: [
          // Painted only the last two hours of the window.
          { taProfileId: "painted", day: "M", startMin: 900, endMin: 1020, status: "available" },
        ],
      }),
    );
    const byTa = Object.fromEntries(out.windowBlocks.map((b) => [b.taProfileId, b]));
    expect(byTa.blank).toMatchObject({ startMin: 540, endMin: 660 });
    expect(byTa.painted).toMatchObject({ startMin: 900, endMin: 1020 });
  });

  it("keeps a TA out of their own class time even when they painted nothing", () => {
    const out = solve(
      base({
        shifts: [window("w-mon", "M", 540, 720)],
        taProfiles: [ta("a")],
        availability: [{ taProfileId: "a", day: "M", startMin: 540, endMin: 630, status: "unavailable" }],
      }),
    );
    expect(out.windowBlocks[0]).toMatchObject({ startMin: 630, endMin: 720 });
  });

  it("avoids prefer_not time when a clean slot exists", () => {
    const out = solve(
      base({
        shifts: [window("w-mon", "M", 540, 780)],
        taProfiles: [ta("a")],
        availability: [
          { taProfileId: "a", day: "M", startMin: 540, endMin: 660, status: "prefer_not" },
          { taProfileId: "a", day: "M", startMin: 660, endMin: 780, status: "available" },
        ],
      }),
    );
    expect(out.windowBlocks[0]).toMatchObject({ startMin: 660, endMin: 780 });
  });

  it("does not seat more TAs at once than the window allows", () => {
    const out = solve(
      base({
        shifts: [window("w-mon", "M", 540, 780, 1)], // 4h, one seat
        taProfiles: [ta("a"), ta("b"), ta("c")],
      }),
    );
    // Two 2h blocks fill the single seat; the third TA cannot be placed.
    expect(minutes(out.windowBlocks)).toBe(240);
    expect(out.diagnostics.unfilledWindowHours).toEqual([
      { taProfileId: "c", dutyTypeId: "oh", missingHours: 2 },
    ]);
  });

  it("works around a TA's discussion section", () => {
    const disc: SolverShift = {
      id: "disc",
      kind: "weekly_sync",
      dutyTypeId: "d",
      requiredCount: 1,
      day: "M",
      startMin: 540,
      endMin: 660,
      startDate: "2026-08-31",
      endDate: "2026-12-11",
    };
    const out = solve(
      base({
        shifts: [disc, window("w-mon", "M", 540, 780)],
        taProfiles: [ta("a")],
      }),
    );
    expect(out.assignments).toEqual([{ shiftId: "disc", taProfileId: "a", locked: false }]);
    expect(out.windowBlocks[0]).toMatchObject({ startMin: 660, endMin: 780 });
  });

  it("counts office hours toward the weekly cap", () => {
    const out = solve(
      base({
        shifts: [window("w-mon", "M", 540, 1020)],
        taProfiles: [ta("a", { maxHoursPerWeek: 1.5 })],
      }),
    );
    expect(minutes(out.windowBlocks)).toBe(90);
    expect(out.diagnostics.taLoads[0].weeklyHours).toBe(1.5);
    expect(out.diagnostics.unfilledWindowHours[0]).toMatchObject({ missingHours: 0.5 });
  });

  it("never cuts a block shorter than the minimum", () => {
    const out = solve(
      base({
        shifts: [window("w-mon", "M", 540, 1020), window("w-wed", "W", 540, 1020)],
        // Half-hour office hours are not worth the walk: the default floor
        // turns what used to be four 30-minute blocks into two hours.
        taProfiles: [ta("a", { officeHoursStyle: "many_short" })],
        windowHoursPerTa: { oh: 2 },
        windowMinBlockMin: { oh: 60 },
      }),
    );
    expect(out.windowBlocks.map((b) => b.endMin - b.startMin)).toEqual([60, 60]);
  });

  it("raising the minimum makes longer blocks, not more of them", () => {
    const out = solve(
      base({
        shifts: [window("w-mon", "M", 540, 1020)],
        taProfiles: [ta("a", { officeHoursStyle: "many_short" })],
        windowHoursPerTa: { oh: 3 },
        windowMinBlockMin: { oh: 90 },
      }),
    );
    // "many_short" tops out at an hour, but the floor outranks the style:
    // a 90-minute minimum means 90-minute blocks.
    expect(out.windowBlocks.map((b) => b.endMin - b.startMin)).toEqual([90, 90]);
    expect(out.diagnostics.unfilledWindowHours).toEqual([]);
  });

  it("grows the last block rather than stranding half an hour", () => {
    const out = solve(
      base({
        shifts: [window("w-mon", "M", 540, 1020)],
        taProfiles: [ta("a")],
        windowHoursPerTa: { oh: 2.5 },
        windowMinBlockMin: { oh: 60 },
      }),
    );
    // Two hours placed, then 30 minutes with nowhere legal to go: the block
    // absorbs them instead of the TA being 30 minutes short every week.
    expect(minutes(out.windowBlocks)).toBe(150);
    expect(out.diagnostics.unfilledWindowHours).toEqual([]);
  });

  it("reports the remainder when no block can absorb it", () => {
    const out = solve(
      base({
        // Exactly two hours of window: the 2h block fills it, and the extra
        // half hour has neither room to grow into nor room to stand alone.
        shifts: [window("w-mon", "M", 540, 660)],
        taProfiles: [ta("a")],
        windowHoursPerTa: { oh: 2.5 },
        windowMinBlockMin: { oh: 60 },
      }),
    );
    expect(minutes(out.windowBlocks)).toBe(120);
    expect(out.diagnostics.unfilledWindowHours).toEqual([
      { taProfileId: "a", dutyTypeId: "oh", missingHours: 0.5 },
    ]);
  });

  it("keeps office hours out of a blacked-out hour for everyone", () => {
    const out = solve(
      base({
        shifts: [window("w-mon", "M", 540, 780)],
        taProfiles: [ta("a")],
        // The lecture nobody is staffed on: not a shift, still an hour when
        // office hours are pointless.
        windowBlackouts: { oh: [{ day: "M", startMin: 540, endMin: 660 }] },
      }),
    );
    expect(out.windowBlocks).toHaveLength(1);
    expect(out.windowBlocks[0]).toMatchObject({ startMin: 660, endMin: 780 });
  });

  it("blacks out time for a TA who is not on the clashing shift", () => {
    const out = solve(
      base({
        shifts: [window("w-mon", "M", 540, 900)],
        taProfiles: [ta("a"), ta("b")],
        windowBlackouts: {
          oh: [
            { day: "M", startMin: 540, endMin: 660 },
            { day: "M", startMin: 780, endMin: 900 },
          ],
        },
      }),
    );
    // Only 660-780 is left, and one seat: the second TA goes unplaced rather
    // than being cut into the discussion hour.
    expect(out.windowBlocks).toHaveLength(1);
    expect(out.windowBlocks[0]).toMatchObject({ startMin: 660, endMin: 780 });
    expect(out.diagnostics.unfilledWindowHours).toEqual([
      { taProfileId: "b", dutyTypeId: "oh", missingHours: 2 },
    ]);
  });

  it("serves the TA with one legal slot before the one with thirty", () => {
    const out = solve(
      base({
        shifts: [
          window("w-mon", "M", 600, 720, 1), // exactly one 2h slot
          window("w-tue", "Tu", 600, 960, 1), // room to spare
        ],
        // "a-flex" sorts first and is no busier, so going in order of who is
        // least loaded hands them the Monday slot and leaves "b-tight" — who
        // can be nowhere else — with nothing.
        taProfiles: [ta("a-flex"), ta("b-tight")],
        availability: [
          { taProfileId: "b-tight", day: "M", startMin: 600, endMin: 720, status: "available" },
        ],
      }),
    );
    const byTa = Object.fromEntries(out.windowBlocks.map((b) => [b.taProfileId, b]));
    expect(byTa["b-tight"]).toMatchObject({ day: "M", startMin: 600, endMin: 720 });
    expect(byTa["a-flex"]).toMatchObject({ day: "Tu" });
    expect(out.diagnostics.unfilledWindowHours).toEqual([]);
  });

  it("still favours the lighter TA when both have the same room", () => {
    const disc: SolverShift = {
      id: "disc",
      kind: "weekly_sync",
      dutyTypeId: "d",
      requiredCount: 1,
      day: "Tu",
      startMin: 540,
      endMin: 660,
      startDate: "2026-08-31",
      endDate: "2026-12-11",
    };
    const out = solve(
      base({
        shifts: [disc, window("w-mon", "M", 540, 780, 1)], // one seat, two 2h slots
        taProfiles: [ta("a"), ta("b")],
        lockedAssignments: [{ shiftId: "disc", taProfileId: "a" }],
      }),
    );
    // Both can stand in either slot, so the count does not separate them and
    // the lighter TA takes the first one.
    const byStart = Object.fromEntries(out.windowBlocks.map((b) => [b.startMin, b.taProfileId]));
    expect(byStart).toEqual({ 540: "b", 660: "a" });
  });

  it("spreads two TAs across the week instead of stacking them", () => {
    const out = solve(
      base({
        // Room for both at once all week, so nothing but the spread cost
        // keeps them apart.
        shifts: [window("w-mon", "M", 600, 1020, 2), window("w-tue", "Tu", 600, 1020, 2)],
        taProfiles: [ta("a"), ta("b")],
      }),
    );
    expect(out.windowBlocks).toHaveLength(2);
    const days = out.windowBlocks.map((b) => b.day);
    expect(new Set(days).size).toBe(2);
  });

  it("walks a second block across the day when there is only one day", () => {
    const out = solve(
      base({
        shifts: [window("w-mon", "M", 600, 1020, 2)], // 10a-5p, two seats
        taProfiles: [ta("a"), ta("b")],
      }),
    );
    const spans = out.windowBlocks
      .map((b) => [b.startMin, b.endMin])
      .sort((x, y) => x[0] - y[0]);
    expect(spans).toHaveLength(2);
    // Not stacked, and not butted up against each other either.
    expect(spans[1][0] - spans[0][1]).toBeGreaterThanOrEqual(120);
  });

  it("never gives a TA more hours than they owe, even to cover a window", () => {
    const out = solve(
      base({
        // 3h window that should never be empty, but two TAs owing an hour
        // each. Hours per TA is a ceiling, so an hour of it stays uncovered.
        shifts: [window("w-mon", "M", 600, 780, 1, 1)],
        taProfiles: [ta("a"), ta("b")],
        windowHoursPerTa: { oh: 1 },
        windowMinBlockMin: { oh: 60 },
      }),
    );
    expect(minutes(out.windowBlocks)).toBe(120);
    expect(out.windowBlocks.map((b) => b.endMin - b.startMin)).toEqual([60, 60]);
    expect(new Set(out.windowBlocks.map((b) => b.taProfileId)).size).toBe(2);
  });

  it("leaves the floor unmet rather than breaking a hard rule", () => {
    const out = solve(
      base({
        shifts: [window("w-mon", "M", 600, 780, 1, 1)],
        taProfiles: [ta("a", { maxHoursPerWeek: 1 })],
        windowHoursPerTa: { oh: 1 },
        windowMinBlockMin: { oh: 60 },
      }),
    );
    // One hour is all the cap allows; the rest of the window stays empty.
    expect(minutes(out.windowBlocks)).toBe(60);
  });

  it("puts the hours it does have where the window is emptiest", () => {
    const out = solve(
      base({
        // Five hours to keep covered, two hours to do it with: the two go as
        // far apart as they can rather than sitting next to each other.
        shifts: [window("w-mon", "M", 600, 900, 1, 1)],
        taProfiles: [ta("a"), ta("b")],
        windowHoursPerTa: { oh: 1 },
        windowMinBlockMin: { oh: 60 },
      }),
    );
    expect(minutes(out.windowBlocks)).toBe(120);
    const spans = out.windowBlocks
      .map((b) => [b.startMin, b.endMin])
      .sort((x, y) => x[0] - y[0]);
    expect(spans[1][0] - spans[0][1]).toBeGreaterThanOrEqual(120);
  });

  it("stops short rather than tack a stub hour onto a few-long TA", () => {
    const out = solve(
      base({
        shifts: [window("w-mon", "M", 600, 1020)],
        taProfiles: [ta("a")], // few_long: two-hour blocks
        // Two to three hours: the third only if it comes as a full block.
        windowHoursPerTa: { oh: 3 },
        windowHoursPerTaMin: { oh: 2 },
        windowMinBlockMin: { oh: 60 },
      }),
    );
    expect(out.windowBlocks.map((b) => b.endMin - b.startMin)).toEqual([120]);
    // Two hours is inside the range, so nothing is reported missing.
    expect(out.diagnostics.unfilledWindowHours).toEqual([]);
  });

  it("takes the fuller end of the range when it fits their shape", () => {
    const out = solve(
      base({
        shifts: [window("w-mon", "M", 600, 1020), window("w-tue", "Tu", 600, 1020)],
        taProfiles: [ta("a")],
        windowHoursPerTa: { oh: 4 },
        windowHoursPerTaMin: { oh: 2 },
        windowMinBlockMin: { oh: 60 },
      }),
    );
    // Four hours as two full blocks: optional hours are taken when they come
    // in the shape the TA asked for.
    expect(out.windowBlocks.map((b) => b.endMin - b.startMin)).toEqual([120, 120]);
  });

  it("gives a many-short TA the whole range, stubs and all", () => {
    const out = solve(
      base({
        shifts: [window("w-mon", "M", 600, 1020), window("w-tue", "Tu", 600, 1020)],
        taProfiles: [ta("a", { officeHoursStyle: "many_short" })],
        windowHoursPerTa: { oh: 3 },
        windowHoursPerTaMin: { oh: 2 },
        windowMinBlockMin: { oh: 60 },
      }),
    );
    expect(minutes(out.windowBlocks)).toBe(180);
    expect(out.windowBlocks.every((b) => b.endMin - b.startMin === 60)).toBe(true);
  });

  it("still reports a TA who cannot reach the bottom of the range", () => {
    const out = solve(
      base({
        shifts: [window("w-mon", "M", 600, 660)], // one hour of window, ever
        taProfiles: [ta("a")],
        windowHoursPerTa: { oh: 3 },
        windowHoursPerTaMin: { oh: 2 },
        windowMinBlockMin: { oh: 60 },
      }),
    );
    expect(minutes(out.windowBlocks)).toBe(60);
    expect(out.diagnostics.unfilledWindowHours).toEqual([
      { taProfileId: "a", dutyTypeId: "oh", missingHours: 1 },
    ]);
  });

  it("cuts on the quarter hour, so 12:15 to 1:45 is a block", () => {
    const out = solve(
      base({
        shifts: [window("w-mon", "M", 600, 1020)],
        taProfiles: [ta("a")],
        // The only time offered: 12:15-1:45. On a half-hour grid the best
        // that fitted was 12:30-1:30, clipping a quarter hour off each end.
        availability: [
          { taProfileId: "a", day: "M", startMin: 735, endMin: 825, status: "available" },
        ],
        windowHoursPerTa: { oh: 1.5 },
        windowMinBlockMin: { oh: 60 },
      }),
    );
    expect(out.windowBlocks).toHaveLength(1);
    expect(out.windowBlocks[0]).toMatchObject({ startMin: 735, endMin: 825 });
  });

  it("uses the whole of two quarter-hour windows rather than an hour of each", () => {
    const out = solve(
      base({
        shifts: [window("w-tue", "Tu", 600, 1020), window("w-thu", "Th", 600, 1020)],
        taProfiles: [ta("a")],
        availability: [
          { taProfileId: "a", day: "Tu", startMin: 735, endMin: 825, status: "available" },
          { taProfileId: "a", day: "Th", startMin: 735, endMin: 825, status: "available" },
        ],
        windowHoursPerTa: { oh: 3 },
        windowHoursPerTaMin: { oh: 2 },
        windowMinBlockMin: { oh: 60 },
      }),
    );
    // Ninety minutes on each of the two days she offered, not sixty.
    expect(minutes(out.windowBlocks)).toBe(180);
    expect(out.windowBlocks.map((b) => [b.day, b.startMin, b.endMin])).toEqual([
      ["Tu", 735, 825],
      ["Th", 735, 825],
    ]);
  });

  it("takes the hour a TA asked to keep over the tidier one", () => {
    const out = solve(
      base({
        shifts: [window("w-mon", "M", 600, 1020, 2), window("w-tue", "Tu", 600, 1020, 2)],
        // "b" is free all Monday and would rather not on Tuesday afternoon.
        taProfiles: [ta("a"), ta("b")],
        availability: [
          { taProfileId: "a", day: "M", startMin: 600, endMin: 1020, status: "available" },
          { taProfileId: "b", day: "M", startMin: 600, endMin: 1020, status: "available" },
          { taProfileId: "b", day: "Tu", startMin: 600, endMin: 1020, status: "prefer_not" },
        ],
        windowHoursPerTa: { oh: 2 },
        windowMinBlockMin: { oh: 120 },
      }),
    );
    // Monday is where "a" already is, so spreading would send "b" to
    // Tuesday. Tuesday is time "b" asked to keep, and that outranks it.
    const b = out.windowBlocks.find((x) => x.taProfileId === "b");
    expect(b?.day).toBe("M");
  });

  it("will not spend an hour a TA asked to keep on an hour they do not owe", () => {
    const out = solve(
      base({
        // A window that should never be empty, and a TA who is plainly free
        // for one hour of it and would rather not for another.
        shifts: [window("w-mon", "M", 600, 1080, 1, 1)],
        taProfiles: [ta("a")],
        availability: [
          { taProfileId: "a", day: "M", startMin: 600, endMin: 660, status: "available" },
          { taProfileId: "a", day: "M", startMin: 1020, endMin: 1080, status: "prefer_not" },
        ],
        windowHoursPerTa: { oh: 2 },
        windowHoursPerTaMin: { oh: 1 },
        windowMinBlockMin: { oh: 60 },
      }),
    );
    // The hour they owe, and not the one they asked to keep — the floor does
    // not get to spend it.
    expect(out.windowBlocks.map((b) => [b.startMin, b.endMin])).toEqual([[600, 660]]);
  });

  it("still crosses prefer_not time when that is the only way to what they owe", () => {
    const out = solve(
      base({
        shifts: [window("w-mon", "M", 600, 1080)],
        taProfiles: [ta("a")],
        availability: [
          { taProfileId: "a", day: "M", startMin: 1020, endMin: 1080, status: "prefer_not" },
        ],
        windowHoursPerTa: { oh: 1 },
        windowMinBlockMin: { oh: 60 },
      }),
    );
    expect(out.windowBlocks.map((b) => [b.startMin, b.endMin])).toEqual([[1020, 1080]]);
  });

  it("takes a shorter clean block over a longer one that crosses prefer_not", () => {
    const out = solve(
      base({
        shifts: [window("w-mon", "M", 600, 840)],
        taProfiles: [ta("a")], // few_long: reaches for two hours
        availability: [
          { taProfileId: "a", day: "M", startMin: 600, endMin: 690, status: "available" },
          { taProfileId: "a", day: "M", startMin: 690, endMin: 750, status: "prefer_not" },
        ],
        // An hour and a half is enough, two would be nice.
        windowHoursPerTa: { oh: 2 },
        windowHoursPerTaMin: { oh: 1.5 },
        windowMinBlockMin: { oh: 60 },
      }),
    );
    // The two-hour block exists, and costs half an hour of "not then". The
    // shape they asked for does not outrank the hour they asked to keep.
    expect(out.windowBlocks.map((b) => [b.startMin, b.endMin])).toEqual([[600, 690]]);
  });

  it("keeps a pinned block and builds the rest around it", () => {
    const out = solve(
      base({
        shifts: [window("w-mon", "M", 540, 1020, 1)],
        taProfiles: [ta("a"), ta("b")],
        lockedWindowBlocks: [{ windowShiftId: "w-mon", taProfileId: "b", day: "M", startMin: 540, endMin: 660 }],
      }),
    );
    const b = out.windowBlocks.find((x) => x.taProfileId === "b");
    const a = out.windowBlocks.find((x) => x.taProfileId === "a");
    expect(b).toMatchObject({ startMin: 540, endMin: 660, locked: true });
    expect(a?.startMin).toBeGreaterThanOrEqual(660);
  });

  it("is a no-op without windows", () => {
    const out = solve(base({ taProfiles: [ta("a")] }));
    expect(out.windowBlocks).toEqual([]);
    expect(out.diagnostics.unfilledWindowHours).toEqual([]);
  });
});

describe("per-TA duty cap", () => {
  const disc = (id: string, day: Day, startMin: number): SolverShift => ({
    id,
    kind: "weekly_sync",
    dutyTypeId: "disc",
    requiredCount: 1,
    day,
    startMin,
    endMin: startMin + 50,
    startDate: "2026-08-31",
    endDate: "2026-12-11",
  });

  it("gives a TA at most the capped number of shifts of that duty", () => {
    const out = solve(
      base({
        shifts: [disc("d1", "M", 540), disc("d2", "W", 540)],
        taProfiles: [ta("a")],
        windowHoursPerTa: {},
        maxPerTaByDuty: { disc: 1 },
      }),
    );
    expect(out.assignments).toHaveLength(1);
    expect(out.diagnostics.unfilledShifts).toHaveLength(1);
  });

  it("fills both without a cap", () => {
    const out = solve(
      base({
        shifts: [disc("d1", "M", 540), disc("d2", "W", 540)],
        taProfiles: [ta("a")],
        windowHoursPerTa: {},
      }),
    );
    expect(out.assignments).toHaveLength(2);
  });

  it("does not stop a locked placement over the cap", () => {
    const out = solve(
      base({
        shifts: [disc("d1", "M", 540), disc("d2", "W", 540)],
        taProfiles: [ta("a")],
        windowHoursPerTa: {},
        maxPerTaByDuty: { disc: 1 },
        lockedAssignments: [
          { shiftId: "d1", taProfileId: "a" },
          { shiftId: "d2", taProfileId: "a" },
        ],
      }),
    );
    expect(out.assignments.filter((x) => x.locked)).toHaveLength(2);
  });
});
