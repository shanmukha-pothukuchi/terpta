import { describe, expect, it } from "vitest";
import { mulberry32, solve } from "./solve";
import type {
  Day,
  SolveInput,
  SolverAvailabilityBlock,
  SolverShift,
  SolverTaProfile,
} from "./types";

const DAYS: Day[] = ["M", "Tu", "W", "Th", "F"];

function ta(id: string, overrides: Partial<SolverTaProfile> = {}): SolverTaProfile {
  return {
    id,
    maxHoursPerWeek: 10,
    syncAsyncPreference: 0.5,
    dutyTypePrefs: [],
    sectionPrefs: [],
    ...overrides,
  };
}

function baseInput(overrides: Partial<SolveInput> = {}): SolveInput {
  return {
    shifts: [],
    taProfiles: [],
    availability: [],
    dateExceptions: [],
    lockedAssignments: [],
    periodStart: "2026-02-02", // a Monday
    periodEnd: "2026-02-27",
    ...overrides,
  };
}

/** Assert no non-locked assignment violates a hard constraint. */
function assertHardConstraints(input: SolveInput, out: ReturnType<typeof solve>) {
  const shiftById = new Map(input.shifts.map((s) => [s.id, s]));
  const byTa = new Map<string, SolverShift[]>();
  const violatingLocked = new Set(
    out.diagnostics.hardViolations.map((v) => `${v.shiftId}|${v.taProfileId}`),
  );
  for (const a of out.assignments) {
    if (a.locked && violatingLocked.has(`${a.shiftId}|${a.taProfileId}`)) continue;
    const s = shiftById.get(a.shiftId)!;
    if (s.kind === "async") continue;
    // unavailable blocks
    for (const b of input.availability) {
      if (b.taProfileId !== a.taProfileId || b.status !== "unavailable") continue;
      if (b.day === s.day && b.startMin < s.endMin && s.startMin < b.endMin) {
        throw new Error(`assignment ${a.shiftId}/${a.taProfileId} overlaps unavailable block`);
      }
    }
    // date exceptions for once shifts
    if (s.kind === "once_sync") {
      for (const ex of input.dateExceptions) {
        if (
          ex.taProfileId === a.taProfileId &&
          ex.startDate <= s.date &&
          s.date <= ex.endDate
        ) {
          throw new Error(`once shift ${s.id} assigned to ${a.taProfileId} despite exception`);
        }
      }
    }
    const list = byTa.get(a.taProfileId) ?? [];
    list.push(s);
    byTa.set(a.taProfileId, list);
  }
  // pairwise sync overlaps
  for (const shifts of byTa.values()) {
    for (let i = 0; i < shifts.length; i++) {
      for (let j = i + 1; j < shifts.length; j++) {
        const a = shifts[i] as Extract<SolverShift, { kind: "weekly_sync" | "once_sync" }>;
        const b = shifts[j] as Extract<SolverShift, { kind: "weekly_sync" | "once_sync" }>;
        const timeOv = a.startMin < b.endMin && b.startMin < a.endMin;
        if (!timeOv) continue;
        let conflict = false;
        if (a.kind === "weekly_sync" && b.kind === "weekly_sync") conflict = a.day === b.day;
        else if (a.kind === "once_sync" && b.kind === "once_sync") conflict = a.date === b.date;
        else {
          const once = (a.kind === "once_sync" ? a : b) as Extract<SolverShift, { kind: "once_sync" }>;
          const weekly = (a.kind === "weekly_sync" ? a : b) as Extract<SolverShift, { kind: "weekly_sync" }>;
          conflict =
            once.day === weekly.day &&
            weekly.startDate <= once.date &&
            once.date <= weekly.endDate;
        }
        if (conflict) throw new Error(`overlapping sync assignments ${a.id}/${b.id}`);
      }
    }
  }
}

describe("solve", () => {
  it("fully fills a feasible case", () => {
    const input = baseInput({
      taProfiles: [ta("ta-a"), ta("ta-b")],
      shifts: [
        {
          id: "w1", kind: "weekly_sync", dutyTypeId: "office", requiredCount: 1,
          day: "M", startMin: 600, endMin: 660,
          startDate: "2026-02-02", endDate: "2026-02-27",
        },
        {
          id: "w2", kind: "weekly_sync", dutyTypeId: "lab", requiredCount: 2,
          day: "Tu", startMin: 600, endMin: 720,
          startDate: "2026-02-02", endDate: "2026-02-27",
        },
        {
          id: "o1", kind: "once_sync", dutyTypeId: "exam", requiredCount: 1,
          date: "2026-02-11", day: "W", startMin: 600, endMin: 660,
        },
        { id: "as1", kind: "async", dutyTypeId: "grading", requiredCount: 2, hoursRequired: 4, dueDate: "2026-02-20" },
      ],
    });
    const out = solve(input);
    expect(out.diagnostics.unfilledShifts).toEqual([]);
    expect(out.diagnostics.hardViolations).toEqual([]);
    expect(out.assignments.filter((a) => a.shiftId === "w2")).toHaveLength(2);
    const asyncTotal = out.assignments
      .filter((a) => a.shiftId === "as1")
      .reduce((s, a) => s + (a.hoursAllocated ?? 0), 0);
    expect(asyncTotal).toBeCloseTo(4, 6);
    assertHardConstraints(input, out);
  });

  it("reports unfilled shifts without violating hard constraints when infeasible", () => {
    const input = baseInput({
      taProfiles: [ta("ta-a")],
      availability: [
        { taProfileId: "ta-a", day: "M", startMin: 0, endMin: 1440, status: "unavailable" },
      ],
      shifts: [
        {
          id: "w1", kind: "weekly_sync", dutyTypeId: "office", requiredCount: 1,
          day: "M", startMin: 600, endMin: 660,
          startDate: "2026-02-02", endDate: "2026-02-27",
        },
      ],
    });
    const out = solve(input);
    expect(out.assignments).toEqual([]);
    expect(out.diagnostics.unfilledShifts).toEqual([{ shiftId: "w1", missing: 1 }]);
    expect(out.diagnostics.hardViolations).toEqual([]);
    expect(out.diagnostics.zeroAssignmentTaIds).toEqual(["ta-a"]);
    assertHardConstraints(input, out);
  });

  it("gives a section-ranked TA the shift over an indifferent equal", () => {
    const input = baseInput({
      taProfiles: [
        ta("ta-b"), // indifferent, listed first on purpose
        ta("ta-a", { sectionPrefs: ["sec-1"] }),
      ],
      shifts: [
        {
          id: "w1", kind: "weekly_sync", dutyTypeId: "office", sectionId: "sec-1",
          requiredCount: 1, day: "M", startMin: 600, endMin: 660,
          startDate: "2026-02-02", endDate: "2026-02-27",
        },
      ],
    });
    const out = solve(input);
    expect(out.assignments).toEqual([
      { shiftId: "w1", taProfileId: "ta-a", locked: false },
    ]);
  });

  it("preserves locked assignments across regenerate", () => {
    const input = baseInput({
      taProfiles: [ta("ta-a", { sectionPrefs: ["sec-1"] }), ta("ta-b")],
      shifts: [
        {
          id: "w1", kind: "weekly_sync", dutyTypeId: "office", sectionId: "sec-1",
          requiredCount: 1, day: "M", startMin: 600, endMin: 660,
          startDate: "2026-02-02", endDate: "2026-02-27",
        },
      ],
      // ta-b is locked even though ta-a is the preferred pick
      lockedAssignments: [{ shiftId: "w1", taProfileId: "ta-b" }],
    });
    const out1 = solve(input);
    const out2 = solve(input); // regenerate
    for (const out of [out1, out2]) {
      expect(out.assignments).toEqual([
        { shiftId: "w1", taProfileId: "ta-b", locked: true },
      ]);
      expect(out.diagnostics.hardViolations).toEqual([]);
    }
  });

  it("blocks a once shift for a TA whose date exception covers the date", () => {
    const shifts: SolverShift[] = [
      {
        id: "o1", kind: "once_sync", dutyTypeId: "exam", requiredCount: 1,
        date: "2026-02-11", day: "W", startMin: 600, endMin: 660,
      },
    ];
    // Only TA has a covering exception -> unfilled
    const solo = solve(
      baseInput({
        taProfiles: [ta("ta-a")],
        dateExceptions: [
          { taProfileId: "ta-a", startDate: "2026-02-09", endDate: "2026-02-13" },
        ],
        shifts,
      }),
    );
    expect(solo.assignments).toEqual([]);
    expect(solo.diagnostics.unfilledShifts).toEqual([{ shiftId: "o1", missing: 1 }]);

    // A second TA without a covering exception gets it instead
    const duo = solve(
      baseInput({
        taProfiles: [ta("ta-a"), ta("ta-b")],
        dateExceptions: [
          { taProfileId: "ta-a", startDate: "2026-02-09", endDate: "2026-02-13" },
          { taProfileId: "ta-b", startDate: "2026-02-16", endDate: "2026-02-17" },
        ],
        shifts,
      }),
    );
    expect(duo.assignments).toEqual([
      { shiftId: "o1", taProfileId: "ta-b", locked: false },
    ]);
  });

  it("splits a 6h async duty across 3 TAs summing to 6", () => {
    const input = baseInput({
      periodStart: "2026-02-02",
      periodEnd: "2026-02-06", // 1 week
      taProfiles: [
        ta("ta-x", { maxHoursPerWeek: 2 }),
        ta("ta-y", { maxHoursPerWeek: 2 }),
        ta("ta-z", { maxHoursPerWeek: 2 }),
      ],
      shifts: [
        { id: "as1", kind: "async", dutyTypeId: "grading", requiredCount: 3, hoursRequired: 6, dueDate: "2026-02-06" },
      ],
    });
    const out = solve(input);
    const allocs = out.assignments.filter((a) => a.shiftId === "as1");
    expect(allocs).toHaveLength(3);
    expect(new Set(allocs.map((a) => a.taProfileId)).size).toBe(3);
    for (const a of allocs) expect(a.hoursAllocated!).toBeGreaterThan(0);
    const total = allocs.reduce((s, a) => s + (a.hoursAllocated ?? 0), 0);
    expect(total).toBeCloseTo(6, 6);
    expect(out.diagnostics.unfilledShifts).toEqual([]);
  });

  it("reports hard violations for conflicting locked assignments but keeps them", () => {
    const input = baseInput({
      taProfiles: [ta("ta-a")],
      shifts: [
        {
          id: "w1", kind: "weekly_sync", dutyTypeId: "office", requiredCount: 1,
          day: "M", startMin: 600, endMin: 720,
          startDate: "2026-02-02", endDate: "2026-02-27",
        },
        {
          id: "w2", kind: "weekly_sync", dutyTypeId: "lab", requiredCount: 1,
          day: "M", startMin: 660, endMin: 780,
          startDate: "2026-02-02", endDate: "2026-02-27",
        },
      ],
      lockedAssignments: [
        { shiftId: "w1", taProfileId: "ta-a" },
        { shiftId: "w2", taProfileId: "ta-a" },
      ],
    });
    const out = solve(input);
    expect(out.assignments).toEqual([
      { shiftId: "w1", taProfileId: "ta-a", locked: true },
      { shiftId: "w2", taProfileId: "ta-a", locked: true },
    ]);
    expect(out.diagnostics.hardViolations.length).toBeGreaterThan(0);
    expect(out.diagnostics.hardViolations[0].taProfileId).toBe("ta-a");
  });

  it("is deterministic: two runs are byte-identical", () => {
    const input = generateFixture(12, 20, 7);
    const a = solve(input);
    const b = solve(input);
    expect(a).toEqual(b);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("solves 40 TAs x 80 shifts in under 2000ms", () => {
    const input = generateFixture(40, 80, 99);
    const t0 = performance.now();
    const out = solve(input);
    const elapsed = performance.now() - t0;
    expect(elapsed).toBeLessThan(2000);
    expect(out.assignments.length).toBeGreaterThan(0);
    assertHardConstraints(input, out);
  });
});

// ---------------------------------------------------------------------------
// Fixture generator (seeded, deterministic)
// ---------------------------------------------------------------------------

function generateFixture(numTas: number, numShifts: number, seed: number): SolveInput {
  const rnd = mulberry32(seed);
  const dutyTypes = ["d0", "d1", "d2", "d3", "d4"];
  const sections = Array.from({ length: 10 }, (_, i) => `sec-${i}`);
  const pick = <T,>(arr: T[]) => arr[Math.floor(rnd() * arr.length)];

  const taProfiles: SolverTaProfile[] = [];
  const availability: SolverAvailabilityBlock[] = [];
  for (let i = 0; i < numTas; i++) {
    const id = `ta-${String(i).padStart(2, "0")}`;
    taProfiles.push({
      id,
      maxHoursPerWeek: 8 + Math.floor(rnd() * 5),
      syncAsyncPreference: rnd(),
      dutyTypePrefs: [...dutyTypes].sort(() => rnd() - 0.5).slice(0, 3),
      sectionPrefs: [...sections].sort(() => rnd() - 0.5).slice(0, 4),
    });
    // a couple of unavailable / prefer_not blocks per TA
    for (let b = 0; b < 3; b++) {
      const start = 480 + Math.floor(rnd() * 8) * 60;
      availability.push({
        taProfileId: id,
        day: pick(DAYS),
        startMin: start,
        endMin: start + 120,
        status: rnd() < 0.6 ? "unavailable" : "prefer_not",
      });
    }
  }

  const onceDates = ["2026-02-04", "2026-02-11", "2026-02-18", "2026-02-25"];
  const onceDay: Day = "W"; // all once dates above are Wednesdays
  const shifts: SolverShift[] = [];
  for (let i = 0; i < numShifts; i++) {
    const id = `sh-${String(i).padStart(2, "0")}`;
    const r = rnd();
    if (r < 0.7) {
      const start = 480 + Math.floor(rnd() * 9) * 60;
      shifts.push({
        id, kind: "weekly_sync", dutyTypeId: pick(dutyTypes),
        sectionId: rnd() < 0.7 ? pick(sections) : undefined,
        requiredCount: 1 + Math.floor(rnd() * 3),
        day: pick(DAYS), startMin: start, endMin: start + 60 + Math.floor(rnd() * 2) * 30,
        startDate: "2026-02-02", endDate: "2026-02-27",
      });
    } else if (r < 0.85) {
      const start = 480 + Math.floor(rnd() * 9) * 60;
      shifts.push({
        id, kind: "once_sync", dutyTypeId: pick(dutyTypes),
        sectionId: rnd() < 0.5 ? pick(sections) : undefined,
        requiredCount: 1 + Math.floor(rnd() * 2),
        date: pick(onceDates), day: onceDay,
        startMin: start, endMin: start + 90,
      });
    } else {
      shifts.push({
        id, kind: "async", dutyTypeId: pick(dutyTypes),
        requiredCount: 2 + Math.floor(rnd() * 3),
        hoursRequired: 2 + Math.floor(rnd() * 7),
        dueDate: pick(onceDates),
      });
    }
  }

  const dateExceptions = taProfiles
    .filter(() => rnd() < 0.2)
    .map((t) => ({ taProfileId: t.id, startDate: "2026-02-10", endDate: "2026-02-12" }));

  return {
    shifts,
    taProfiles,
    availability,
    dateExceptions,
    lockedAssignments: [],
    periodStart: "2026-02-02",
    periodEnd: "2026-02-27",
  };
}
