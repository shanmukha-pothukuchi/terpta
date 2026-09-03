import { ConvexError, v } from "convex/values";
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { requireCoordinator } from "./lib/auth";
import { dayValidator, meetingValidator } from "./schema";
import { solve } from "./solver/solve";
import type {
  Day,
  SolveDiagnostics,
  SolveInput,
  SolverLockedAssignment,
  SolverShift,
} from "./solver/types";

// ---------------------------------------------------------------------------
// Period bounds (Fall 2026). Used as defaults when a weekly shift omits
// startDate/endDate and as the averaging window for weekly-load math.
// ---------------------------------------------------------------------------
const DEFAULT_PERIOD_START = "2026-08-31";
const DEFAULT_PERIOD_END = "2026-12-11";

// ---------------------------------------------------------------------------
// Helpers (pure)
// ---------------------------------------------------------------------------

const DAY_BY_UTC_INDEX: Record<number, Day | undefined> = {
  1: "M",
  2: "Tu",
  3: "W",
  4: "Th",
  5: "F",
};

/** Weekday of an ISO date, or null for weekends / malformed dates. */
function dayFromIsoDate(date: string): Day | null {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return DAY_BY_UTC_INDEX[parsed.getUTCDay()] ?? null;
}

function minutesOverlap(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/** Inclusive ISO date-range overlap (lexicographic compare is safe for ISO). */
function dateRangesOverlap(
  aStart: string,
  aEnd: string,
  bStart: string,
  bEnd: string,
): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}

function weeksBetween(startIso: string, endIso: string): number {
  const ms =
    Date.parse(`${endIso}T00:00:00Z`) - Date.parse(`${startIso}T00:00:00Z`);
  const days = ms / 86_400_000 + 1;
  return Math.max(1, days / 7);
}

function formatMin(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}

/**
 * Map a DB shift to the solver's discriminated union. Returns null for shifts
 * the solver cannot represent (weekend "once" dates, malformed sync shifts) —
 * those stay manually assignable via overrideAssignment.
 */
function toSolverShift(
  shift: Doc<"shifts">,
  dutyMode: "sync" | "async",
  defaultHoursCredit: number,
): SolverShift | null {
  if (dutyMode === "async") {
    return {
      id: shift._id,
      kind: "async",
      dutyTypeId: shift.dutyTypeRef,
      requiredCount: Math.max(1, shift.requiredCount),
      hoursRequired: shift.hoursRequired ?? defaultHoursCredit,
      dueDate: shift.dueDate ?? DEFAULT_PERIOD_END,
    };
  }
  if (shift.recurrence === "once") {
    if (
      shift.date === undefined ||
      shift.startMin === undefined ||
      shift.endMin === undefined
    ) {
      return null;
    }
    const day = dayFromIsoDate(shift.date);
    if (day === null) return null;
    return {
      id: shift._id,
      kind: "once_sync",
      dutyTypeId: shift.dutyTypeRef,
      sectionId: shift.sectionRef,
      requiredCount: shift.requiredCount,
      date: shift.date,
      day,
      startMin: shift.startMin,
      endMin: shift.endMin,
    };
  }
  // weekly (default recurrence for sync duties)
  if (
    shift.day === undefined ||
    shift.startMin === undefined ||
    shift.endMin === undefined
  ) {
    return null;
  }
  return {
    id: shift._id,
    kind: "weekly_sync",
    dutyTypeId: shift.dutyTypeRef,
    sectionId: shift.sectionRef,
    requiredCount: shift.requiredCount,
    day: shift.day,
    startMin: shift.startMin,
    endMin: shift.endMin,
    startDate: shift.startDate ?? DEFAULT_PERIOD_START,
    endDate: shift.endDate ?? DEFAULT_PERIOD_END,
  };
}

/** Concrete recurring window of a sync shift; null for async/malformed. */
type SyncWindow = {
  day: Day;
  startMin: number;
  endMin: number;
  startDate: string;
  endDate: string;
};

function windowOfShiftDoc(shift: Doc<"shifts">): SyncWindow | null {
  if (
    shift.recurrence === "once" &&
    shift.date !== undefined &&
    shift.startMin !== undefined &&
    shift.endMin !== undefined
  ) {
    const day = dayFromIsoDate(shift.date);
    if (day === null) return null;
    return {
      day,
      startMin: shift.startMin,
      endMin: shift.endMin,
      startDate: shift.date,
      endDate: shift.date,
    };
  }
  if (
    shift.recurrence === "weekly" &&
    shift.day !== undefined &&
    shift.startMin !== undefined &&
    shift.endMin !== undefined
  ) {
    return {
      day: shift.day,
      startMin: shift.startMin,
      endMin: shift.endMin,
      startDate: shift.startDate ?? DEFAULT_PERIOD_START,
      endDate: shift.endDate ?? DEFAULT_PERIOD_END,
    };
  }
  return null;
}

/** Average weekly hours an assignment contributes over the period. */
function weeklyHoursOf(
  shift: Doc<"shifts">,
  hoursAllocated: number | undefined,
  weeks: number,
): number {
  const w = windowOfShiftDoc(shift);
  if (w !== null) {
    const perOccurrence = (w.endMin - w.startMin) / 60;
    return shift.recurrence === "once" ? perOccurrence / weeks : perOccurrence;
  }
  return (hoursAllocated ?? shift.hoursRequired ?? 0) / weeks;
}

// ---------------------------------------------------------------------------
// Validators mirroring convex/solver/types.ts
// ---------------------------------------------------------------------------

const solverShiftValidator = v.union(
  v.object({
    id: v.string(),
    kind: v.literal("weekly_sync"),
    dutyTypeId: v.string(),
    sectionId: v.optional(v.string()),
    requiredCount: v.number(),
    day: dayValidator,
    startMin: v.number(),
    endMin: v.number(),
    startDate: v.string(),
    endDate: v.string(),
  }),
  v.object({
    id: v.string(),
    kind: v.literal("once_sync"),
    dutyTypeId: v.string(),
    sectionId: v.optional(v.string()),
    requiredCount: v.number(),
    date: v.string(),
    day: dayValidator,
    startMin: v.number(),
    endMin: v.number(),
  }),
  v.object({
    id: v.string(),
    kind: v.literal("async"),
    dutyTypeId: v.string(),
    requiredCount: v.number(),
    hoursRequired: v.number(),
    dueDate: v.string(),
  }),
);

const solveInputValidator = v.object({
  shifts: v.array(solverShiftValidator),
  taProfiles: v.array(
    v.object({
      id: v.string(),
      maxHoursPerWeek: v.number(),
      syncAsyncPreference: v.number(),
      dutyTypePrefs: v.array(v.string()),
      sectionPrefs: v.array(v.string()),
    }),
  ),
  availability: v.array(
    v.object({
      taProfileId: v.string(),
      day: dayValidator,
      startMin: v.number(),
      endMin: v.number(),
      status: v.union(
        v.literal("available"),
        v.literal("prefer_not"),
        v.literal("unavailable"),
      ),
    }),
  ),
  dateExceptions: v.array(
    v.object({
      taProfileId: v.string(),
      startDate: v.string(),
      endDate: v.string(),
    }),
  ),
  lockedAssignments: v.array(
    v.object({
      shiftId: v.string(),
      taProfileId: v.string(),
      hoursAllocated: v.optional(v.number()),
    }),
  ),
  periodStart: v.string(),
  periodEnd: v.string(),
});

const solvedAssignmentValidator = v.object({
  shiftId: v.string(),
  taProfileId: v.string(),
  hoursAllocated: v.optional(v.number()),
  locked: v.boolean(),
});

const diagnosticsValidator = v.object({
  unfilledShifts: v.array(
    v.object({ shiftId: v.string(), missing: v.number() }),
  ),
  taLoads: v.array(
    v.object({
      taProfileId: v.string(),
      weeklyHours: v.number(),
      maxHoursPerWeek: v.number(),
    }),
  ),
  zeroAssignmentTaIds: v.array(v.string()),
  hardViolations: v.array(
    v.object({
      shiftId: v.string(),
      taProfileId: v.string(),
      reason: v.string(),
    }),
  ),
});

const conflictTypeValidator = v.union(
  v.literal("unavailable"),
  v.literal("overlap"),
  v.literal("over_cap"),
  v.literal("class_conflict"),
);

const conflictValidator = v.object({
  type: conflictTypeValidator,
  detail: v.string(),
});

type Conflict = {
  type: "unavailable" | "overlap" | "over_cap" | "class_conflict";
  detail: string;
};

// ---------------------------------------------------------------------------
// loadSolverInput — auth + assemble SolveInput (called from the action; the
// caller's identity propagates into ctx.runQuery, so requireCoordinator works)
// ---------------------------------------------------------------------------

export const loadSolverInput = internalQuery({
  args: { periodRef: v.id("staffingPeriods") },
  returns: solveInputValidator,
  handler: async (ctx, args): Promise<SolveInput> => {
    await requireCoordinator(ctx, args.periodRef);

    const dutyTypes = await ctx.db
      .query("dutyTypes")
      .withIndex("by_period", (q) => q.eq("periodRef", args.periodRef))
      .collect();
    const dutyById = new Map(dutyTypes.map((d) => [d._id, d]));

    const shiftDocs = await ctx.db
      .query("shifts")
      .withIndex("by_period", (q) => q.eq("periodRef", args.periodRef))
      .collect();

    const shifts: SolverShift[] = [];
    for (const shift of shiftDocs) {
      const duty = dutyById.get(shift.dutyTypeRef);
      const mode =
        duty?.mode ?? (shift.recurrence !== undefined ? "sync" : "async");
      const mapped = toSolverShift(shift, mode, duty?.defaultHoursCredit ?? 0);
      if (mapped !== null) shifts.push(mapped);
    }

    const profiles = await ctx.db
      .query("taProfiles")
      .withIndex("by_period", (q) => q.eq("periodRef", args.periodRef))
      .collect();

    const taProfiles = profiles.map((p) => ({
      id: p._id as string,
      maxHoursPerWeek: p.maxHoursPerWeek,
      syncAsyncPreference: p.syncAsyncPreference,
      dutyTypePrefs: p.dutyTypePrefs.map((id) => id as string),
      sectionPrefs: p.sectionPrefs.map((id) => id as string),
    }));

    const availability: SolveInput["availability"] = [];
    const dateExceptions: SolveInput["dateExceptions"] = [];
    for (const profile of profiles) {
      const blocks = await ctx.db
        .query("availabilityBlocks")
        .withIndex("by_profile", (q) => q.eq("taProfileRef", profile._id))
        .collect();
      for (const b of blocks) {
        availability.push({
          taProfileId: profile._id as string,
          day: b.day,
          startMin: b.startMin,
          endMin: b.endMin,
          status: b.status,
        });
      }
      const exceptions = await ctx.db
        .query("dateExceptions")
        .withIndex("by_profile", (q) => q.eq("taProfileRef", profile._id))
        .collect();
      for (const e of exceptions) {
        dateExceptions.push({
          taProfileId: profile._id as string,
          startDate: e.startDate,
          endDate: e.endDate,
        });
      }
    }

    const lockedAssignments: SolverLockedAssignment[] = [];
    for (const shift of shiftDocs) {
      const rows = await ctx.db
        .query("assignments")
        .withIndex("by_shift", (q) => q.eq("shiftRef", shift._id))
        .collect();
      for (const row of rows) {
        if (!row.locked) continue;
        lockedAssignments.push({
          shiftId: shift._id as string,
          taProfileId: row.taProfileRef as string,
          ...(row.hoursAllocated !== undefined
            ? { hoursAllocated: row.hoursAllocated }
            : {}),
        });
      }
    }

    return {
      shifts,
      taProfiles,
      availability,
      dateExceptions,
      lockedAssignments,
      periodStart: DEFAULT_PERIOD_START,
      periodEnd: DEFAULT_PERIOD_END,
    };
  },
});

// ---------------------------------------------------------------------------
// applyResult — replace non-locked assignments with solver output
// ---------------------------------------------------------------------------

export const applyResult = internalMutation({
  args: {
    periodRef: v.id("staffingPeriods"),
    assignments: v.array(solvedAssignmentValidator),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { user, period } = await requireCoordinator(ctx, args.periodRef);

    const shiftDocs = await ctx.db
      .query("shifts")
      .withIndex("by_period", (q) => q.eq("periodRef", args.periodRef))
      .collect();
    const shiftIds = new Set<string>(shiftDocs.map((s) => s._id as string));

    // Delete every non-locked assignment for the period; keep locked rows in
    // place (preserves their provenance) and remember them for dedupe.
    let removed = 0;
    const keptLockedPairs = new Set<string>();
    for (const shift of shiftDocs) {
      const rows = await ctx.db
        .query("assignments")
        .withIndex("by_shift", (q) => q.eq("shiftRef", shift._id))
        .collect();
      for (const row of rows) {
        if (row.locked) {
          keptLockedPairs.add(`${row.shiftRef}|${row.taProfileRef}`);
          continue;
        }
        await ctx.db.delete(row._id);
        removed += 1;
      }
    }

    // Insert solver output. The solver echoes locked inputs back with
    // locked: true — those rows still exist, so skip them.
    let inserted = 0;
    for (const a of args.assignments) {
      if (!shiftIds.has(a.shiftId)) continue; // stale shift id
      if (keptLockedPairs.has(`${a.shiftId}|${a.taProfileId}`)) continue;
      await ctx.db.insert("assignments", {
        shiftRef: a.shiftId as Id<"shifts">,
        taProfileRef: a.taProfileId as Id<"taProfiles">,
        ...(a.hoursAllocated !== undefined
          ? { hoursAllocated: a.hoursAllocated }
          : {}),
        locked: a.locked,
        createdBy: "solver" as const,
      });
      inserted += 1;
    }

    await ctx.db.patch(args.periodRef, { status: "generated" });
    await ctx.db.insert("changeLog", {
      periodRef: args.periodRef,
      actorRef: user._id,
      action: "builder.generate",
      before: { status: period.status, removedAssignments: removed },
      after: { status: "generated", insertedAssignments: inserted },
      at: Date.now(),
    });
    return null;
  },
});

// ---------------------------------------------------------------------------
// generate — public action: load input, run pure solver, apply, return
// diagnostics for the builder UI
// ---------------------------------------------------------------------------

export const generate = action({
  args: { periodRef: v.id("staffingPeriods") },
  returns: diagnosticsValidator,
  handler: async (ctx, args): Promise<SolveDiagnostics> => {
    const input: SolveInput = await ctx.runQuery(
      internal.builder.loadSolverInput,
      { periodRef: args.periodRef },
    );
    const result = solve(input);
    await ctx.runMutation(internal.builder.applyResult, {
      periodRef: args.periodRef,
      assignments: result.assignments,
    });
    return result.diagnostics;
  },
});

// ---------------------------------------------------------------------------
// Conflict detection for manual overrides (never blocks the write)
// ---------------------------------------------------------------------------

async function computeConflicts(
  ctx: MutationCtx,
  shift: Doc<"shifts">,
  profile: Doc<"taProfiles">,
  assignmentRef: Id<"assignments">,
): Promise<Conflict[]> {
  const conflicts: Conflict[] = [];
  const window = windowOfShiftDoc(shift);

  if (window !== null) {
    const blocks = await ctx.db
      .query("availabilityBlocks")
      .withIndex("by_profile", (q) => q.eq("taProfileRef", profile._id))
      .collect();
    for (const block of blocks) {
      if (block.day !== window.day) continue;
      if (
        !minutesOverlap(
          block.startMin,
          block.endMin,
          window.startMin,
          window.endMin,
        )
      ) {
        continue;
      }
      if (block.source === "imported_class") {
        conflicts.push({
          type: "class_conflict",
          detail: `Overlaps TA's class ${window.day} ${formatMin(block.startMin)}-${formatMin(block.endMin)}`,
        });
      } else if (block.status === "unavailable") {
        conflicts.push({
          type: "unavailable",
          detail: `TA marked unavailable ${window.day} ${formatMin(block.startMin)}-${formatMin(block.endMin)}`,
        });
      }
    }

    const exceptions = await ctx.db
      .query("dateExceptions")
      .withIndex("by_profile", (q) => q.eq("taProfileRef", profile._id))
      .collect();
    for (const exc of exceptions) {
      const coversOnce =
        shift.recurrence === "once" &&
        shift.date !== undefined &&
        exc.startDate <= shift.date &&
        shift.date <= exc.endDate;
      const coversWholeWeekly =
        shift.recurrence === "weekly" &&
        exc.startDate <= window.startDate &&
        window.endDate <= exc.endDate;
      if (coversOnce || coversWholeWeekly) {
        conflicts.push({
          type: "unavailable",
          detail: `Date exception ${exc.startDate} to ${exc.endDate} (${exc.reason})`,
        });
      }
    }
  }

  // Overlaps with the TA's other assignments + total weekly load.
  const myAssignments = await ctx.db
    .query("assignments")
    .withIndex("by_profile", (q) => q.eq("taProfileRef", profile._id))
    .collect();
  const weeks = weeksBetween(DEFAULT_PERIOD_START, DEFAULT_PERIOD_END);
  let weeklyHours = 0;
  for (const a of myAssignments) {
    const otherShift = await ctx.db.get(a.shiftRef);
    if (otherShift === null || otherShift.periodRef !== shift.periodRef) {
      continue;
    }
    weeklyHours += weeklyHoursOf(otherShift, a.hoursAllocated, weeks);
    if (a._id === assignmentRef) continue; // the row we just wrote
    if (window === null) continue;
    const otherWindow = windowOfShiftDoc(otherShift);
    if (otherWindow === null) continue;
    if (
      otherWindow.day === window.day &&
      minutesOverlap(
        otherWindow.startMin,
        otherWindow.endMin,
        window.startMin,
        window.endMin,
      ) &&
      dateRangesOverlap(
        otherWindow.startDate,
        otherWindow.endDate,
        window.startDate,
        window.endDate,
      )
    ) {
      conflicts.push({
        type: "overlap",
        detail: `Overlaps another assignment ${otherWindow.day} ${formatMin(otherWindow.startMin)}-${formatMin(otherWindow.endMin)}`,
      });
    }
  }
  if (weeklyHours > profile.maxHoursPerWeek + 1e-9) {
    conflicts.push({
      type: "over_cap",
      detail: `Weekly load ${round1(weeklyHours)}h exceeds cap ${profile.maxHoursPerWeek}h`,
    });
  }
  return conflicts;
}

// ---------------------------------------------------------------------------
// board — read-only snapshot for the builder UI: every assignment in the
// period, advisory conflicts per assignment, per-TA weekly loads, and the
// course's sections (slot labels / rooms). Purely derived; safe to poll live.
// ---------------------------------------------------------------------------

const boardValidator = v.object({
  assignments: v.array(
    v.object({
      _id: v.id("assignments"),
      shiftRef: v.id("shifts"),
      taProfileRef: v.id("taProfiles"),
      hoursAllocated: v.optional(v.number()),
      locked: v.boolean(),
      createdBy: v.union(v.literal("solver"), v.literal("manual")),
    }),
  ),
  conflicts: v.array(
    v.object({
      assignmentRef: v.id("assignments"),
      taProfileRef: v.id("taProfiles"),
      shiftRef: v.id("shifts"),
      type: conflictTypeValidator,
      detail: v.string(),
    }),
  ),
  taLoads: v.array(
    v.object({
      taProfileRef: v.id("taProfiles"),
      weeklyHours: v.number(),
      maxHoursPerWeek: v.number(),
    }),
  ),
  sections: v.array(
    v.object({
      _id: v.id("sections"),
      sectionNumber: v.string(),
      // The schema's own meeting shape, not a copy of it. A copy here missed
      // the per-meeting `kind` when it was added, and every board with an
      // imported course failed return validation until the two agreed.
      meetings: v.array(meetingValidator),
    }),
  ),
});

export const board = query({
  args: { periodRef: v.id("staffingPeriods") },
  returns: boardValidator,
  handler: async (ctx, args) => {
    const { period } = await requireCoordinator(ctx, args.periodRef);

    const shifts = await ctx.db
      .query("shifts")
      .withIndex("by_period", (q) => q.eq("periodRef", args.periodRef))
      .collect();
    const profiles = await ctx.db
      .query("taProfiles")
      .withIndex("by_period", (q) => q.eq("periodRef", args.periodRef))
      .collect();

    const rows: Array<{ a: Doc<"assignments">; shift: Doc<"shifts"> }> = [];
    for (const shift of shifts) {
      const list = await ctx.db
        .query("assignments")
        .withIndex("by_shift", (q) => q.eq("shiftRef", shift._id))
        .collect();
      for (const a of list) rows.push({ a, shift });
    }

    const weeks = weeksBetween(DEFAULT_PERIOD_START, DEFAULT_PERIOD_END);
    const loadByTa = new Map<string, number>();
    for (const { a, shift } of rows) {
      const key = a.taProfileRef as string;
      loadByTa.set(
        key,
        (loadByTa.get(key) ?? 0) + weeklyHoursOf(shift, a.hoursAllocated, weeks),
      );
    }

    // Availability + exceptions only for TAs that actually hold assignments.
    const assignedTaIds = new Set(rows.map((r) => r.a.taProfileRef as string));
    const blocksByTa = new Map<string, Doc<"availabilityBlocks">[]>();
    const excByTa = new Map<string, Doc<"dateExceptions">[]>();
    for (const profile of profiles) {
      if (!assignedTaIds.has(profile._id as string)) continue;
      blocksByTa.set(
        profile._id as string,
        await ctx.db
          .query("availabilityBlocks")
          .withIndex("by_profile", (q) => q.eq("taProfileRef", profile._id))
          .collect(),
      );
      excByTa.set(
        profile._id as string,
        await ctx.db
          .query("dateExceptions")
          .withIndex("by_profile", (q) => q.eq("taProfileRef", profile._id))
          .collect(),
      );
    }

    const conflicts: Array<{
      assignmentRef: Id<"assignments">;
      taProfileRef: Id<"taProfiles">;
      shiftRef: Id<"shifts">;
      type: Conflict["type"];
      detail: string;
    }> = [];
    for (const { a, shift } of rows) {
      const window = windowOfShiftDoc(shift);
      if (window === null) continue;
      const push = (type: Conflict["type"], detail: string) =>
        conflicts.push({
          assignmentRef: a._id,
          taProfileRef: a.taProfileRef,
          shiftRef: shift._id,
          type,
          detail,
        });
      for (const block of blocksByTa.get(a.taProfileRef as string) ?? []) {
        if (block.day !== window.day) continue;
        if (
          !minutesOverlap(
            block.startMin,
            block.endMin,
            window.startMin,
            window.endMin,
          )
        ) {
          continue;
        }
        if (block.source === "imported_class") {
          push(
            "class_conflict",
            `Overlaps TA's class ${window.day} ${formatMin(block.startMin)}-${formatMin(block.endMin)}`,
          );
        } else if (block.status === "unavailable") {
          push(
            "unavailable",
            `TA marked unavailable ${window.day} ${formatMin(block.startMin)}-${formatMin(block.endMin)}`,
          );
        }
      }
      for (const exc of excByTa.get(a.taProfileRef as string) ?? []) {
        const coversOnce =
          shift.recurrence === "once" &&
          shift.date !== undefined &&
          exc.startDate <= shift.date &&
          shift.date <= exc.endDate;
        const coversWholeWeekly =
          shift.recurrence === "weekly" &&
          exc.startDate <= window.startDate &&
          window.endDate <= exc.endDate;
        if (coversOnce || coversWholeWeekly) {
          push(
            "unavailable",
            `Date exception ${exc.startDate} to ${exc.endDate} (${exc.reason})`,
          );
        }
      }
      for (const other of rows) {
        if (other.a._id === a._id) continue;
        if (other.a.taProfileRef !== a.taProfileRef) continue;
        const otherWindow = windowOfShiftDoc(other.shift);
        if (otherWindow === null) continue;
        if (
          otherWindow.day === window.day &&
          minutesOverlap(
            otherWindow.startMin,
            otherWindow.endMin,
            window.startMin,
            window.endMin,
          ) &&
          dateRangesOverlap(
            otherWindow.startDate,
            otherWindow.endDate,
            window.startDate,
            window.endDate,
          )
        ) {
          push(
            "overlap",
            `Overlaps another assignment ${otherWindow.day} ${formatMin(otherWindow.startMin)}-${formatMin(otherWindow.endMin)}`,
          );
        }
      }
    }

    const sections = await ctx.db
      .query("sections")
      .withIndex("by_course", (q) => q.eq("courseRef", period.courseRef))
      .collect();

    return {
      assignments: rows.map(({ a }) => ({
        _id: a._id,
        shiftRef: a.shiftRef,
        taProfileRef: a.taProfileRef,
        ...(a.hoursAllocated !== undefined
          ? { hoursAllocated: a.hoursAllocated }
          : {}),
        locked: a.locked,
        createdBy: a.createdBy,
      })),
      conflicts,
      taLoads: profiles.map((p) => ({
        taProfileRef: p._id,
        weeklyHours: round1(loadByTa.get(p._id as string) ?? 0),
        maxHoursPerWeek: p.maxHoursPerWeek,
      })),
      sections: sections.map((s) => ({
        _id: s._id,
        sectionNumber: s.sectionNumber,
        meetings: s.meetings,
      })),
    };
  },
});

// ---------------------------------------------------------------------------
// taDetail — read-only TA profile detail for the builder drawer
// ---------------------------------------------------------------------------

export const taDetail = query({
  args: { taProfileRef: v.id("taProfiles") },
  returns: v.union(
    v.null(),
    v.object({
      name: v.string(),
      email: v.string(),
      maxHoursPerWeek: v.number(),
      syncAsyncPreference: v.number(),
      availabilitySubmitted: v.boolean(),
      dutyTypePrefNames: v.array(v.string()),
      sectionPrefNumbers: v.array(v.string()),
      enrolledSectionNumbers: v.array(v.string()),
      blocks: v.array(
        v.object({
          day: dayValidator,
          startMin: v.number(),
          endMin: v.number(),
          status: v.union(
            v.literal("available"),
            v.literal("prefer_not"),
            v.literal("unavailable"),
          ),
          source: v.union(v.literal("manual"), v.literal("imported_class")),
        }),
      ),
      exceptions: v.array(
        v.object({
          startDate: v.string(),
          endDate: v.string(),
          reason: v.string(),
        }),
      ),
    }),
  ),
  handler: async (ctx, args) => {
    const profile = await ctx.db.get(args.taProfileRef);
    if (profile === null) return null;
    await requireCoordinator(ctx, profile.periodRef);

    const user = await ctx.db.get(profile.userRef);
    const blocks = await ctx.db
      .query("availabilityBlocks")
      .withIndex("by_profile", (q) => q.eq("taProfileRef", profile._id))
      .collect();
    const exceptions = await ctx.db
      .query("dateExceptions")
      .withIndex("by_profile", (q) => q.eq("taProfileRef", profile._id))
      .collect();
    const dutyTypes = await ctx.db
      .query("dutyTypes")
      .withIndex("by_period", (q) => q.eq("periodRef", profile.periodRef))
      .collect();
    const dutyNames = new Map(dutyTypes.map((d) => [d._id as string, d.name]));

    const sectionNumbers = async (ids: Id<"sections">[]) => {
      const out: string[] = [];
      for (const id of ids) {
        const section = await ctx.db.get(id);
        if (section !== null) out.push(section.sectionNumber);
      }
      return out;
    };

    return {
      name: user?.name ?? "(unknown)",
      email: user?.email ?? "",
      maxHoursPerWeek: profile.maxHoursPerWeek,
      syncAsyncPreference: profile.syncAsyncPreference,
      availabilitySubmitted: profile.availabilitySubmittedAt !== undefined,
      dutyTypePrefNames: profile.dutyTypePrefs
        .map((id) => dutyNames.get(id as string))
        .filter((n): n is string => n !== undefined),
      sectionPrefNumbers: await sectionNumbers(profile.sectionPrefs),
      enrolledSectionNumbers: await sectionNumbers(profile.enrolledSectionRefs),
      blocks: blocks.map((b) => ({
        day: b.day,
        startMin: b.startMin,
        endMin: b.endMin,
        status: b.status,
        source: b.source,
      })),
      exceptions: exceptions.map((e) => ({
        startDate: e.startDate,
        endDate: e.endDate,
        reason: e.reason,
      })),
    };
  },
});

// ---------------------------------------------------------------------------
// overrideAssignment — manual upsert; returns conflict flags for the UI
// ---------------------------------------------------------------------------

export const overrideAssignment = mutation({
  args: {
    shiftRef: v.id("shifts"),
    taProfileRef: v.id("taProfiles"),
    hoursAllocated: v.optional(v.number()),
  },
  returns: v.object({
    assignmentRef: v.id("assignments"),
    conflicts: v.array(conflictValidator),
  }),
  handler: async (ctx, args) => {
    const shift = await ctx.db.get(args.shiftRef);
    if (shift === null) throw new ConvexError("Shift not found");
    const { user } = await requireCoordinator(ctx, shift.periodRef);

    const profile = await ctx.db.get(args.taProfileRef);
    if (profile === null) throw new ConvexError("TA profile not found");
    if (profile.periodRef !== shift.periodRef) {
      throw new ConvexError("TA profile belongs to a different staffing period");
    }

    // Upsert (unique per shift+TA). Omitting hoursAllocated clears it.
    const rowsForShift = await ctx.db
      .query("assignments")
      .withIndex("by_shift", (q) => q.eq("shiftRef", args.shiftRef))
      .collect();
    const existing = rowsForShift.find(
      (r) => r.taProfileRef === args.taProfileRef,
    );

    let assignmentRef: Id<"assignments">;
    let before: unknown;
    if (existing !== undefined) {
      before = {
        assignmentRef: existing._id,
        shiftRef: existing.shiftRef,
        taProfileRef: existing.taProfileRef,
        hoursAllocated: existing.hoursAllocated ?? null,
        locked: existing.locked,
        createdBy: existing.createdBy,
      };
      await ctx.db.patch(existing._id, {
        hoursAllocated: args.hoursAllocated,
        createdBy: "manual",
      });
      assignmentRef = existing._id;
    } else {
      before = null;
      assignmentRef = await ctx.db.insert("assignments", {
        shiftRef: args.shiftRef,
        taProfileRef: args.taProfileRef,
        ...(args.hoursAllocated !== undefined
          ? { hoursAllocated: args.hoursAllocated }
          : {}),
        locked: false,
        createdBy: "manual",
      });
    }

    // Conflicts are advisory — computed after the write (mutations read their
    // own writes), never block it.
    const conflicts = await computeConflicts(ctx, shift, profile, assignmentRef);

    await ctx.db.insert("changeLog", {
      periodRef: shift.periodRef,
      actorRef: user._id,
      action: "assignment.override",
      before,
      after: {
        assignmentRef,
        shiftRef: args.shiftRef,
        taProfileRef: args.taProfileRef,
        hoursAllocated: args.hoursAllocated ?? null,
        locked: existing?.locked ?? false,
        createdBy: "manual",
        conflicts,
      },
      at: Date.now(),
    });

    return { assignmentRef, conflicts };
  },
});

// ---------------------------------------------------------------------------
// toggleLock / removeAssignment — coordinator-gated via assignment→shift→period
// ---------------------------------------------------------------------------

export const toggleLock = mutation({
  args: { assignmentRef: v.id("assignments") },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const assignment = await ctx.db.get(args.assignmentRef);
    if (assignment === null) throw new ConvexError("Assignment not found");
    const shift = await ctx.db.get(assignment.shiftRef);
    if (shift === null) throw new ConvexError("Shift not found for assignment");
    const { user, period } = await requireCoordinator(ctx, shift.periodRef);

    const locked = !assignment.locked;
    await ctx.db.patch(args.assignmentRef, { locked });

    if (period.status === "published") {
      await ctx.db.insert("changeLog", {
        periodRef: shift.periodRef,
        actorRef: user._id,
        action: locked ? "assignment.lock" : "assignment.unlock",
        before: { assignmentRef: args.assignmentRef, locked: assignment.locked },
        after: { assignmentRef: args.assignmentRef, locked },
        at: Date.now(),
      });
    }
    return locked;
  },
});

export const removeAssignment = mutation({
  args: { assignmentRef: v.id("assignments") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const assignment = await ctx.db.get(args.assignmentRef);
    if (assignment === null) return null; // already gone — idempotent
    const shift = await ctx.db.get(assignment.shiftRef);
    if (shift === null) throw new ConvexError("Shift not found for assignment");
    const { user, period } = await requireCoordinator(ctx, shift.periodRef);

    await ctx.db.delete(args.assignmentRef);

    if (period.status === "published") {
      await ctx.db.insert("changeLog", {
        periodRef: shift.periodRef,
        actorRef: user._id,
        action: "assignment.remove",
        before: {
          assignmentRef: args.assignmentRef,
          shiftRef: assignment.shiftRef,
          taProfileRef: assignment.taProfileRef,
          hoursAllocated: assignment.hoursAllocated ?? null,
          locked: assignment.locked,
          createdBy: assignment.createdBy,
        },
        after: null,
        at: Date.now(),
      });
    }
    return null;
  },
});
