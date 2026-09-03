import { ConvexError, v } from "convex/values";
import { internalQuery, mutation, query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { requireCoordinator, requireUser } from "./lib/auth";

export const hourLogStatusValidator = v.union(
  v.literal("draft"),
  v.literal("submitted"),
  v.literal("approved"),
  v.literal("flagged"),
);

/** Add n days to an ISO YYYY-MM-DD date (UTC-safe, no DST surprises). */
function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/**
 * Coordinator view of hour logs for a period, joined with
 * assignment → shift → dutyType and the TA's user record.
 * Optional filters: single TA, duty type, week (weekStart..weekStart+6), status.
 */
export const list = query({
  args: {
    periodRef: v.id("staffingPeriods"),
    taProfileRef: v.optional(v.id("taProfiles")),
    dutyTypeRef: v.optional(v.id("dutyTypes")),
    weekStart: v.optional(v.string()), // ISO date; filters [weekStart, weekStart+6d]
    status: v.optional(hourLogStatusValidator),
  },
  returns: v.array(
    v.object({
      hourLogId: v.id("hourLogs"),
      assignmentRef: v.id("assignments"),
      shiftRef: v.id("shifts"),
      dutyTypeRef: v.id("dutyTypes"),
      dutyTypeName: v.string(),
      taProfileRef: v.id("taProfiles"),
      taName: v.string(),
      taEmail: v.string(),
      date: v.string(),
      hours: v.number(),
      status: hourLogStatusValidator,
      note: v.optional(v.string()),
      flagNote: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, args) => {
    await requireCoordinator(ctx, args.periodRef);

    let profiles: Doc<"taProfiles">[];
    if (args.taProfileRef) {
      const profile = await ctx.db.get(args.taProfileRef);
      if (!profile || profile.periodRef !== args.periodRef) {
        throw new ConvexError("TA profile does not belong to this period");
      }
      profiles = [profile];
    } else {
      profiles = await ctx.db
        .query("taProfiles")
        .withIndex("by_period", (q) => q.eq("periodRef", args.periodRef))
        .collect();
    }

    const weekEnd = args.weekStart ? addDaysIso(args.weekStart, 6) : undefined;
    const shiftCache = new Map<string, Doc<"shifts"> | null>();
    const dutyNameCache = new Map<string, string>();
    const rows = [];

    for (const profile of profiles) {
      const user = await ctx.db.get(profile.userRef);
      const logs = await ctx.db
        .query("hourLogs")
        .withIndex("by_profile", (q) => q.eq("taProfileRef", profile._id))
        .collect();
      for (const log of logs) {
        if (args.status !== undefined && log.status !== args.status) continue;
        if (args.weekStart !== undefined && weekEnd !== undefined) {
          if (log.date < args.weekStart || log.date > weekEnd) continue;
        }
        const assignment = await ctx.db.get(log.assignmentRef);
        if (!assignment) continue;
        let shift = shiftCache.get(assignment.shiftRef);
        if (shift === undefined) {
          shift = await ctx.db.get(assignment.shiftRef);
          shiftCache.set(assignment.shiftRef, shift);
        }
        if (!shift) continue;
        if (args.dutyTypeRef !== undefined && shift.dutyTypeRef !== args.dutyTypeRef) {
          continue;
        }
        let dutyTypeName = dutyNameCache.get(shift.dutyTypeRef);
        if (dutyTypeName === undefined) {
          const dutyType = await ctx.db.get(shift.dutyTypeRef);
          dutyTypeName = dutyType?.name ?? "Duty";
          dutyNameCache.set(shift.dutyTypeRef, dutyTypeName);
        }
        rows.push({
          hourLogId: log._id,
          assignmentRef: assignment._id,
          shiftRef: shift._id,
          dutyTypeRef: shift.dutyTypeRef,
          dutyTypeName,
          taProfileRef: profile._id,
          taName: user?.name ?? "(unknown)",
          taEmail: user?.email ?? "",
          date: log.date,
          hours: log.hours,
          status: log.status,
          note: log.note,
          flagNote: log.flagNote,
        });
      }
    }

    rows.sort((a, b) =>
      a.date < b.date ? -1 : a.date > b.date ? 1 : a.taName.localeCompare(b.taName),
    );
    return rows;
  },
});

/**
 * Approve a batch of hour logs. The caller must be the coordinator of every
 * period the logs belong to. Returns the number of logs actually transitioned.
 */
export const bulkApprove = mutation({
  args: { hourLogIds: v.array(v.id("hourLogs")) },
  returns: v.number(),
  handler: async (ctx, args) => {
    const authorizedPeriods = new Set<string>();
    let approved = 0;
    for (const hourLogId of args.hourLogIds) {
      const log = await ctx.db.get(hourLogId);
      if (!log) continue;
      const profile = await ctx.db.get(log.taProfileRef);
      if (!profile) continue;
      if (!authorizedPeriods.has(profile.periodRef)) {
        await requireCoordinator(ctx, profile.periodRef);
        authorizedPeriods.add(profile.periodRef);
      }
      if (log.status !== "approved") {
        await ctx.db.patch(hourLogId, { status: "approved" });
        approved++;
      }
    }
    return approved;
  },
});

/** Flag an hour log for follow-up; optionally appends a coordinator note. */
export const flag = mutation({
  args: {
    hourLogId: v.id("hourLogs"),
    note: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const log = await ctx.db.get(args.hourLogId);
    if (!log) throw new ConvexError("Hour log not found");
    const profile = await ctx.db.get(log.taProfileRef);
    if (!profile) throw new ConvexError("TA profile not found");
    await requireCoordinator(ctx, profile.periodRef);
    // Replaces any previous reason rather than appending, so flagging twice
    // does not build up a run-on note.
    await ctx.db.patch(args.hourLogId, {
      status: "flagged",
      flagNote: args.note?.trim() ? args.note.trim() : undefined,
    });
    return null;
  },
});

/**
 * Lift a flag, returning the log to the queue for a normal decision.
 *
 * Flagging is a question, not a verdict — without this a coordinator who
 * flagged the wrong row could only escape by approving it.
 */
export const unflag = mutation({
  args: { hourLogId: v.id("hourLogs") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const log = await ctx.db.get(args.hourLogId);
    if (!log) throw new ConvexError("Hour log not found");
    const profile = await ctx.db.get(log.taProfileRef);
    if (!profile) throw new ConvexError("TA profile not found");
    await requireCoordinator(ctx, profile.periodRef);
    if (log.status !== "flagged") {
      throw new ConvexError("That hour log is not flagged");
    }
    await ctx.db.patch(args.hourLogId, {
      status: "submitted",
      flagNote: undefined,
    });
    return null;
  },
});

/** Undo an approval made by mistake, back to the pending queue. */
export const unapprove = mutation({
  args: { hourLogId: v.id("hourLogs") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const log = await ctx.db.get(args.hourLogId);
    if (!log) throw new ConvexError("Hour log not found");
    const profile = await ctx.db.get(log.taProfileRef);
    if (!profile) throw new ConvexError("TA profile not found");
    await requireCoordinator(ctx, profile.periodRef);
    if (log.status !== "approved") {
      throw new ConvexError("That hour log is not approved");
    }
    await ctx.db.patch(args.hourLogId, { status: "submitted" });
    return null;
  },
});

/**
 * Per-TA hour totals for a period.
 * - The period's coordinator sees every TA.
 * - A TA with a profile in the period sees ONLY their own row.
 */
export const totalsByTa = query({
  args: { periodRef: v.id("staffingPeriods") },
  returns: v.array(
    v.object({
      taProfileRef: v.id("taProfiles"),
      taName: v.string(),
      taEmail: v.string(),
      approvedHours: v.number(),
      submittedHours: v.number(),
      flaggedHours: v.number(),
      maxHoursPerWeek: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const { user } = await requireUser(ctx);
    const period = await ctx.db.get(args.periodRef);
    if (!period) throw new ConvexError("Staffing period not found");

    let profiles: Doc<"taProfiles">[];
    if (user.role === "coordinator" && period.coordinatorRef === user._id) {
      profiles = await ctx.db
        .query("taProfiles")
        .withIndex("by_period", (q) => q.eq("periodRef", args.periodRef))
        .collect();
    } else {
      const own = await ctx.db
        .query("taProfiles")
        .withIndex("by_user_period", (q) =>
          q.eq("userRef", user._id).eq("periodRef", args.periodRef),
        )
        .unique();
      if (!own) throw new ConvexError("You have no TA profile in this period");
      profiles = [own];
    }

    const out = [];
    for (const profile of profiles) {
      const profileUser = await ctx.db.get(profile.userRef);
      const logs = await ctx.db
        .query("hourLogs")
        .withIndex("by_profile", (q) => q.eq("taProfileRef", profile._id))
        .collect();
      let approvedHours = 0;
      let submittedHours = 0;
      let flaggedHours = 0;
      for (const log of logs) {
        if (log.status === "approved") approvedHours += log.hours;
        else if (log.status === "submitted") submittedHours += log.hours;
        else if (log.status === "flagged") flaggedHours += log.hours;
      }
      out.push({
        taProfileRef: profile._id,
        taName: profileUser?.name ?? "(unknown)",
        taEmail: profileUser?.email ?? "",
        approvedHours,
        submittedHours,
        flaggedHours,
        maxHoursPerWeek: profile.maxHoursPerWeek,
      });
    }
    out.sort((a, b) => a.taName.localeCompare(b.taName));
    return out;
  },
});

// ---------------------------------------------------------------------------
// Data loader for the CSV export. No auth here: only reachable from http.ts
// AFTER verifyToken() has validated a signed, unexpired hourlogs token.
// ---------------------------------------------------------------------------

export const hourLogsForExport = internalQuery({
  args: {
    periodRef: v.id("staffingPeriods"),
    from: v.optional(v.string()), // ISO date, inclusive
    to: v.optional(v.string()), // ISO date, inclusive
  },
  returns: v.array(
    v.object({
      date: v.string(),
      ta: v.string(),
      email: v.string(),
      dutyType: v.string(),
      hours: v.number(),
      status: v.string(),
      note: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    const profiles = await ctx.db
      .query("taProfiles")
      .withIndex("by_period", (q) => q.eq("periodRef", args.periodRef))
      .collect();

    const shiftCache = new Map<string, Doc<"shifts"> | null>();
    const dutyNameCache = new Map<string, string>();
    const rows = [];

    for (const profile of profiles) {
      const user = await ctx.db.get(profile.userRef);
      const logs = await ctx.db
        .query("hourLogs")
        .withIndex("by_profile", (q) => q.eq("taProfileRef", profile._id))
        .collect();
      for (const log of logs) {
        if (args.from !== undefined && log.date < args.from) continue;
        if (args.to !== undefined && log.date > args.to) continue;
        let dutyType = "Duty";
        const assignment = await ctx.db.get(log.assignmentRef);
        if (assignment) {
          let shift = shiftCache.get(assignment.shiftRef);
          if (shift === undefined) {
            shift = await ctx.db.get(assignment.shiftRef);
            shiftCache.set(assignment.shiftRef, shift);
          }
          if (shift) {
            let name = dutyNameCache.get(shift.dutyTypeRef);
            if (name === undefined) {
              const dt = await ctx.db.get(shift.dutyTypeRef);
              name = dt?.name ?? "Duty";
              dutyNameCache.set(shift.dutyTypeRef, name);
            }
            dutyType = name;
          }
        }
        rows.push({
          date: log.date,
          ta: user?.name ?? "(unknown)",
          email: user?.email ?? "",
          dutyType,
          hours: log.hours,
          status: log.status,
          note: log.note ?? "",
        });
      }
    }

    rows.sort((a, b) =>
      a.date < b.date ? -1 : a.date > b.date ? 1 : a.ta.localeCompare(b.ta),
    );
    return rows;
  },
});
