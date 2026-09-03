import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
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

const changeLogDoc = v.object({
  _id: v.id("changeLog"),
  _creationTime: v.number(),
  periodRef: v.id("staffingPeriods"),
  actorRef: v.id("users"),
  action: v.string(),
  before: v.any(),
  after: v.any(),
  at: v.number(),
});

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
      throw new Error("Coordinator role required");
    }
    const course = await ctx.db.get(args.courseRef);
    if (!course) throw new Error("Course not found");
    if (!ISO_DATE.test(args.collectionDeadline)) {
      throw new Error("collectionDeadline must be ISO YYYY-MM-DD");
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
      if (!section) throw new Error("Section not found");
      if (section.courseRef !== args.courseRef) {
        throw new Error("Section belongs to a different course");
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

/** Change log for a period, newest first. Coordinator only. */
export const getChangelog = query({
  args: { periodRef: v.id("staffingPeriods") },
  returns: v.array(changeLogDoc),
  handler: async (ctx, args) => {
    await requireCoordinator(ctx, args.periodRef);
    return await ctx.db
      .query("changeLog")
      .withIndex("by_period", (q) => q.eq("periodRef", args.periodRef))
      .order("desc")
      .collect();
  },
});
