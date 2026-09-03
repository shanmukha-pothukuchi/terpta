import { describe, expect, it } from "vitest";
import { solve } from "./solve";
import type { Day, SolveInput, SolverShift, SolverTaProfile } from "./types";

const window = (id: string, day: Day, startMin: number, endMin: number, cap = 1): SolverShift => ({
  id,
  kind: "window",
  dutyTypeId: "oh",
  requiredCount: cap,
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
