/**
 * One-off shift coverage.
 *
 * A date-scoped swap does not move the recurring assignment — the TA still has
 * that shift every other week — so "who is standing in on Oct 7" needs its own
 * record. Approving such a swap creates a `shiftCoverages` row; this module
 * lists them, ranks who could take them, and fills them either by hand or from
 * the rest of the pool.
 *
 * "Available and didn't say no that week" is exactly three checks: the TA's
 * weekly availability covers the shift's window, no date exception swallows
 * the date, and they are not already booked at that hour.
 */
import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { dayValidator } from "./schema";
import { requireCoordinator, requireUser } from "./lib/auth";
import { dayOfIso } from "./lib/week";
import { fitWindow } from "./lib/availability";

function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number) {
  return aStart < bEnd && bStart < aEnd;
}

const candidateValidator = v.object({
  taProfileRef: v.id("taProfiles"),
  name: v.string(),
  /** Best availability status across the shift window. */
  fit: v.union(v.literal("available"), v.literal("prefer_not")),
  /** Shifts already on their plate that week, for the tie-break. */
  assignedCount: v.number(),
});

const coverageValidator = v.object({
  _id: v.id("shiftCoverages"),
  shiftRef: v.id("shifts"),
  date: v.string(),
  day: v.union(v.null(), dayValidator),
  startMin: v.optional(v.number()),
  endMin: v.optional(v.number()),
  label: v.string(),
  absentTaRef: v.id("taProfiles"),
  absentName: v.string(),
  coverTaRef: v.union(v.null(), v.id("taProfiles")),
  coverName: v.union(v.null(), v.string()),
  filledBy: v.union(v.null(), v.literal("manual"), v.literal("auto")),
  reason: v.union(v.null(), v.string()),
});

async function displayName(
  ctx: QueryCtx | MutationCtx,
  profileRef: Id<"taProfiles">,
): Promise<string> {
  const profile = await ctx.db.get(profileRef);
  if (!profile) return "Unknown";
  const user = await ctx.db.get(profile.userRef);
  return user?.preferredName || user?.name || "Unknown";
}

async function shiftLabel(
  ctx: QueryCtx | MutationCtx,
  shift: Doc<"shifts"> | null,
): Promise<string> {
  if (!shift) return "Shift";
  const dutyType = await ctx.db.get(shift.dutyTypeRef);
  return shift.description ?? dutyType?.name ?? "Shift";
}

/** Coverage rows for a period, soonest date first. Coordinator only. */
export const list = query({
  args: { periodRef: v.id("staffingPeriods") },
  returns: v.array(coverageValidator),
  handler: async (ctx, args) => {
    await requireCoordinator(ctx, args.periodRef);
    const rows = await ctx.db
      .query("shiftCoverages")
      .withIndex("by_period", (q) => q.eq("periodRef", args.periodRef))
      .collect();

    const out = [];
    for (const row of rows) {
      const shift = await ctx.db.get(row.shiftRef);
      const swap = row.swapRef ? await ctx.db.get(row.swapRef) : null;
      out.push({
        _id: row._id,
        shiftRef: row.shiftRef,
        date: row.date,
        day: dayOfIso(row.date),
        startMin: shift?.startMin,
        endMin: shift?.endMin,
        label: await shiftLabel(ctx, shift),
        absentTaRef: row.absentTaRef,
        absentName: await displayName(ctx, row.absentTaRef),
        coverTaRef: row.coverTaRef ?? null,
        coverName: row.coverTaRef ? await displayName(ctx, row.coverTaRef) : null,
        filledBy: row.filledBy ?? null,
        reason: swap?.reason ?? null,
      });
    }
    out.sort((a, b) => a.date.localeCompare(b.date));
    return out;
  },
});

/**
 * Who could stand in, best first.
 *
 * Shared by the picker and by {@link autoFill} so the button and the list can
 * never disagree about who is eligible.
 */
async function rankCandidates(
  ctx: QueryCtx | MutationCtx,
  coverage: Doc<"shiftCoverages">,
) {
  const shift = await ctx.db.get(coverage.shiftRef);
  if (!shift || shift.day === undefined) return [];
  const startMin = shift.startMin ?? 0;
  const endMin = shift.endMin ?? 24 * 60;
  const day = shift.day;

  const profiles = await ctx.db
    .query("taProfiles")
    .withIndex("by_period", (q) => q.eq("periodRef", coverage.periodRef))
    .collect();

  // Everyone already spoken for at that hour on that date, so a fill-in is
  // never double-booked: regular assignments plus other fill-ins.
  const periodShifts = await ctx.db
    .query("shifts")
    .withIndex("by_period", (q) => q.eq("periodRef", coverage.periodRef))
    .collect();
  const clashingShiftIds = new Set(
    periodShifts
      .filter(
        (s) =>
          s._id !== shift._id &&
          s.day === day &&
          s.startMin !== undefined &&
          s.endMin !== undefined &&
          overlaps(s.startMin, s.endMin, startMin, endMin),
      )
      .map((s) => s._id as string),
  );
  const otherCoverages = (
    await ctx.db
      .query("shiftCoverages")
      .withIndex("by_period", (q) => q.eq("periodRef", coverage.periodRef))
      .collect()
  ).filter(
    (c) =>
      c._id !== coverage._id &&
      c.date === coverage.date &&
      c.coverTaRef !== undefined &&
      clashingShiftIds.has(c.shiftRef as string),
  );
  const busyFromCoverage = new Set(
    otherCoverages.map((c) => String(c.coverTaRef)),
  );

  const out: Array<{
    taProfileRef: Id<"taProfiles">;
    name: string;
    fit: "available" | "prefer_not";
    assignedCount: number;
  }> = [];

  for (const profile of profiles) {
    if (profile._id === coverage.absentTaRef) continue;
    if (busyFromCoverage.has(String(profile._id))) continue;

    // "Didn't say no that week" — a date exception spanning the date.
    const exceptions = await ctx.db
      .query("dateExceptions")
      .withIndex("by_profile", (q) => q.eq("taProfileRef", profile._id))
      .collect();
    if (
      exceptions.some(
        (x) => x.startDate <= coverage.date && coverage.date <= x.endDate,
      )
    ) {
      continue;
    }

    // Availability has to cover the whole window, and any "unavailable"
    // sliver inside it disqualifies them outright.
    const blocks = await ctx.db
      .query("availabilityBlocks")
      .withIndex("by_profile", (q) => q.eq("taProfileRef", profile._id))
      .collect();
    const fit = fitWindow(blocks, day, startMin, endMin);
    if (fit === "unavailable") continue;

    const assignments = await ctx.db
      .query("assignments")
      .withIndex("by_profile", (q) => q.eq("taProfileRef", profile._id))
      .collect();
    if (assignments.some((a) => clashingShiftIds.has(a.shiftRef as string))) continue;
    if (assignments.some((a) => a.shiftRef === shift._id)) continue;

    out.push({
      taProfileRef: profile._id,
      name: await displayName(ctx, profile._id),
      fit,
      assignedCount: assignments.length,
    });
  }

  out.sort(
    (a, b) =>
      (a.fit === b.fit ? 0 : a.fit === "available" ? -1 : 1) ||
      a.assignedCount - b.assignedCount ||
      a.name.localeCompare(b.name),
  );
  return out;
}

export const candidates = query({
  args: { coverageRef: v.id("shiftCoverages") },
  returns: v.array(candidateValidator),
  handler: async (ctx, args) => {
    const coverage = await ctx.db.get(args.coverageRef);
    if (!coverage) throw new ConvexError("Coverage not found");
    await requireCoordinator(ctx, coverage.periodRef);
    return await rankCandidates(ctx, coverage);
  },
});

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Open a one-off hole for a TA who is away on a date, and optionally fill it
 * in the same step.
 *
 * Until now a hole only came from an approved date-scoped swap. A TA who
 * marked the date as an exception on their availability made no request, so
 * there was no hole to drop a stand-in into — and a name dropped on the slot
 * joined it every week for the rest of term. This is the record that drop
 * writes instead. Idempotent on (shift, date, absent TA): opening twice fills
 * the same hole rather than making a second one.
 */
export const open = mutation({
  args: {
    shiftRef: v.id("shifts"),
    date: v.string(),
    absentTaRef: v.id("taProfiles"),
    coverTaRef: v.optional(v.id("taProfiles")),
  },
  returns: v.id("shiftCoverages"),
  handler: async (ctx, args) => {
    const shift = await ctx.db.get(args.shiftRef);
    if (!shift) throw new ConvexError("Shift not found");
    const { user } = await requireCoordinator(ctx, shift.periodRef);
    if (!ISO_DATE.test(args.date)) throw new ConvexError("date must be ISO YYYY-MM-DD");

    // The shift has to actually meet on that date.
    if (shift.recurrence === "weekly") {
      if (dayOfIso(args.date) !== shift.day) {
        throw new ConvexError("This shift does not meet on that day");
      }
      if (
        (shift.startDate !== undefined && args.date < shift.startDate) ||
        (shift.endDate !== undefined && args.date > shift.endDate)
      ) {
        throw new ConvexError("This shift does not run on that date");
      }
    } else if (shift.recurrence === "once") {
      if (shift.date !== args.date) throw new ConvexError("This event is not on that date");
    } else {
      throw new ConvexError("Only a shift with a meeting time can be covered");
    }

    const seats = await ctx.db
      .query("assignments")
      .withIndex("by_shift", (q) => q.eq("shiftRef", shift._id))
      .collect();
    if (!seats.some((a) => a.taProfileRef === args.absentTaRef)) {
      throw new ConvexError("That TA is not on this shift");
    }
    if (args.coverTaRef !== undefined) {
      if (args.coverTaRef === args.absentTaRef) {
        throw new ConvexError("That TA is the one who is out");
      }
      const cover = await ctx.db.get(args.coverTaRef);
      if (!cover || cover.periodRef !== shift.periodRef) {
        throw new ConvexError("That TA is not in this course");
      }
    }

    const existing = (
      await ctx.db
        .query("shiftCoverages")
        .withIndex("by_shift_date", (q) => q.eq("shiftRef", shift._id).eq("date", args.date))
        .collect()
    ).find((c) => c.absentTaRef === args.absentTaRef);

    let coverageRef: Id<"shiftCoverages">;
    if (existing) {
      coverageRef = existing._id;
      await ctx.db.patch(existing._id, {
        coverTaRef: args.coverTaRef,
        filledBy: args.coverTaRef ? ("manual" as const) : undefined,
      });
    } else {
      coverageRef = await ctx.db.insert("shiftCoverages", {
        periodRef: shift.periodRef,
        shiftRef: shift._id,
        date: args.date,
        absentTaRef: args.absentTaRef,
        ...(args.coverTaRef !== undefined
          ? { coverTaRef: args.coverTaRef, filledBy: "manual" as const }
          : {}),
      });
    }
    await ctx.db.insert("changeLog", {
      periodRef: shift.periodRef,
      actorRef: user._id,
      action: "coverage.open",
      before: existing
        ? { coverageRef, coverTaRef: existing.coverTaRef ?? null }
        : null,
      after: {
        coverageRef,
        shiftRef: shift._id,
        date: args.date,
        absentTaRef: args.absentTaRef,
        coverTaRef: args.coverTaRef ?? null,
      },
      at: Date.now(),
    });
    return coverageRef;
  },
});

/**
 * Take a hole back off the week. The inverse of `open`, for Undo; a hole an
 * approved swap made stays, since the request it answers is still approved.
 */
export const remove = mutation({
  args: { coverageRef: v.id("shiftCoverages") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const coverage = await ctx.db.get(args.coverageRef);
    if (!coverage) return null;
    const { user } = await requireCoordinator(ctx, coverage.periodRef);
    if (coverage.swapRef !== undefined) {
      throw new ConvexError("This cover came from an approved swap; clear the fill-in instead");
    }
    await ctx.db.delete(coverage._id);
    await ctx.db.insert("changeLog", {
      periodRef: coverage.periodRef,
      actorRef: user._id,
      action: "coverage.remove",
      before: {
        coverageRef: coverage._id,
        shiftRef: coverage.shiftRef,
        date: coverage.date,
        absentTaRef: coverage.absentTaRef,
        coverTaRef: coverage.coverTaRef ?? null,
      },
      after: null,
      at: Date.now(),
    });
    return null;
  },
});

/** Pick the fill-in by hand, or clear it by passing no TA. */
export const setCover = mutation({
  args: {
    coverageRef: v.id("shiftCoverages"),
    coverTaRef: v.optional(v.id("taProfiles")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const coverage = await ctx.db.get(args.coverageRef);
    if (!coverage) throw new ConvexError("Coverage not found");
    const { user } = await requireCoordinator(ctx, coverage.periodRef);
    if (args.coverTaRef === coverage.absentTaRef) {
      throw new ConvexError("That TA is the one who is out");
    }
    await ctx.db.patch(coverage._id, {
      coverTaRef: args.coverTaRef,
      filledBy: args.coverTaRef ? ("manual" as const) : undefined,
    });
    await ctx.db.insert("changeLog", {
      periodRef: coverage.periodRef,
      actorRef: user._id,
      action: args.coverTaRef ? "coverage.fill" : "coverage.clear",
      before: { coverageRef: coverage._id, coverTaRef: coverage.coverTaRef ?? null },
      after: { coverageRef: coverage._id, coverTaRef: args.coverTaRef ?? null },
      at: Date.now(),
    });
    return null;
  },
});

/** Take the top-ranked eligible TA. Returns null when nobody qualifies. */
export const autoFill = mutation({
  args: { coverageRef: v.id("shiftCoverages") },
  returns: v.union(v.null(), v.object({ taProfileRef: v.id("taProfiles"), name: v.string() })),
  handler: async (ctx, args) => {
    const coverage = await ctx.db.get(args.coverageRef);
    if (!coverage) throw new ConvexError("Coverage not found");
    const { user } = await requireCoordinator(ctx, coverage.periodRef);
    const ranked = await rankCandidates(ctx, coverage);
    const best = ranked[0];
    if (!best) return null;
    await ctx.db.patch(coverage._id, {
      coverTaRef: best.taProfileRef,
      filledBy: "auto",
    });
    await ctx.db.insert("changeLog", {
      periodRef: coverage.periodRef,
      actorRef: user._id,
      action: "coverage.autofill",
      before: { coverageRef: coverage._id, coverTaRef: coverage.coverTaRef ?? null },
      after: { coverageRef: coverage._id, coverTaRef: best.taProfileRef },
      at: Date.now(),
    });
    return { taProfileRef: best.taProfileRef, name: best.name };
  },
});

/**
 * The caller's own one-off coverage, both directions: dates they are off and
 * dates they are standing in for somebody. Drives the TA Schedule notices.
 */
export const mine = query({
  args: { periodRef: v.id("staffingPeriods") },
  returns: v.array(
    v.object({
      _id: v.id("shiftCoverages"),
      date: v.string(),
      label: v.string(),
      startMin: v.optional(v.number()),
      endMin: v.optional(v.number()),
      role: v.union(v.literal("covering"), v.literal("off")),
      otherName: v.union(v.null(), v.string()),
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

    const rows = await ctx.db
      .query("shiftCoverages")
      .withIndex("by_period", (q) => q.eq("periodRef", args.periodRef))
      .collect();

    const out = [];
    for (const row of rows) {
      const covering = row.coverTaRef === profile._id;
      const off = row.absentTaRef === profile._id;
      if (!covering && !off) continue;
      const shift = await ctx.db.get(row.shiftRef);
      const other = covering ? row.absentTaRef : row.coverTaRef;
      out.push({
        _id: row._id,
        date: row.date,
        label: await shiftLabel(ctx, shift),
        startMin: shift?.startMin,
        endMin: shift?.endMin,
        role: covering ? ("covering" as const) : ("off" as const),
        otherName: other ? await displayName(ctx, other) : null,
      });
    }
    out.sort((a, b) => a.date.localeCompare(b.date));
    return out;
  },
});
