import { v } from "convex/values";
import type { FunctionReference } from "convex/server";
import { mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { blockStatusValidator, dayValidator } from "./schema";
import { requireOwnProfile, requireUser } from "./lib/auth";
import { dutyTypeDoc } from "./dutyTypes";
import { assignmentDoc, shiftDoc } from "./shifts";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** ISO date + n days (UTC-safe). */
function addDaysIso(date: string, days: number): string {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * internal.umd.regenerateImportedBlocks is owned by the umd module (built
 * concurrently). Typed by hand so this file compiles before codegen sees it;
 * the runtime reference resolves through the generated api proxy.
 */
const regenerateImportedBlocks = (internal as any).umd
  .regenerateImportedBlocks as FunctionReference<
  "mutation",
  "internal",
  { taProfileRef: Id<"taProfiles"> },
  null
>;

const taProfileDoc = v.object({
  _id: v.id("taProfiles"),
  _creationTime: v.number(),
  userRef: v.id("users"),
  periodRef: v.id("staffingPeriods"),
  maxHoursPerWeek: v.number(),
  enrolledSectionRefs: v.array(v.id("sections")),
  syncAsyncPreference: v.number(),
  dutyTypePrefs: v.array(v.id("dutyTypes")),
  sectionPrefs: v.array(v.id("sections")),
  availabilitySubmittedAt: v.optional(v.number()),
});

const availabilityBlockDoc = v.object({
  _id: v.id("availabilityBlocks"),
  _creationTime: v.number(),
  taProfileRef: v.id("taProfiles"),
  day: dayValidator,
  startMin: v.number(),
  endMin: v.number(),
  status: blockStatusValidator,
  source: v.union(v.literal("manual"), v.literal("imported_class")),
});

const dateExceptionDoc = v.object({
  _id: v.id("dateExceptions"),
  _creationTime: v.number(),
  taProfileRef: v.id("taProfiles"),
  startDate: v.string(),
  endDate: v.string(),
  reason: v.string(),
});

const hourLogDoc = v.object({
  _id: v.id("hourLogs"),
  _creationTime: v.number(),
  assignmentRef: v.id("assignments"),
  taProfileRef: v.id("taProfiles"),
  date: v.string(),
  hours: v.number(),
  note: v.optional(v.string()),
  status: v.union(
    v.literal("draft"),
    v.literal("submitted"),
    v.literal("approved"),
    v.literal("flagged"),
  ),
});

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** The caller's own TA profile in a period, or null if they haven't created one. */
export const getProfile = query({
  args: { periodRef: v.id("staffingPeriods") },
  returns: v.union(v.null(), taProfileDoc),
  handler: async (ctx, args) => {
    const { user } = await requireUser(ctx);
    return await ctx.db
      .query("taProfiles")
      .withIndex("by_user_period", (q) =>
        q.eq("userRef", user._id).eq("periodRef", args.periodRef),
      )
      .unique();
  },
});

/** The caller's availability grid: all blocks (manual + imported) and date exceptions. */
export const getAvailability = query({
  args: { taProfileRef: v.id("taProfiles") },
  returns: v.object({
    blocks: v.array(availabilityBlockDoc),
    dateExceptions: v.array(dateExceptionDoc),
    availabilitySubmittedAt: v.union(v.null(), v.number()),
  }),
  handler: async (ctx, args) => {
    const { profile } = await requireOwnProfile(ctx, args.taProfileRef);
    const blocks = await ctx.db
      .query("availabilityBlocks")
      .withIndex("by_profile", (q) => q.eq("taProfileRef", profile._id))
      .collect();
    const dateExceptions = await ctx.db
      .query("dateExceptions")
      .withIndex("by_profile", (q) => q.eq("taProfileRef", profile._id))
      .collect();
    return {
      blocks,
      dateExceptions,
      availabilitySubmittedAt: profile.availabilitySubmittedAt ?? null,
    };
  },
});

/**
 * The caller's assignments joined with shift + duty type docs. Only
 * meaningful once the period is published; before that returns
 * { published: false, items: [] } so nothing leaks early.
 */
export const getSchedule = query({
  args: { taProfileRef: v.id("taProfiles") },
  returns: v.object({
    published: v.boolean(),
    items: v.array(
      v.object({
        assignment: assignmentDoc,
        shift: shiftDoc,
        dutyType: dutyTypeDoc,
      }),
    ),
  }),
  handler: async (ctx, args) => {
    const { profile } = await requireOwnProfile(ctx, args.taProfileRef);
    const period = await ctx.db.get(profile.periodRef);
    if (!period || period.status !== "published") {
      return { published: false, items: [] };
    }
    const assignments = await ctx.db
      .query("assignments")
      .withIndex("by_profile", (q) => q.eq("taProfileRef", profile._id))
      .collect();
    const items = [];
    for (const assignment of assignments) {
      const shift = await ctx.db.get(assignment.shiftRef);
      if (!shift) continue;
      const dutyType = await ctx.db.get(shift.dutyTypeRef);
      if (!dutyType) continue;
      items.push({ assignment, shift, dutyType });
    }
    return { published: true, items };
  },
});

/** All of the caller's hour logs for a profile. */
export const getHourLogs = query({
  args: { taProfileRef: v.id("taProfiles") },
  returns: v.array(hourLogDoc),
  handler: async (ctx, args) => {
    const { profile } = await requireOwnProfile(ctx, args.taProfileRef);
    return await ctx.db
      .query("hourLogs")
      .withIndex("by_profile", (q) => q.eq("taProfileRef", profile._id))
      .collect();
  },
});

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/**
 * Upsert the caller's TA profile for a period. When enrolledSectionRefs
 * change, imported class blocks are regenerated (internal.umd mutation).
 */
export const saveProfile = mutation({
  args: {
    periodRef: v.id("staffingPeriods"),
    maxHoursPerWeek: v.number(),
    enrolledSectionRefs: v.array(v.id("sections")),
    syncAsyncPreference: v.number(),
    dutyTypePrefs: v.array(v.id("dutyTypes")),
    sectionPrefs: v.array(v.id("sections")),
  },
  returns: v.id("taProfiles"),
  handler: async (ctx, args) => {
    const { user } = await requireUser(ctx);
    if (user.role === "coordinator") {
      throw new Error("Coordinators cannot create TA profiles");
    }
    const period = await ctx.db.get(args.periodRef);
    if (!period) throw new Error("Staffing period not found");
    if (args.maxHoursPerWeek < 0) {
      throw new Error("maxHoursPerWeek must be >= 0");
    }
    if (args.syncAsyncPreference < 0 || args.syncAsyncPreference > 1) {
      throw new Error("syncAsyncPreference must be between 0 and 1");
    }
    for (const dutyTypeRef of args.dutyTypePrefs) {
      const dt = await ctx.db.get(dutyTypeRef);
      if (!dt || dt.periodRef !== args.periodRef) {
        throw new Error("dutyTypePrefs contains a duty type outside this period");
      }
    }
    for (const sectionRef of [...args.enrolledSectionRefs, ...args.sectionPrefs]) {
      const section = await ctx.db.get(sectionRef);
      if (!section) throw new Error("Unknown section reference");
    }

    const fields = {
      maxHoursPerWeek: args.maxHoursPerWeek,
      enrolledSectionRefs: args.enrolledSectionRefs,
      syncAsyncPreference: args.syncAsyncPreference,
      dutyTypePrefs: args.dutyTypePrefs,
      sectionPrefs: args.sectionPrefs,
    };

    const existing = await ctx.db
      .query("taProfiles")
      .withIndex("by_user_period", (q) =>
        q.eq("userRef", user._id).eq("periodRef", args.periodRef),
      )
      .unique();

    let taProfileRef: Id<"taProfiles">;
    let enrolledChanged: boolean;
    if (existing) {
      enrolledChanged =
        existing.enrolledSectionRefs.length !== args.enrolledSectionRefs.length ||
        existing.enrolledSectionRefs.some(
          (ref, i) => ref !== args.enrolledSectionRefs[i],
        );
      await ctx.db.patch(existing._id, fields);
      taProfileRef = existing._id;
    } else {
      taProfileRef = await ctx.db.insert("taProfiles", {
        userRef: user._id,
        periodRef: args.periodRef,
        ...fields,
      });
      enrolledChanged = args.enrolledSectionRefs.length > 0;
    }

    if (enrolledChanged) {
      await ctx.runMutation(regenerateImportedBlocks, { taProfileRef });
    }
    return taProfileRef;
  },
});

/**
 * Atomically replace ALL manual availability blocks. Blocks imported from
 * class enrollment (source "imported_class") are never touched here.
 * Pass submitted: true to (re)stamp availabilitySubmittedAt.
 */
export const saveAvailability = mutation({
  args: {
    taProfileRef: v.id("taProfiles"),
    blocks: v.array(
      v.object({
        day: dayValidator,
        startMin: v.number(),
        endMin: v.number(),
        status: blockStatusValidator,
      }),
    ),
    submitted: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { profile } = await requireOwnProfile(ctx, args.taProfileRef);
    for (const b of args.blocks) {
      if (
        !Number.isInteger(b.startMin) ||
        !Number.isInteger(b.endMin) ||
        b.startMin < 0 ||
        b.endMin > 24 * 60 ||
        b.startMin >= b.endMin
      ) {
        throw new Error("Invalid block times (minutes from midnight, start < end)");
      }
    }
    const existing = await ctx.db
      .query("availabilityBlocks")
      .withIndex("by_profile", (q) => q.eq("taProfileRef", profile._id))
      .collect();
    for (const block of existing) {
      if (block.source === "manual") await ctx.db.delete(block._id);
    }
    for (const b of args.blocks) {
      await ctx.db.insert("availabilityBlocks", {
        taProfileRef: profile._id,
        day: b.day,
        startMin: b.startMin,
        endMin: b.endMin,
        status: b.status,
        source: "manual",
      });
    }
    if (args.submitted) {
      await ctx.db.patch(profile._id, { availabilitySubmittedAt: Date.now() });
    }
    return null;
  },
});

export const addDateException = mutation({
  args: {
    taProfileRef: v.id("taProfiles"),
    startDate: v.string(),
    endDate: v.string(),
    reason: v.string(),
  },
  returns: v.id("dateExceptions"),
  handler: async (ctx, args) => {
    const { profile } = await requireOwnProfile(ctx, args.taProfileRef);
    if (!ISO_DATE.test(args.startDate) || !ISO_DATE.test(args.endDate)) {
      throw new Error("Dates must be ISO YYYY-MM-DD");
    }
    if (args.startDate > args.endDate) {
      throw new Error("startDate must be on or before endDate");
    }
    return await ctx.db.insert("dateExceptions", {
      taProfileRef: profile._id,
      startDate: args.startDate,
      endDate: args.endDate,
      reason: args.reason,
    });
  },
});

export const removeDateException = mutation({
  args: { dateExceptionRef: v.id("dateExceptions") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const exception = await ctx.db.get(args.dateExceptionRef);
    if (!exception) throw new Error("Date exception not found");
    await requireOwnProfile(ctx, exception.taProfileRef); // ownership check
    await ctx.db.delete(exception._id);
    return null;
  },
});

/** Log hours worked against one of the caller's own assignments (status "draft"). */
export const logHours = mutation({
  args: {
    assignmentRef: v.id("assignments"),
    date: v.string(),
    hours: v.number(),
    note: v.optional(v.string()),
  },
  returns: v.id("hourLogs"),
  handler: async (ctx, args) => {
    const assignment = await ctx.db.get(args.assignmentRef);
    if (!assignment) throw new Error("Assignment not found");
    const { profile } = await requireOwnProfile(ctx, assignment.taProfileRef);
    if (!ISO_DATE.test(args.date)) throw new Error("date must be ISO YYYY-MM-DD");
    if (!(args.hours > 0) || args.hours > 24) {
      throw new Error("hours must be > 0 and <= 24");
    }
    return await ctx.db.insert("hourLogs", {
      assignmentRef: assignment._id,
      taProfileRef: profile._id,
      date: args.date,
      hours: args.hours,
      note: args.note,
      status: "draft",
    });
  },
});

/**
 * Submit all draft hour logs in the week starting at weekStart (7-day window,
 * weekStart..weekStart+6 inclusive). Returns how many logs were submitted.
 */
export const submitWeek = mutation({
  args: {
    taProfileRef: v.id("taProfiles"),
    weekStart: v.string(),
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    const { profile } = await requireOwnProfile(ctx, args.taProfileRef);
    if (!ISO_DATE.test(args.weekStart)) {
      throw new Error("weekStart must be ISO YYYY-MM-DD");
    }
    const weekEnd = addDaysIso(args.weekStart, 6);
    const logs = await ctx.db
      .query("hourLogs")
      .withIndex("by_profile", (q) => q.eq("taProfileRef", profile._id))
      .collect();
    let submitted = 0;
    for (const log of logs) {
      if (
        log.status === "draft" &&
        log.date >= args.weekStart &&
        log.date <= weekEnd
      ) {
        await ctx.db.patch(log._id, { status: "submitted" });
        submitted++;
      }
    }
    return submitted;
  },
});

/** Request a swap for one of the caller's own assignments. */
export const requestSwap = mutation({
  args: {
    assignmentRef: v.id("assignments"),
    reason: v.string(),
    suggestedTaRef: v.optional(v.id("taProfiles")),
  },
  returns: v.id("swapRequests"),
  handler: async (ctx, args) => {
    const assignment = await ctx.db.get(args.assignmentRef);
    if (!assignment) throw new Error("Assignment not found");
    const { profile } = await requireOwnProfile(ctx, assignment.taProfileRef);
    const shift = await ctx.db.get(assignment.shiftRef);
    if (!shift) throw new Error("Shift not found for this assignment");
    if (args.reason.trim().length === 0) {
      throw new Error("A reason is required");
    }
    if (args.suggestedTaRef !== undefined) {
      const suggested = await ctx.db.get(args.suggestedTaRef);
      if (!suggested || suggested.periodRef !== shift.periodRef) {
        throw new Error("Suggested TA is not in this staffing period");
      }
      if (suggested._id === profile._id) {
        throw new Error("You cannot suggest yourself");
      }
    }
    return await ctx.db.insert("swapRequests", {
      periodRef: shift.periodRef,
      assignmentRef: assignment._id,
      requesterRef: profile._id,
      suggestedTaRef: args.suggestedTaRef,
      reason: args.reason.trim(),
      status: "pending",
    });
  },
});
