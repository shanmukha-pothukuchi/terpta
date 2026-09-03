import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { dayValidator, meetingValidator } from "./schema";
import { requireCoordinator, requireUser } from "./lib/auth";

const periodStatusValidator = v.union(
  v.literal("draft"),
  v.literal("collecting"),
  v.literal("generated"),
  v.literal("published"),
);

const periodDoc = v.object({
  _id: v.id("staffingPeriods"),
  _creationTime: v.number(),
  courseRef: v.id("courses"),
  term: v.string(),
  coordinatorRef: v.id("users"),
  collectionDeadline: v.string(),
  status: periodStatusValidator,
});

const courseDoc = v.object({
  _id: v.id("courses"),
  _creationTime: v.number(),
  courseId: v.string(),
  term: v.string(),
  name: v.string(),
});

const changeLogFields = {
  _id: v.id("changeLog"),
  _creationTime: v.number(),
  periodRef: v.id("staffingPeriods"),
  actorRef: v.id("users"),
  action: v.string(),
  before: v.any(),
  after: v.any(),
  at: v.number(),
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// Sensible Fall 2026 semester bounds for auto-created weekly shifts
// (UMD Fall 2026: classes run late Aug through mid Dec). Editable per shift.
const FALL_2026_START = "2026-08-31";
const FALL_2026_END = "2026-12-11";

const DEFAULT_DUTY_TYPES: Array<{
  name: string;
  mode: "sync" | "async";
  color: string;
  defaultHoursCredit: number;
}> = [
  { name: "Discussion", mode: "sync", color: "#e21833", defaultHoursCredit: 1 },
  { name: "Office Hours", mode: "sync", color: "#2f6fed", defaultHoursCredit: 1 },
  { name: "Exam Proctoring", mode: "sync", color: "#7c3aed", defaultHoursCredit: 2 },
  { name: "Grading", mode: "async", color: "#0d9488", defaultHoursCredit: 1 },
];

/**
 * Create a staffing period (coordinator role required; the caller becomes the
 * owner). Seeds the four default duty types and one weekly sync Discussion
 * shift per meeting of each provided discussion section. Starts in
 * "collecting" so TAs can submit availability immediately.
 */
export const create = mutation({
  args: {
    courseRef: v.id("courses"),
    term: v.string(),
    collectionDeadline: v.string(),
    sectionRefs: v.array(v.id("sections")),
  },
  returns: v.id("staffingPeriods"),
  handler: async (ctx, args) => {
    const { user } = await requireUser(ctx);
    if (user.role !== "coordinator") {
      throw new ConvexError("Coordinator role required");
    }
    const course = await ctx.db.get(args.courseRef);
    if (!course) throw new ConvexError("Course not found");
    if (!ISO_DATE.test(args.collectionDeadline)) {
      throw new ConvexError("collectionDeadline must be ISO YYYY-MM-DD");
    }

    const periodRef = await ctx.db.insert("staffingPeriods", {
      courseRef: args.courseRef,
      term: args.term,
      coordinatorRef: user._id,
      collectionDeadline: args.collectionDeadline,
      status: "collecting",
    });

    let discussionDutyTypeRef: Id<"dutyTypes"> | null = null;
    for (const dt of DEFAULT_DUTY_TYPES) {
      const ref = await ctx.db.insert("dutyTypes", { periodRef, ...dt });
      if (dt.name === "Discussion") discussionDutyTypeRef = ref;
    }

    for (const sectionRef of args.sectionRefs) {
      const section = await ctx.db.get(sectionRef);
      if (!section) throw new ConvexError("Section not found");
      if (section.courseRef !== args.courseRef) {
        throw new ConvexError("Section belongs to a different course");
      }
      if (section.type !== "discussion" || discussionDutyTypeRef === null) {
        continue;
      }
      for (const meeting of section.meetings) {
        await ctx.db.insert("shifts", {
          periodRef,
          dutyTypeRef: discussionDutyTypeRef,
          requiredCount: 1,
          sectionRef,
          description: `Discussion ${section.sectionNumber}`,
          recurrence: "weekly",
          day: meeting.day,
          startMin: meeting.startMin,
          endMin: meeting.endMin,
          startDate: FALL_2026_START,
          endDate: FALL_2026_END,
        });
      }
    }

    return periodRef;
  },
});

/**
 * Fetch one period + its course. Any authenticated UMD user may read it
 * (period ids are unguessable, so sharing the link acts as the TA invite).
 * Includes the caller's own taProfileId in the period (if any) and whether
 * the caller is the owning coordinator.
 */
export const get = query({
  args: { periodRef: v.id("staffingPeriods") },
  returns: v.union(
    v.null(),
    v.object({
      period: periodDoc,
      course: v.union(v.null(), courseDoc),
      taProfileId: v.union(v.null(), v.id("taProfiles")),
      isCoordinator: v.boolean(),
    }),
  ),
  handler: async (ctx, args) => {
    const { user } = await requireUser(ctx);
    const period = await ctx.db.get(args.periodRef);
    if (!period) return null;
    const course = await ctx.db.get(period.courseRef);
    const profile = await ctx.db
      .query("taProfiles")
      .withIndex("by_user_period", (q) =>
        q.eq("userRef", user._id).eq("periodRef", args.periodRef),
      )
      .unique();
    return {
      period,
      course,
      taProfileId: profile?._id ?? null,
      isCoordinator:
        user.role === "coordinator" && period.coordinatorRef === user._id,
    };
  },
});

/**
 * Periods relevant to the caller: owned periods for a coordinator, periods
 * where they have a profile for a TA (taProfileId set in that case).
 */
export const listMine = query({
  args: {},
  returns: v.array(
    v.object({
      period: periodDoc,
      course: v.union(v.null(), courseDoc),
      taProfileId: v.union(v.null(), v.id("taProfiles")),
    }),
  ),
  handler: async (ctx) => {
    const { user } = await requireUser(ctx);
    if (user.role === "coordinator") {
      const periods = await ctx.db
        .query("staffingPeriods")
        .withIndex("by_coordinator", (q) => q.eq("coordinatorRef", user._id))
        .collect();
      const out = [];
      for (const period of periods) {
        out.push({
          period,
          course: await ctx.db.get(period.courseRef),
          taProfileId: null,
        });
      }
      return out;
    }
    const profiles = await ctx.db
      .query("taProfiles")
      .withIndex("by_user_period", (q) => q.eq("userRef", user._id))
      .collect();
    const out = [];
    for (const profile of profiles) {
      const period = await ctx.db.get(profile.periodRef);
      if (!period) continue;
      out.push({
        period,
        course: await ctx.db.get(period.courseRef),
        taProfileId: profile._id,
      });
    }
    return out;
  },
});

/** Publish the schedule: status -> "published" + changeLog entry. Idempotent. */
export const publish = mutation({
  args: { periodRef: v.id("staffingPeriods") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { user, period } = await requireCoordinator(ctx, args.periodRef);
    if (period.status === "published") return null;
    await ctx.db.patch(period._id, { status: "published" });
    await ctx.db.insert("changeLog", {
      periodRef: period._id,
      actorRef: user._id,
      action: "period.publish",
      before: { status: period.status },
      after: { status: "published" },
      at: Date.now(),
    });
    return null;
  },
});

/**
 * Change log for a period, newest first, with the actor's display name
 * joined in. Coordinator only.
 */
export const getChangelog = query({
  args: { periodRef: v.id("staffingPeriods") },
  returns: v.array(
    v.object({
      ...changeLogFields,
      actorName: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    await requireCoordinator(ctx, args.periodRef);
    const entries = await ctx.db
      .query("changeLog")
      .withIndex("by_period", (q) => q.eq("periodRef", args.periodRef))
      .order("desc")
      .collect();
    const nameCache = new Map<string, string>();
    const out = [];
    for (const entry of entries) {
      let name = nameCache.get(entry.actorRef);
      if (name === undefined) {
        const actor = await ctx.db.get(entry.actorRef);
        name = actor?.name ?? "(unknown)";
        nameCache.set(entry.actorRef, name);
      }
      out.push({ ...entry, actorName: name });
    }
    return out;
  },
});

// ---------------------------------------------------------------------------
// Sections of a course (Period setup shows these after importCourse).
// ---------------------------------------------------------------------------

const sectionDoc = v.object({
  _id: v.id("sections"),
  _creationTime: v.number(),
  courseRef: v.id("courses"),
  sectionNumber: v.string(),
  type: v.union(v.literal("lecture"), v.literal("discussion"), v.literal("lab")),
  meetings: v.array(meetingValidator),
  instructors: v.optional(v.array(v.string())),
});

/** All sections of a course, sorted by section number. Coordinator only. */
export const listSections = query({
  args: { courseRef: v.id("courses") },
  returns: v.array(sectionDoc),
  handler: async (ctx, args) => {
    const { user } = await requireUser(ctx);
    if (user.role !== "coordinator") {
      throw new ConvexError("Coordinator role required");
    }
    const sections = await ctx.db
      .query("sections")
      .withIndex("by_course", (q) => q.eq("courseRef", args.courseRef))
      .collect();
    sections.sort((a, b) => a.sectionNumber.localeCompare(b.sectionNumber));
    return sections;
  },
});

// ---------------------------------------------------------------------------
// Swap requests — coordinator review (Changelog screen).
// ---------------------------------------------------------------------------

const swapStatusValidator = v.union(
  v.literal("pending"),
  v.literal("approved"),
  v.literal("declined"),
);

/**
 * Swap requests for a period joined with requester / suggested TA names and
 * the shift the assignment points at. Pending first, then newest first.
 * Coordinator only.
 */
export const listSwaps = query({
  args: { periodRef: v.id("staffingPeriods") },
  returns: v.array(
    v.object({
      _id: v.id("swapRequests"),
      _creationTime: v.number(),
      status: swapStatusValidator,
      reason: v.string(),
      requesterName: v.string(),
      suggestedTaName: v.union(v.null(), v.string()),
      /** True when the underlying assignment no longer exists. */
      assignmentGone: v.boolean(),
      dutyTypeName: v.string(),
      description: v.optional(v.string()),
      recurrence: v.optional(v.union(v.literal("weekly"), v.literal("once"))),
      day: v.optional(dayValidator),
      startMin: v.optional(v.number()),
      endMin: v.optional(v.number()),
      date: v.optional(v.string()),
      dueDate: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, args) => {
    await requireCoordinator(ctx, args.periodRef);
    const swaps = await ctx.db
      .query("swapRequests")
      .withIndex("by_period", (q) => q.eq("periodRef", args.periodRef))
      .collect();

    const out = [];
    for (const swap of swaps) {
      let requesterName = "(unknown)";
      const requester = await ctx.db.get(swap.requesterRef);
      if (requester) {
        const user = await ctx.db.get(requester.userRef);
        requesterName = user?.name ?? requesterName;
      }
      let suggestedTaName: string | null = null;
      if (swap.suggestedTaRef !== undefined) {
        const suggested = await ctx.db.get(swap.suggestedTaRef);
        if (suggested) {
          const user = await ctx.db.get(suggested.userRef);
          suggestedTaName = user?.name ?? null;
        }
      }
      const assignment = await ctx.db.get(swap.assignmentRef);
      const shift = assignment ? await ctx.db.get(assignment.shiftRef) : null;
      const dutyType = shift ? await ctx.db.get(shift.dutyTypeRef) : null;
      out.push({
        _id: swap._id,
        _creationTime: swap._creationTime,
        status: swap.status,
        reason: swap.reason,
        requesterName,
        suggestedTaName,
        assignmentGone: assignment === null,
        dutyTypeName: dutyType?.name ?? "Duty",
        description: shift?.description,
        recurrence: shift?.recurrence,
        day: shift?.day,
        startMin: shift?.startMin,
        endMin: shift?.endMin,
        date: shift?.date,
        dueDate: shift?.dueDate,
      });
    }
    out.sort((a, b) => {
      const ap = a.status === "pending" ? 0 : 1;
      const bp = b.status === "pending" ? 0 : 1;
      return ap - bp || b._creationTime - a._creationTime;
    });
    return out;
  },
});

/**
 * Approve or decline a pending swap request. Approving reassigns the
 * assignment to the suggested TA when one was given, otherwise removes the
 * assignment (the shift shows as unfilled in the Builder). Both outcomes are
 * written to the change log. Idempotent for already-resolved swaps.
 */
export const resolveSwap = mutation({
  args: { swapRef: v.id("swapRequests"), approve: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const swap = await ctx.db.get(args.swapRef);
    if (!swap) throw new ConvexError("Swap request not found");
    const { user } = await requireCoordinator(ctx, swap.periodRef);
    if (swap.status !== "pending") return null;

    const nextStatus = args.approve ? ("approved" as const) : ("declined" as const);
    let assignmentChange: { before: unknown; after: unknown } | null = null;

    if (args.approve) {
      const assignment = await ctx.db.get(swap.assignmentRef);
      if (assignment) {
        const before = {
          assignmentRef: assignment._id,
          shiftRef: assignment.shiftRef,
          taProfileRef: assignment.taProfileRef,
        };
        const suggested =
          swap.suggestedTaRef !== undefined
            ? await ctx.db.get(swap.suggestedTaRef)
            : null;
        if (suggested && suggested.periodRef === swap.periodRef) {
          await ctx.db.patch(assignment._id, {
            taProfileRef: suggested._id,
            createdBy: "manual",
          });
          assignmentChange = {
            before,
            after: { ...before, taProfileRef: suggested._id },
          };
        } else {
          await ctx.db.delete(assignment._id);
          assignmentChange = { before, after: null };
        }
      }
    }

    await ctx.db.patch(swap._id, { status: nextStatus });
    await ctx.db.insert("changeLog", {
      periodRef: swap.periodRef,
      actorRef: user._id,
      action: args.approve ? "swap.approve" : "swap.decline",
      before: { swapRef: swap._id, status: "pending", ...(assignmentChange ? { assignment: assignmentChange.before } : {}) },
      after: { swapRef: swap._id, status: nextStatus, ...(assignmentChange ? { assignment: assignmentChange.after } : {}) },
      at: Date.now(),
    });
    return null;
  },
});
