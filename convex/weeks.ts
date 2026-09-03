/**
 * Week views.
 *
 * The schedule screens all showed a generic repeating week, which is right
 * until something happens to a specific one: a TA is away, a one-off event
 * lands, or someone is covering a single meeting. None of that is visible in
 * "the week in general", so both the Builder and the TA schedule need to be
 * able to look at one dated week and see what is actually true of it.
 *
 * Both queries answer the same question from opposite sides: `taWeek` for one
 * TA's own week, `builderWeek` as an overlay the coordinator paints over the
 * board.
 */
import { ConvexError, v } from "convex/values";
import { query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { dayValidator } from "./schema";
import { requireCoordinator, requireOwnProfile } from "./lib/auth";
import { dutyTypeDoc } from "./dutyTypes";
import { assignmentDoc, shiftDoc } from "./shifts";
import {
  dateOfDayInWeek,
  dayOfIso,
  isDateInRange,
  weekRange,
  weeklyShiftRunsInWeek,
} from "./lib/week";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function assertWeekStart(weekStart: string) {
  if (!ISO_DATE.test(weekStart)) {
    throw new ConvexError("weekStart must be ISO YYYY-MM-DD");
  }
}

async function displayName(
  ctx: QueryCtx,
  profileRef: Id<"taProfiles">,
): Promise<string> {
  const profile = await ctx.db.get(profileRef);
  if (!profile) return "Unknown";
  const user = await ctx.db.get(profile.userRef);
  return user?.preferredName || user?.name || "Unknown";
}

/**
 * Where a shift falls in a given week, or null when it does not fall in it at
 * all. Weekly shifts land on their weekday; one-off shifts on their own date.
 */
function dateInWeek(shift: Doc<"shifts">, week: ReturnType<typeof weekRange>) {
  if (shift.recurrence === "weekly" && shift.day) {
    if (!weeklyShiftRunsInWeek(shift, week)) return null;
    return dateOfDayInWeek(week.start, shift.day);
  }
  if (shift.recurrence === "once" && shift.date) {
    return isDateInRange(shift.date, week.start, week.end) ? shift.date : null;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* TA — one dated week of my own schedule                              */
/* ------------------------------------------------------------------ */

/**
 * What happened to one occurrence.
 *
 * "off" and "covering" both come from one-off coverage; "excepted" is the TA's
 * own date exception, which the coordinator may not have acted on yet — worth
 * showing precisely because it is the case most likely to be forgotten.
 */
const occurrenceStateValidator = v.union(
  v.literal("normal"),
  v.literal("off"),
  v.literal("covering"),
  v.literal("excepted"),
);

export const taWeek = query({
  args: { taProfileRef: v.id("taProfiles"), weekStart: v.string() },
  returns: v.object({
    published: v.boolean(),
    weekStart: v.string(),
    weekEnd: v.string(),
    occurrences: v.array(
      v.object({
        key: v.string(),
        date: v.string(),
        day: v.union(v.null(), dayValidator),
        assignment: v.union(v.null(), assignmentDoc),
        shift: shiftDoc,
        dutyType: dutyTypeDoc,
        state: occurrenceStateValidator,
        /** The other party in a coverage, when there is one. */
        otherName: v.union(v.null(), v.string()),
        /** Why the TA marked themselves away, for "excepted". */
        exceptionReason: v.union(v.null(), v.string()),
      }),
    ),
    exceptions: v.array(
      v.object({
        _id: v.id("dateExceptions"),
        startDate: v.string(),
        endDate: v.string(),
        reason: v.string(),
      }),
    ),
  }),
  handler: async (ctx, args) => {
    assertWeekStart(args.weekStart);
    const { profile } = await requireOwnProfile(ctx, args.taProfileRef);
    const week = weekRange(args.weekStart);
    const period = await ctx.db.get(profile.periodRef);
    const published = period?.status === "published";

    const exceptions = (
      await ctx.db
        .query("dateExceptions")
        .withIndex("by_profile", (q) => q.eq("taProfileRef", profile._id))
        .collect()
    )
      .filter((x) => x.startDate <= week.end && week.start <= x.endDate)
      .map((x) => ({
        _id: x._id,
        startDate: x.startDate,
        endDate: x.endDate,
        reason: x.reason,
      }));

    if (!published) {
      return {
        published: false,
        weekStart: week.start,
        weekEnd: week.end,
        occurrences: [],
        exceptions,
      };
    }

    const coverages = (
      await ctx.db
        .query("shiftCoverages")
        .withIndex("by_period", (q) => q.eq("periodRef", profile.periodRef))
        .collect()
    ).filter((c) => isDateInRange(c.date, week.start, week.end));

    const occurrences = [];

    // The TA's own recurring work, one row per date it actually happens.
    const assignments = await ctx.db
      .query("assignments")
      .withIndex("by_profile", (q) => q.eq("taProfileRef", profile._id))
      .collect();

    for (const assignment of assignments) {
      const shift = await ctx.db.get(assignment.shiftRef);
      if (!shift) continue;
      const dutyType = await ctx.db.get(shift.dutyTypeRef);
      if (!dutyType) continue;
      const date = dateInWeek(shift, week);
      if (!date) continue;

      const handedOff = coverages.find(
        (c) => c.shiftRef === shift._id && c.date === date && c.absentTaRef === profile._id,
      );
      const excepted = exceptions.find((x) => isDateInRange(date, x.startDate, x.endDate));

      let state: "normal" | "off" | "excepted" = "normal";
      let otherName: string | null = null;
      let exceptionReason: string | null = null;
      if (handedOff) {
        state = "off";
        otherName = handedOff.coverTaRef
          ? await displayName(ctx, handedOff.coverTaRef)
          : null;
      } else if (excepted) {
        // Not acted on yet: the TA said they are away but still holds the slot.
        state = "excepted";
        exceptionReason = excepted.reason;
      }

      occurrences.push({
        key: `${assignment._id}:${date}`,
        date,
        day: dayOfIso(date),
        assignment,
        shift,
        dutyType,
        state,
        otherName,
        exceptionReason,
      });
    }

    // Meetings this TA is standing in for. These have no assignment of their
    // own — that is the whole point of a one-off swap — so the row carries a
    // null assignment and the schedule renders it from the shift.
    for (const coverage of coverages) {
      if (coverage.coverTaRef !== profile._id) continue;
      const shift = await ctx.db.get(coverage.shiftRef);
      if (!shift) continue;
      const dutyType = await ctx.db.get(shift.dutyTypeRef);
      if (!dutyType) continue;
      occurrences.push({
        key: `${coverage._id}:${coverage.date}`,
        date: coverage.date,
        day: dayOfIso(coverage.date),
        assignment: null,
        shift,
        dutyType,
        state: "covering" as const,
        otherName: await displayName(ctx, coverage.absentTaRef),
        exceptionReason: null,
      });
    }

    occurrences.sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        (a.shift.startMin ?? 0) - (b.shift.startMin ?? 0),
    );

    return {
      published: true,
      weekStart: week.start,
      weekEnd: week.end,
      occurrences,
      exceptions,
    };
  },
});

/* ------------------------------------------------------------------ */
/* Coordinator — the week overlay for the Builder                      */
/* ------------------------------------------------------------------ */

export const builderWeek = query({
  args: { periodRef: v.id("staffingPeriods"), weekStart: v.string() },
  returns: v.object({
    weekStart: v.string(),
    weekEnd: v.string(),
    /** Weekly shifts whose term does not cover this week. */
    dormantShiftRefs: v.array(v.id("shifts")),
    /** One-off shifts dated inside this week. */
    eventShiftRefs: v.array(v.id("shifts")),
    /** TAs away for part of the week, with the dates they are away. */
    absences: v.array(
      v.object({
        taProfileRef: v.id("taProfiles"),
        name: v.string(),
        reason: v.string(),
        dates: v.array(v.string()),
      }),
    ),
    /** Substitutions landing in this week. */
    coverages: v.array(
      v.object({
        _id: v.id("shiftCoverages"),
        shiftRef: v.id("shifts"),
        date: v.string(),
        day: v.union(v.null(), dayValidator),
        absentTaRef: v.id("taProfiles"),
        absentName: v.string(),
        coverTaRef: v.union(v.null(), v.id("taProfiles")),
        coverName: v.union(v.null(), v.string()),
      }),
    ),
  }),
  handler: async (ctx, args) => {
    assertWeekStart(args.weekStart);
    await requireCoordinator(ctx, args.periodRef);
    const week = weekRange(args.weekStart);

    const shifts = await ctx.db
      .query("shifts")
      .withIndex("by_period", (q) => q.eq("periodRef", args.periodRef))
      .collect();

    const dormantShiftRefs = shifts
      .filter((s) => s.recurrence === "weekly" && !weeklyShiftRunsInWeek(s, week))
      .map((s) => s._id);
    const eventShiftRefs = shifts
      .filter(
        (s) =>
          s.recurrence === "once" &&
          s.date !== undefined &&
          isDateInRange(s.date, week.start, week.end),
      )
      .map((s) => s._id);

    const profiles = await ctx.db
      .query("taProfiles")
      .withIndex("by_period", (q) => q.eq("periodRef", args.periodRef))
      .collect();

    const absences = [];
    for (const profile of profiles) {
      const exceptions = await ctx.db
        .query("dateExceptions")
        .withIndex("by_profile", (q) => q.eq("taProfileRef", profile._id))
        .collect();
      for (const x of exceptions) {
        const dates = week.days
          .map((d) => d.date)
          .filter((date) => isDateInRange(date, x.startDate, x.endDate));
        if (dates.length === 0) continue;
        absences.push({
          taProfileRef: profile._id,
          name: await displayName(ctx, profile._id),
          reason: x.reason,
          dates,
        });
      }
    }
    absences.sort((a, b) => a.name.localeCompare(b.name));

    const coverageRows = (
      await ctx.db
        .query("shiftCoverages")
        .withIndex("by_period", (q) => q.eq("periodRef", args.periodRef))
        .collect()
    ).filter((c) => isDateInRange(c.date, week.start, week.end));

    const coverages = [];
    for (const c of coverageRows) {
      coverages.push({
        _id: c._id,
        shiftRef: c.shiftRef,
        date: c.date,
        day: dayOfIso(c.date),
        absentTaRef: c.absentTaRef,
        absentName: await displayName(ctx, c.absentTaRef),
        coverTaRef: c.coverTaRef ?? null,
        coverName: c.coverTaRef ? await displayName(ctx, c.coverTaRef) : null,
      });
    }
    coverages.sort((a, b) => a.date.localeCompare(b.date));

    return {
      weekStart: week.start,
      weekEnd: week.end,
      dormantShiftRefs,
      eventShiftRefs,
      absences,
      coverages,
    };
  },
});
