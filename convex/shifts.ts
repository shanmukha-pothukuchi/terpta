import { v, type Infer } from "convex/values";
import { mutation, query, type MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { dayValidator } from "./schema";
import { requireCoordinator, requireUser } from "./lib/auth";

type Day = Infer<typeof dayValidator>;

/** Full shifts doc fields (shared with ta.getSchedule and list below). */
export const shiftFields = {
  _id: v.id("shifts"),
  _creationTime: v.number(),
  periodRef: v.id("staffingPeriods"),
  dutyTypeRef: v.id("dutyTypes"),
  requiredCount: v.number(),
  sectionRef: v.optional(v.id("sections")),
  description: v.optional(v.string()),
  recurrence: v.optional(v.union(v.literal("weekly"), v.literal("once"))),
  day: v.optional(dayValidator),
  startMin: v.optional(v.number()),
  endMin: v.optional(v.number()),
  date: v.optional(v.string()),
  startDate: v.optional(v.string()),
  endDate: v.optional(v.string()),
  hoursRequired: v.optional(v.number()),
  dueDate: v.optional(v.string()),
};
export const shiftDoc = v.object(shiftFields);

/** Full assignments doc validator (shared with ta.getSchedule). */
export const assignmentDoc = v.object({
  _id: v.id("assignments"),
  _creationTime: v.number(),
  shiftRef: v.id("shifts"),
  taProfileRef: v.id("taProfiles"),
  hoursAllocated: v.optional(v.number()),
  locked: v.boolean(),
  createdBy: v.union(v.literal("solver"), v.literal("manual")),
});

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Weekday (M–F) of an ISO date, or null for weekends/invalid dates. */
function weekdayOf(date: string): Day | null {
  if (!ISO_DATE.test(date)) return null;
  const dow = new Date(date + "T00:00:00Z").getUTCDay(); // 0=Sun..6=Sat
  return ([null, "M", "Tu", "W", "Th", "F", null] as const)[dow] ?? null;
}

type TimingArgs = {
  recurrence?: "weekly" | "once";
  day?: Day;
  startMin?: number;
  endMin?: number;
  date?: string;
  startDate?: string;
  endDate?: string;
  hoursRequired?: number;
  dueDate?: string;
};

/**
 * Validates mode-dependent fields and returns ONLY the fields that belong on
 * the resulting shift (so replace() drops stale fields when a shift changes
 * shape, e.g. weekly -> once).
 */
function validateTiming(mode: "sync" | "async", f: TimingArgs) {
  if (mode === "sync") {
    if (f.recurrence === undefined) {
      throw new Error('Sync shifts require recurrence ("weekly" or "once")');
    }
    if (f.startMin === undefined || f.endMin === undefined) {
      throw new Error("Sync shifts require startMin and endMin");
    }
    if (
      !Number.isInteger(f.startMin) ||
      !Number.isInteger(f.endMin) ||
      f.startMin < 0 ||
      f.endMin > 24 * 60 ||
      f.startMin >= f.endMin
    ) {
      throw new Error("Invalid shift times (minutes from midnight, start < end)");
    }
    if (f.recurrence === "weekly") {
      if (f.day === undefined) throw new Error("Weekly shifts require day");
      if (!f.startDate || !f.endDate) {
        throw new Error("Weekly shifts require startDate and endDate");
      }
      if (!ISO_DATE.test(f.startDate) || !ISO_DATE.test(f.endDate)) {
        throw new Error("Dates must be ISO YYYY-MM-DD");
      }
      if (f.startDate > f.endDate) {
        throw new Error("startDate must be on or before endDate");
      }
      return {
        recurrence: "weekly" as const,
        day: f.day,
        startMin: f.startMin,
        endMin: f.endMin,
        startDate: f.startDate,
        endDate: f.endDate,
      };
    }
    // once
    if (!f.date) throw new Error("One-time shifts require date");
    const day = weekdayOf(f.date);
    if (day === null) {
      throw new Error("One-time shifts must fall on a weekday (ISO YYYY-MM-DD, M-F)");
    }
    if (f.day !== undefined && f.day !== day) {
      throw new Error(`day (${f.day}) does not match the weekday of date (${day})`);
    }
    return {
      recurrence: "once" as const,
      day,
      startMin: f.startMin,
      endMin: f.endMin,
      date: f.date,
    };
  }
  // async
  if (f.hoursRequired === undefined || f.hoursRequired <= 0) {
    throw new Error("Async duties require hoursRequired > 0");
  }
  if (!f.dueDate || !ISO_DATE.test(f.dueDate)) {
    throw new Error("Async duties require dueDate (ISO YYYY-MM-DD)");
  }
  return { hoursRequired: f.hoursRequired, dueDate: f.dueDate };
}

type TaAvailability = {
  profile: Doc<"taProfiles">;
  unavailable: Doc<"availabilityBlocks">[]; // status === "unavailable" only
  exceptions: Doc<"dateExceptions">[];
};

function overlapsUnavailable(
  unavailable: Doc<"availabilityBlocks">[],
  day: Day,
  startMin: number,
  endMin: number,
): boolean {
  return unavailable.some(
    (b) => b.day === day && b.startMin < endMin && b.endMin > startMin,
  );
}

function countAvailableTas(shift: Doc<"shifts">, tas: TaAvailability[]): number {
  let count = 0;
  for (const ta of tas) {
    if (shift.recurrence === undefined) {
      // async duty: TAs with any weekly capacity
      if (ta.profile.maxHoursPerWeek > 0) count++;
      continue;
    }
    if (
      shift.day === undefined ||
      shift.startMin === undefined ||
      shift.endMin === undefined
    ) {
      continue; // malformed sync shift — count nobody rather than lie
    }
    if (shift.recurrence === "once") {
      const date = shift.date;
      if (date === undefined) continue;
      const excluded = ta.exceptions.some(
        (e) => e.startDate <= date && date <= e.endDate,
      );
      if (excluded) continue;
    }
    if (!overlapsUnavailable(ta.unavailable, shift.day, shift.startMin, shift.endMin)) {
      count++;
    }
  }
  return count;
}

/**
 * All shifts in a period, each with an availableTaCount hint: how many TAs
 * (with submitted availability) could plausibly take it. Readable by the
 * owning coordinator OR a TA with a profile in the period.
 */
export const list = query({
  args: { periodRef: v.id("staffingPeriods") },
  returns: v.array(v.object({ ...shiftFields, availableTaCount: v.number() })),
  handler: async (ctx, args) => {
    const { user } = await requireUser(ctx);
    const period = await ctx.db.get(args.periodRef);
    if (!period) throw new Error("Staffing period not found");
    const isOwner =
      user.role === "coordinator" && period.coordinatorRef === user._id;
    if (!isOwner) {
      const profile = await ctx.db
        .query("taProfiles")
        .withIndex("by_user_period", (q) =>
          q.eq("userRef", user._id).eq("periodRef", args.periodRef),
        )
        .unique();
      if (!profile) throw new Error("Not authorized for this period");
    }

    const shifts = await ctx.db
      .query("shifts")
      .withIndex("by_period", (q) => q.eq("periodRef", args.periodRef))
      .collect();

    const submittedProfiles = (
      await ctx.db
        .query("taProfiles")
        .withIndex("by_period", (q) => q.eq("periodRef", args.periodRef))
        .collect()
    ).filter((p) => p.availabilitySubmittedAt !== undefined);

    const tas: TaAvailability[] = [];
    for (const profile of submittedProfiles) {
      const blocks = await ctx.db
        .query("availabilityBlocks")
        .withIndex("by_profile", (q) => q.eq("taProfileRef", profile._id))
        .collect();
      const exceptions = await ctx.db
        .query("dateExceptions")
        .withIndex("by_profile", (q) => q.eq("taProfileRef", profile._id))
        .collect();
      tas.push({
        profile,
        unavailable: blocks.filter((b) => b.status === "unavailable"),
        exceptions,
      });
    }

    return shifts.map((shift) => ({
      ...shift,
      availableTaCount: countAvailableTas(shift, tas),
    }));
  },
});

const timingArgs = {
  recurrence: v.optional(v.union(v.literal("weekly"), v.literal("once"))),
  day: v.optional(dayValidator),
  startMin: v.optional(v.number()),
  endMin: v.optional(v.number()),
  date: v.optional(v.string()),
  startDate: v.optional(v.string()),
  endDate: v.optional(v.string()),
  hoursRequired: v.optional(v.number()),
  dueDate: v.optional(v.string()),
};

async function logShiftChange(
  ctx: MutationCtx,
  periodRef: Id<"staffingPeriods">,
  actorRef: Id<"users">,
  action: string,
  before: unknown,
  after: unknown,
) {
  await ctx.db.insert("changeLog", {
    periodRef,
    actorRef,
    action,
    before,
    after,
    at: Date.now(),
  });
}

export const create = mutation({
  args: {
    periodRef: v.id("staffingPeriods"),
    dutyTypeRef: v.id("dutyTypes"),
    requiredCount: v.number(),
    sectionRef: v.optional(v.id("sections")),
    description: v.optional(v.string()),
    ...timingArgs,
  },
  returns: v.id("shifts"),
  handler: async (ctx, args) => {
    const { user, period } = await requireCoordinator(ctx, args.periodRef);
    const dutyType = await ctx.db.get(args.dutyTypeRef);
    if (!dutyType || dutyType.periodRef !== args.periodRef) {
      throw new Error("Duty type does not belong to this period");
    }
    if (!Number.isInteger(args.requiredCount) || args.requiredCount < 1) {
      throw new Error("requiredCount must be an integer >= 1");
    }
    if (args.sectionRef !== undefined) {
      const section = await ctx.db.get(args.sectionRef);
      if (!section || section.courseRef !== period.courseRef) {
        throw new Error("Section does not belong to this period's course");
      }
    }
    const timing = validateTiming(dutyType.mode, args);
    const shiftRef = await ctx.db.insert("shifts", {
      periodRef: args.periodRef,
      dutyTypeRef: args.dutyTypeRef,
      requiredCount: args.requiredCount,
      sectionRef: args.sectionRef,
      description: args.description,
      ...timing,
    });
    if (period.status === "published") {
      const doc = await ctx.db.get(shiftRef);
      await logShiftChange(ctx, args.periodRef, user._id, "shift.create", null, doc);
    }
    return shiftRef;
  },
});

export const update = mutation({
  args: {
    shiftRef: v.id("shifts"),
    dutyTypeRef: v.optional(v.id("dutyTypes")),
    requiredCount: v.optional(v.number()),
    sectionRef: v.optional(v.id("sections")),
    description: v.optional(v.string()),
    ...timingArgs,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const shift = await ctx.db.get(args.shiftRef);
    if (!shift) throw new Error("Shift not found");
    const { user, period } = await requireCoordinator(ctx, shift.periodRef);

    const dutyTypeRef = args.dutyTypeRef ?? shift.dutyTypeRef;
    const dutyType = await ctx.db.get(dutyTypeRef);
    if (!dutyType || dutyType.periodRef !== shift.periodRef) {
      throw new Error("Duty type does not belong to this period");
    }
    const requiredCount = args.requiredCount ?? shift.requiredCount;
    if (!Number.isInteger(requiredCount) || requiredCount < 1) {
      throw new Error("requiredCount must be an integer >= 1");
    }
    const sectionRef = args.sectionRef ?? shift.sectionRef;
    if (sectionRef !== undefined) {
      const section = await ctx.db.get(sectionRef);
      if (!section || section.courseRef !== period.courseRef) {
        throw new Error("Section does not belong to this period's course");
      }
    }

    // Merge provided timing fields over the existing doc, then rebuild the
    // clean field set for the (possibly new) mode.
    const timing = validateTiming(dutyType.mode, {
      recurrence: args.recurrence ?? shift.recurrence,
      day: args.day ?? shift.day,
      startMin: args.startMin ?? shift.startMin,
      endMin: args.endMin ?? shift.endMin,
      date: args.date ?? shift.date,
      startDate: args.startDate ?? shift.startDate,
      endDate: args.endDate ?? shift.endDate,
      hoursRequired: args.hoursRequired ?? shift.hoursRequired,
      dueDate: args.dueDate ?? shift.dueDate,
    });

    await ctx.db.replace(shift._id, {
      periodRef: shift.periodRef,
      dutyTypeRef,
      requiredCount,
      sectionRef,
      description: args.description ?? shift.description,
      ...timing,
    });

    if (period.status === "published") {
      const after = await ctx.db.get(shift._id);
      await logShiftChange(ctx, shift.periodRef, user._id, "shift.update", shift, after);
    }
    return null;
  },
});

/** Deletes the shift AND any assignments referencing it (cascade). */
export const remove = mutation({
  args: { shiftRef: v.id("shifts") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const shift = await ctx.db.get(args.shiftRef);
    if (!shift) throw new Error("Shift not found");
    const { user, period } = await requireCoordinator(ctx, shift.periodRef);

    const assignments = await ctx.db
      .query("assignments")
      .withIndex("by_shift", (q) => q.eq("shiftRef", shift._id))
      .collect();
    for (const assignment of assignments) {
      await ctx.db.delete(assignment._id);
    }
    await ctx.db.delete(shift._id);

    if (period.status === "published") {
      await logShiftChange(
        ctx,
        shift.periodRef,
        user._id,
        "shift.remove",
        { shift, deletedAssignmentCount: assignments.length },
        null,
      );
    }
    return null;
  },
});
