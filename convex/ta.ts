import { ConvexError, v } from "convex/values";
import type { FunctionReference } from "convex/server";
import { mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  blockStatusValidator,
  dayValidator,
  meetingValidator,
  officeHoursStyleValidator,
} from "./schema";
import { requireOwnProfile, requireUser } from "./lib/auth";
import { dutyTypeDoc } from "./dutyTypes";
import { assignmentDoc, shiftDoc } from "./shifts";
import { dayOfIso, toIsoDate } from "./lib/week";

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
  manualClassMeetings: v.optional(v.array(meetingValidator)),
  onboardingCompletedAt: v.optional(v.number()),
  officeHoursStyle: v.optional(officeHoursStyleValidator),
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
  /** Why the coordinator flagged this; the TA has to see it to act on it. */
  flagNote: v.optional(v.string()),
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
    /** Class times typed by hand when umd.io could not be reached. */
    manualClassMeetings: v.optional(v.array(meetingValidator)),
    /** Omitted on an update keeps whatever was saved; on a create reads as few_long. */
    officeHoursStyle: v.optional(officeHoursStyleValidator),
  },
  returns: v.id("taProfiles"),
  handler: async (ctx, args) => {
    const { user } = await requireUser(ctx);
    if (user.role === "coordinator") {
      throw new ConvexError("Coordinators cannot create TA profiles");
    }
    const period = await ctx.db.get(args.periodRef);
    if (!period) throw new ConvexError("Staffing period not found");
    if (args.maxHoursPerWeek < 0) {
      throw new ConvexError("maxHoursPerWeek must be >= 0");
    }
    if (args.syncAsyncPreference < 0 || args.syncAsyncPreference > 1) {
      throw new ConvexError("syncAsyncPreference must be between 0 and 1");
    }
    for (const dutyTypeRef of args.dutyTypePrefs) {
      const dt = await ctx.db.get(dutyTypeRef);
      if (!dt || dt.periodRef !== args.periodRef) {
        throw new ConvexError("dutyTypePrefs contains a duty type outside this period");
      }
    }
    for (const sectionRef of [...args.enrolledSectionRefs, ...args.sectionPrefs]) {
      const section = await ctx.db.get(sectionRef);
      if (!section) throw new ConvexError("Unknown section reference");
    }

    const manualClassMeetings = args.manualClassMeetings ?? [];
    for (const m of manualClassMeetings) {
      if (m.endMin <= m.startMin) {
        throw new ConvexError("A class block must end after it starts");
      }
    }

    const fields = {
      maxHoursPerWeek: args.maxHoursPerWeek,
      enrolledSectionRefs: args.enrolledSectionRefs,
      syncAsyncPreference: args.syncAsyncPreference,
      dutyTypePrefs: args.dutyTypePrefs,
      sectionPrefs: args.sectionPrefs,
      ...(args.officeHoursStyle !== undefined ? { officeHoursStyle: args.officeHoursStyle } : {}),
      manualClassMeetings,
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
      const sameEnrolled =
        existing.enrolledSectionRefs.length === args.enrolledSectionRefs.length &&
        existing.enrolledSectionRefs.every(
          (ref, i) => ref === args.enrolledSectionRefs[i],
        );
      const previousManual = existing.manualClassMeetings ?? [];
      const sameManual =
        previousManual.length === manualClassMeetings.length &&
        previousManual.every((m, i) => {
          const next = manualClassMeetings[i];
          return (
            m.day === next.day &&
            m.startMin === next.startMin &&
            m.endMin === next.endMin
          );
        });
      enrolledChanged = !sameEnrolled || !sameManual;
      await ctx.db.patch(existing._id, fields);
      taProfileRef = existing._id;
    } else {
      taProfileRef = await ctx.db.insert("taProfiles", {
        userRef: user._id,
        periodRef: args.periodRef,
        ...fields,
      });
      enrolledChanged =
        args.enrolledSectionRefs.length > 0 || manualClassMeetings.length > 0;
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
        throw new ConvexError("Invalid block times (minutes from midnight, start < end)");
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
      throw new ConvexError("Dates must be ISO YYYY-MM-DD");
    }
    if (args.startDate > args.endDate) {
      throw new ConvexError("startDate must be on or before endDate");
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
    if (!exception) throw new ConvexError("Date exception not found");
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
    if (!assignment) throw new ConvexError("Assignment not found");
    if (!ISO_DATE.test(args.date)) throw new ConvexError("date must be ISO YYYY-MM-DD");
    if (!(args.hours > 0) || args.hours > 24) {
      throw new ConvexError("hours must be > 0 and <= 24");
    }

    // Either the assignment is the caller's own, or the caller is on record
    // as standing in on that shift that day. A stand-in has no assignment of
    // their own, so this used to reject them outright — they worked the
    // meeting and had no way to be paid for it. The log is filed under the
    // shift's assignment for the label and under the caller for the money.
    const { user } = await requireUser(ctx);
    const owner = await ctx.db.get(assignment.taProfileRef);
    if (!owner) throw new ConvexError("The TA on that assignment no longer exists");
    let profile = owner.userRef === user._id ? owner : null;
    if (!profile) {
      const mine = await ctx.db
        .query("taProfiles")
        .withIndex("by_user_period", (q) =>
          q.eq("userRef", user._id).eq("periodRef", owner.periodRef),
        )
        .unique();
      const covering = mine
        ? await ctx.db
            .query("shiftCoverages")
            .withIndex("by_shift_date", (q) =>
              q.eq("shiftRef", assignment.shiftRef).eq("date", args.date),
            )
            .filter((q) => q.eq(q.field("coverTaRef"), mine._id))
            .first()
        : null;
      if (!mine || !covering) {
        throw new ConvexError("Not your assignment, and you are not covering it that day");
      }
      profile = mine;
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
      throw new ConvexError("weekStart must be ISO YYYY-MM-DD");
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

const swapScopeValidator = v.union(v.literal("date"), v.literal("permanent"));

const DAY_NAMES = { M: "Monday", Tu: "Tuesday", W: "Wednesday", Th: "Thursday", F: "Friday" } as const;

/** Request a swap for one of the caller's own assignments. */
export const requestSwap = mutation({
  args: {
    assignmentRef: v.id("assignments"),
    reason: v.string(),
    suggestedTaRef: v.optional(v.id("taProfiles")),
    scope: swapScopeValidator,
    /** ISO date; required when `scope` is "date". */
    date: v.optional(v.string()),
  },
  returns: v.id("swapRequests"),
  handler: async (ctx, args) => {
    const assignment = await ctx.db.get(args.assignmentRef);
    if (!assignment) throw new ConvexError("Assignment not found");
    const { profile } = await requireOwnProfile(ctx, assignment.taProfileRef);
    const shift = await ctx.db.get(assignment.shiftRef);
    if (!shift) throw new ConvexError("Shift not found for this assignment");
    if (args.reason.trim().length === 0) {
      throw new ConvexError("A reason is required");
    }
    if (args.scope === "date") {
      if (!args.date || !ISO_DATE.test(args.date)) {
        throw new ConvexError("Pick the date you need covered");
      }
      // A cover on a day the shift does not meet would sit in the table
      // forever, drawn nowhere: the board looks coverages up by weekday and
      // the TA schedule by the shift's own dates.
      if (shift.recurrence === "weekly") {
        if (!shift.day || dayOfIso(args.date) !== shift.day) {
          throw new ConvexError(`This shift meets on ${DAY_NAMES[shift.day ?? "M"]}s — pick one of those`);
        }
      } else if (shift.recurrence === "once") {
        if (args.date !== shift.date) {
          throw new ConvexError("A one-off event can only be covered on its own date");
        }
      } else {
        throw new ConvexError("Async work has no meeting to cover — request a permanent swap instead");
      }
      // Yesterday in UTC is the earliest anyone in a US timezone can still
      // mean "today"; anything before that is over.
      if (args.date < addDaysIso(toIsoDate(new Date()), -1)) {
        throw new ConvexError("That date has already passed");
      }
    }
    const openRequests = await ctx.db
      .query("swapRequests")
      .withIndex("by_requester", (q) => q.eq("requesterRef", profile._id))
      .collect();
    const duplicate = openRequests.find(
      (r) =>
        r.status === "pending" &&
        r.assignmentRef === assignment._id &&
        (r.scope ?? "permanent") === args.scope &&
        (args.scope === "permanent" || r.date === args.date),
    );
    if (duplicate) {
      throw new ConvexError("You already have a pending request for that");
    }
    if (args.suggestedTaRef !== undefined) {
      const suggested = await ctx.db.get(args.suggestedTaRef);
      if (!suggested || suggested.periodRef !== shift.periodRef) {
        throw new ConvexError("Suggested TA is not in this staffing period");
      }
      if (suggested._id === profile._id) {
        throw new ConvexError("You cannot suggest yourself");
      }
    }
    return await ctx.db.insert("swapRequests", {
      periodRef: shift.periodRef,
      assignmentRef: assignment._id,
      shiftRef: shift._id,
      requesterRef: profile._id,
      suggestedTaRef: args.suggestedTaRef,
      reason: args.reason.trim(),
      scope: args.scope,
      date: args.scope === "date" ? args.date : undefined,
      status: "pending",
    });
  },
});

const mySwapValidator = v.object({
  _id: v.id("swapRequests"),
  _creationTime: v.number(),
  status: v.union(
    v.literal("pending"),
    v.literal("approved"),
    v.literal("declined"),
    v.literal("cancelled"),
  ),
  reason: v.string(),
  scope: swapScopeValidator,
  date: v.optional(v.string()),
  /** e.g. "Discussion 0201 · Tue 10:00". Empty when the shift is gone. */
  label: v.string(),
  suggestedName: v.optional(v.string()),
});

/**
 * The caller's own swap requests, newest first.
 *
 * The Schedule page used to keep these in React state because nothing served
 * them, so a request the coordinator had already resolved stayed on screen as
 * "pending" until a reload. Reading them back from the database is what makes
 * the card update on its own.
 */
export const listMySwaps = query({
  args: { taProfileRef: v.id("taProfiles") },
  returns: v.array(mySwapValidator),
  handler: async (ctx, args) => {
    const { profile } = await requireOwnProfile(ctx, args.taProfileRef);
    const rows = await ctx.db
      .query("swapRequests")
      .withIndex("by_requester", (q) => q.eq("requesterRef", profile._id))
      .collect();

    const out = [];
    for (const swap of rows) {
      const assignment = await ctx.db.get(swap.assignmentRef);
      const shiftRef = swap.shiftRef ?? assignment?.shiftRef;
      const shift = shiftRef ? await ctx.db.get(shiftRef) : null;
      let label = "";
      if (shift) {
        const dutyType = await ctx.db.get(shift.dutyTypeRef);
        const when =
          shift.day && shift.startMin !== undefined
            ? ` · ${shift.day} ${formatMin(shift.startMin)}`
            : "";
        label = `${shift.description ?? dutyType?.name ?? "Shift"}${when}`;
      }
      let suggestedName: string | undefined;
      if (swap.suggestedTaRef !== undefined) {
        const suggested = await ctx.db.get(swap.suggestedTaRef);
        const user = suggested ? await ctx.db.get(suggested.userRef) : null;
        suggestedName = user?.preferredName || user?.name;
      }
      out.push({
        _id: swap._id,
        _creationTime: swap._creationTime,
        status: swap.status,
        reason: swap.reason,
        scope: swap.scope ?? ("permanent" as const),
        date: swap.date,
        label,
        suggestedName,
      });
    }
    out.sort((a, b) => b._creationTime - a._creationTime);
    return out;
  },
});

/** Withdraw a still-pending swap request the caller made. */
export const cancelSwap = mutation({
  args: { swapRef: v.id("swapRequests") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const swap = await ctx.db.get(args.swapRef);
    if (!swap) throw new ConvexError("Swap request not found");
    await requireOwnProfile(ctx, swap.requesterRef);
    if (swap.status !== "pending") {
      throw new ConvexError("That request has already been resolved");
    }
    await ctx.db.patch(swap._id, { status: "cancelled" });
    return null;
  },
});

/** 600 -> "10:00". Local helper so the query can label a shift. */
function formatMin(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h}:${String(m).padStart(2, "0")}`;
}

/** Stamp the setup wizard as finished (or skipped through). Idempotent. */
export const completeOnboarding = mutation({
  args: { taProfileRef: v.id("taProfiles") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { profile } = await requireOwnProfile(ctx, args.taProfileRef);
    if (profile.onboardingCompletedAt === undefined) {
      await ctx.db.patch(profile._id, { onboardingCompletedAt: Date.now() });
    }
    return null;
  },
});

/**
 * The caller's enrolled classes, grouped by course and joined with every
 * section of that course, so the Classes tab can rehydrate the picker.
 *
 * Courses and sections are public reference data; the profile that selects
 * them is the caller's own.
 */
export const getEnrolledClasses = query({
  args: { periodRef: v.id("staffingPeriods") },
  returns: v.array(
    v.object({
      courseId: v.string(),
      courseName: v.string(),
      selectedSectionIds: v.array(v.id("sections")),
      sections: v.array(
        v.object({
          _id: v.id("sections"),
          sectionNumber: v.string(),
          type: v.union(
            v.literal("lecture"),
            v.literal("discussion"),
            v.literal("lab"),
          ),
          meetings: v.array(meetingValidator),
          instructors: v.optional(v.array(v.string())),
        }),
      ),
    }),
  ),
  handler: async (ctx, args) => {
    const { user } = await requireUser(ctx);
    const profile = await ctx.db
      .query("taProfiles")
      .withIndex("by_user_period", (q) =>
        q.eq("userRef", user._id).eq("periodRef", args.periodRef),
      )
      .unique();
    if (!profile) return [];

    // Which courses do the selected sections belong to?
    const selectedByCourse = new Map<string, Id<"sections">[]>();
    for (const sectionRef of profile.enrolledSectionRefs) {
      const section = await ctx.db.get(sectionRef);
      if (!section) continue;
      const key = section.courseRef as string;
      selectedByCourse.set(key, [...(selectedByCourse.get(key) ?? []), sectionRef]);
    }

    const out = [];
    for (const [courseKey, selectedSectionIds] of selectedByCourse) {
      const courseRef = courseKey as Id<"courses">;
      const course = await ctx.db.get(courseRef);
      if (!course) continue;
      const sections = await ctx.db
        .query("sections")
        .withIndex("by_course", (q) => q.eq("courseRef", courseRef))
        .collect();
      sections.sort((a, b) => a.sectionNumber.localeCompare(b.sectionNumber));
      out.push({
        courseId: course.courseId,
        courseName: course.name,
        selectedSectionIds,
        sections: sections.map((s) => ({
          _id: s._id,
          sectionNumber: s.sectionNumber,
          type: s.type,
          meetings: s.meetings,
          instructors: s.instructors,
        })),
      });
    }
    out.sort((a, b) => a.courseId.localeCompare(b.courseId));
    return out;
  },
});

/**
 * Correct an hour log the TA still owns.
 *
 * Allowed while the entry is a draft or has been flagged — a flag is a request
 * to fix something, so it has to be fixable. Editing returns the entry to
 * draft and clears the flag, putting it back through the normal submit flow.
 * Submitted and approved entries are frozen; use unsubmitWeek first.
 */
export const updateHourLog = mutation({
  args: {
    hourLogRef: v.id("hourLogs"),
    hours: v.optional(v.number()),
    note: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const log = await ctx.db.get(args.hourLogRef);
    if (!log) throw new ConvexError("Hour log not found");
    await requireOwnProfile(ctx, log.taProfileRef);
    if (log.status !== "draft" && log.status !== "flagged") {
      throw new ConvexError(
        "Only draft or flagged hours can be edited — unsubmit the week first",
      );
    }
    if (args.hours !== undefined && (!(args.hours > 0) || args.hours > 24)) {
      throw new ConvexError("hours must be > 0 and <= 24");
    }
    await ctx.db.patch(args.hourLogRef, {
      ...(args.hours !== undefined ? { hours: args.hours } : {}),
      ...(args.note !== undefined ? { note: args.note } : {}),
      status: "draft",
      flagNote: undefined,
    });
    return null;
  },
});

/** Delete a draft or flagged hour log. Submitted/approved entries are frozen. */
export const deleteHourLog = mutation({
  args: { hourLogRef: v.id("hourLogs") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const log = await ctx.db.get(args.hourLogRef);
    if (!log) throw new ConvexError("Hour log not found");
    await requireOwnProfile(ctx, log.taProfileRef);
    if (log.status !== "draft" && log.status !== "flagged") {
      throw new ConvexError(
        "Only draft or flagged hours can be deleted — unsubmit the week first",
      );
    }
    await ctx.db.delete(args.hourLogRef);
    return null;
  },
});

/**
 * Pull a week's submitted hours back to draft. The inverse of submitWeek, so a
 * TA who submitted early can still correct the week. Approved entries stay put:
 * once a coordinator has signed off, only they can reopen it.
 */
export const unsubmitWeek = mutation({
  args: { taProfileRef: v.id("taProfiles"), weekStart: v.string() },
  returns: v.number(),
  handler: async (ctx, args) => {
    const { profile } = await requireOwnProfile(ctx, args.taProfileRef);
    if (!ISO_DATE.test(args.weekStart)) {
      throw new ConvexError("weekStart must be ISO YYYY-MM-DD");
    }
    const end = new Date(`${args.weekStart}T00:00:00Z`);
    end.setUTCDate(end.getUTCDate() + 6);
    const weekEnd = end.toISOString().slice(0, 10);

    const logs = await ctx.db
      .query("hourLogs")
      .withIndex("by_profile", (q) => q.eq("taProfileRef", profile._id))
      .collect();
    let count = 0;
    for (const log of logs) {
      if (log.date < args.weekStart || log.date > weekEnd) continue;
      if (log.status !== "submitted") continue;
      await ctx.db.patch(log._id, { status: "draft" });
      count++;
    }
    return count;
  },
});
