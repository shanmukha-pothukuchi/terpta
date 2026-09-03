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
    const blocks = (
      await ctx.db
        .query("availabilityBlocks")
        .withIndex("by_profile", (q) => q.eq("taProfileRef", profile._id))
        .collect()
    ).filter((b) => b.day === day && overlaps(b.startMin, b.endMin, startMin, endMin));
    if (blocks.length === 0) continue;
    if (blocks.some((b) => b.status === "unavailable")) continue;

    const assignments = await ctx.db
      .query("assignments")
      .withIndex("by_profile", (q) => q.eq("taProfileRef", profile._id))
      .collect();
    if (assignments.some((a) => clashingShiftIds.has(a.shiftRef as string))) continue;
    if (assignments.some((a) => a.shiftRef === shift._id)) continue;

    out.push({
      taProfileRef: profile._id,
      name: await displayName(ctx, profile._id),
      fit: blocks.every((b) => b.status === "available") ? "available" : "prefer_not",
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
