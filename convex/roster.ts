import { ConvexError, v } from "convex/values";
import { action, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { isAllowedEmail, requireCoordinator } from "./lib/auth";

/**
 * Coordinator roster for a staffing period: every TA profile joined with its
 * user, availability status, preference summary, and currently assigned hours.
 *
 * status semantics:
 * - "submitted": availabilitySubmittedAt is set.
 * - "missing": TA has not submitted availability yet.
 */
export const list = query({
  args: { periodRef: v.id("staffingPeriods") },
  returns: v.array(
    v.object({
      taProfileRef: v.id("taProfiles"),
      userRef: v.id("users"),
      name: v.string(),
      email: v.string(),
      /** True while the users row is a placeholder awaiting AuthKit claim. */
      invitePending: v.boolean(),
      status: v.union(v.literal("submitted"), v.literal("missing")),
      availabilitySubmittedAt: v.optional(v.number()),
      maxHoursPerWeek: v.number(),
      syncAsyncPreference: v.number(),
      /** Top-ranked duty type names (up to 3), best first. */
      topDutyTypeNames: v.array(v.string()),
      sectionPrefCount: v.number(),
      /** Hours/week from assigned weekly sync shifts. */
      assignedWeeklyHours: v.number(),
      /** Total hours from assigned one-off sync shifts (not per-week). */
      assignedOnceHours: v.number(),
      /** Total allocated async hours (not per-week). */
      assignedAsyncHours: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    await requireCoordinator(ctx, args.periodRef);

    const profiles = await ctx.db
      .query("taProfiles")
      .withIndex("by_period", (q) => q.eq("periodRef", args.periodRef))
      .collect();
    const dutyTypes = await ctx.db
      .query("dutyTypes")
      .withIndex("by_period", (q) => q.eq("periodRef", args.periodRef))
      .collect();
    const dutyNames = new Map<string, string>(dutyTypes.map((d) => [d._id, d.name]));
    const shiftCache = new Map<string, Doc<"shifts"> | null>();

    const out = [];
    for (const profile of profiles) {
      const user = await ctx.db.get(profile.userRef);
      const assignments = await ctx.db
        .query("assignments")
        .withIndex("by_profile", (q) => q.eq("taProfileRef", profile._id))
        .collect();

      let weeklyHours = 0;
      let onceHours = 0;
      let asyncHours = 0;
      for (const assignment of assignments) {
        let shift = shiftCache.get(assignment.shiftRef);
        if (shift === undefined) {
          shift = await ctx.db.get(assignment.shiftRef);
          shiftCache.set(assignment.shiftRef, shift);
        }
        if (!shift) continue;
        if (
          shift.recurrence === "weekly" &&
          shift.startMin !== undefined &&
          shift.endMin !== undefined
        ) {
          weeklyHours += (shift.endMin - shift.startMin) / 60;
        } else if (
          shift.recurrence === "once" &&
          shift.startMin !== undefined &&
          shift.endMin !== undefined
        ) {
          onceHours += (shift.endMin - shift.startMin) / 60;
        } else if (shift.hoursRequired !== undefined) {
          asyncHours += assignment.hoursAllocated ?? shift.hoursRequired;
        }
      }

      out.push({
        taProfileRef: profile._id,
        userRef: profile.userRef,
        name: user?.name ?? "(unknown)",
        email: user?.email ?? "",
        invitePending: user ? user.workosId.startsWith("invited:") : false,
        status:
          profile.availabilitySubmittedAt !== undefined
            ? ("submitted" as const)
            : ("missing" as const),
        availabilitySubmittedAt: profile.availabilitySubmittedAt,
        maxHoursPerWeek: profile.maxHoursPerWeek,
        syncAsyncPreference: profile.syncAsyncPreference,
        topDutyTypeNames: profile.dutyTypePrefs
          .map((id) => dutyNames.get(id))
          .filter((n): n is string => n !== undefined)
          .slice(0, 3),
        sectionPrefCount: profile.sectionPrefs.length,
        assignedWeeklyHours: weeklyHours,
        assignedOnceHours: onceHours,
        assignedAsyncHours: asyncHours,
      });
    }

    out.sort((a, b) => a.name.localeCompare(b.name));
    return out;
  },
});

/**
 * Invite a TA by email. Creates a placeholder users row if none exists
 * (workosId "invited:<email>" — the AuthKit webhook claims it by email on
 * first sign-in) plus a pending taProfile with defaults. Idempotent: returns
 * the existing profile if the TA is already on the roster.
 */
export const invite = mutation({
  args: {
    periodRef: v.id("staffingPeriods"),
    email: v.string(),
  },
  returns: v.id("taProfiles"),
  handler: async (ctx, args) => {
    await requireCoordinator(ctx, args.periodRef);
    const email = args.email.trim().toLowerCase();
    if (!isAllowedEmail(email)) {
      throw new ConvexError("Only umd.edu and terpmail.umd.edu emails can be invited");
    }

    const existingUser = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", email))
      .first();
    const userRef =
      existingUser?._id ??
      (await ctx.db.insert("users", {
        workosId: `invited:${email}`,
        email,
        name: email.split("@")[0],
        role: "ta",
      }));

    const existingProfile = await ctx.db
      .query("taProfiles")
      .withIndex("by_user_period", (q) =>
        q.eq("userRef", userRef).eq("periodRef", args.periodRef),
      )
      .unique();
    if (existingProfile) return existingProfile._id;

    return await ctx.db.insert("taProfiles", {
      userRef,
      periodRef: args.periodRef,
      maxHoursPerWeek: 10,
      enrolledSectionRefs: [],
      syncAsyncPreference: 0.5,
      dutyTypePrefs: [],
      sectionPrefs: [],
    });
  },
});

/**
 * Auth + data loader for nudge. Runs with the calling coordinator's identity
 * (auth propagates through ctx.runQuery from the action). Filters to profiles
 * in this period that have NOT submitted availability.
 */
export const nudgeTargets = internalQuery({
  args: {
    periodRef: v.id("staffingPeriods"),
    taProfileRefs: v.array(v.id("taProfiles")),
  },
  returns: v.object({
    courseName: v.string(),
    term: v.string(),
    collectionDeadline: v.string(),
    targets: v.array(v.object({ email: v.string(), name: v.string() })),
  }),
  handler: async (ctx, args) => {
    const { period } = await requireCoordinator(ctx, args.periodRef);
    const course = await ctx.db.get(period.courseRef);
    const targets: Array<{ email: string; name: string }> = [];
    for (const taProfileRef of args.taProfileRefs) {
      const profile = await ctx.db.get(taProfileRef);
      if (!profile || profile.periodRef !== args.periodRef) continue;
      if (profile.availabilitySubmittedAt !== undefined) continue; // already submitted
      const user = await ctx.db.get(profile.userRef);
      if (!user) continue;
      targets.push({ email: user.email, name: user.name });
    }
    return {
      courseName: course ? `${course.courseId} — ${course.name}` : "your course",
      term: period.term,
      collectionDeadline: period.collectionDeadline,
      targets,
    };
  },
});

/**
 * Email a nudge to each still-missing TA among the given profiles.
 * Returns the number of nudge emails attempted.
 */
export const nudge = action({
  args: {
    periodRef: v.id("staffingPeriods"),
    taProfileRefs: v.array(v.id("taProfiles")),
  },
  returns: v.number(),
  handler: async (ctx, args): Promise<number> => {
    const { courseName, collectionDeadline, targets } = await ctx.runQuery(
      internal.roster.nudgeTargets,
      { periodRef: args.periodRef, taProfileRefs: args.taProfileRefs },
    );
    for (const target of targets) {
      await ctx.runAction(internal.emails.send, {
        to: target.email,
        subject: `[TerpTA] Availability needed for ${courseName}`,
        text:
          `Hi ${target.name},\n\n` +
          `Your coordinator for ${courseName} is waiting on your availability. ` +
          `Please sign in to TerpTA and submit it by ${collectionDeadline}.\n\n` +
          `Thanks!\nTerpTA`,
      });
    }
    return targets.length;
  },
});

/**
 * Remove a TA from a period. Cascades: availability blocks, date exceptions,
 * hour logs, assignments, and their swap requests. Idempotent.
 */
export const remove = mutation({
  args: { taProfileRef: v.id("taProfiles") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const profile = await ctx.db.get(args.taProfileRef);
    if (!profile) return null;
    await requireCoordinator(ctx, profile.periodRef);

    const blocks = await ctx.db
      .query("availabilityBlocks")
      .withIndex("by_profile", (q) => q.eq("taProfileRef", args.taProfileRef))
      .collect();
    for (const block of blocks) await ctx.db.delete(block._id);

    const exceptions = await ctx.db
      .query("dateExceptions")
      .withIndex("by_profile", (q) => q.eq("taProfileRef", args.taProfileRef))
      .collect();
    for (const exception of exceptions) await ctx.db.delete(exception._id);

    const logs = await ctx.db
      .query("hourLogs")
      .withIndex("by_profile", (q) => q.eq("taProfileRef", args.taProfileRef))
      .collect();
    for (const log of logs) await ctx.db.delete(log._id);

    const assignments = await ctx.db
      .query("assignments")
      .withIndex("by_profile", (q) => q.eq("taProfileRef", args.taProfileRef))
      .collect();
    for (const assignment of assignments) await ctx.db.delete(assignment._id);

    const swaps = await ctx.db
      .query("swapRequests")
      .withIndex("by_period", (q) => q.eq("periodRef", profile.periodRef))
      .collect();
    for (const swap of swaps) {
      if (swap.requesterRef === args.taProfileRef) {
        await ctx.db.delete(swap._id);
      } else if (swap.suggestedTaRef === args.taProfileRef) {
        await ctx.db.patch(swap._id, { suggestedTaRef: undefined });
      }
    }

    await ctx.db.delete(args.taProfileRef);
    return null;
  },
});
