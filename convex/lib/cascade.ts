/**
 * What has to go when a shift goes.
 *
 * A shift is referenced from four other tables, and deleting one used to take
 * only its assignments. The rest were left pointing at a row that no longer
 * exists: one-off coverages kept a hole open on a meeting that no longer
 * happens, and pending swap requests still asked the coordinator to approve a
 * handover of nothing. Neither surfaces as an error — they surface as rows
 * that cannot be acted on and cannot be cleared.
 *
 * Hour logs are the exception, and the reason this is a module rather than a
 * few more deletes inline. A log the TA has submitted is a claim for pay; an
 * approved one is a record that pay was granted. Those are not scheduling
 * state and deleting a shift must not quietly destroy them, so a shift that
 * carries any is refused rather than cascaded. Draft logs have been claimed by
 * nobody and go with the rest.
 */
import { ConvexError } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

export interface ShiftCascade {
  assignments: Doc<"assignments">[];
  coverages: Doc<"shiftCoverages">[];
  /** Pending requests only: resolved ones are history and are left alone. */
  pendingSwaps: Doc<"swapRequests">[];
  draftLogs: Doc<"hourLogs">[];
  /** Submitted, approved or flagged hours. Never deleted; they block instead. */
  claimedLogs: Doc<"hourLogs">[];
  /**
   * Office-hour blocks cut from this window by the generator. They exist only
   * because the window does, so they go with it — otherwise they linger on
   * the board and in TA schedules with nothing to regenerate them from.
   */
  windowBlocks: Doc<"shifts">[];
}

export async function collectShiftCascade(
  ctx: QueryCtx,
  shift: Doc<"shifts">,
): Promise<ShiftCascade> {
  // A window is deleted with its own output. One level deep only: a block is
  // never itself a window.
  const windowBlocks =
    shift.windowRef === undefined
      ? (
          await ctx.db
            .query("shifts")
            .withIndex("by_period", (q) => q.eq("periodRef", shift.periodRef))
            .collect()
        ).filter((s) => String(s.windowRef ?? "") === String(shift._id))
      : [];

  const assignments = await ctx.db
    .query("assignments")
    .withIndex("by_shift", (q) => q.eq("shiftRef", shift._id))
    .collect();

  const coverages = (
    await ctx.db
      .query("shiftCoverages")
      .withIndex("by_shift_date", (q) => q.eq("shiftRef", shift._id))
      .collect()
  ).filter((c) => c.shiftRef === shift._id);

  const draftLogs: Doc<"hourLogs">[] = [];
  const claimedLogs: Doc<"hourLogs">[] = [];
  for (const assignment of assignments) {
    const logs = await ctx.db
      .query("hourLogs")
      .withIndex("by_assignment", (q) => q.eq("assignmentRef", assignment._id))
      .collect();
    for (const log of logs) {
      if (log.status === "draft") draftLogs.push(log);
      else claimedLogs.push(log);
    }
  }

  // swapRequests has no by-assignment index, and a swap can point at the shift
  // directly (the snapshot taken at request time) as well as through its
  // assignment, so both routes have to be checked.
  const assignmentIds = new Set(assignments.map((a) => String(a._id)));
  const pendingSwaps = (
    await ctx.db
      .query("swapRequests")
      .withIndex("by_period", (q) => q.eq("periodRef", shift.periodRef))
      .collect()
  ).filter(
    (s) =>
      s.status === "pending" &&
      (String(s.shiftRef ?? "") === String(shift._id) ||
        assignmentIds.has(String(s.assignmentRef))),
  );

  const cascade: ShiftCascade = {
    assignments,
    coverages,
    pendingSwaps,
    draftLogs,
    claimedLogs,
    windowBlocks,
  };
  for (const block of windowBlocks) {
    const inner = await collectShiftCascade(ctx, block);
    cascade.assignments.push(...inner.assignments);
    cascade.coverages.push(...inner.coverages);
    cascade.pendingSwaps.push(...inner.pendingSwaps);
    cascade.draftLogs.push(...inner.draftLogs);
    cascade.claimedLogs.push(...inner.claimedLogs);
  }
  return cascade;
}

/**
 * Refuse the delete when hours have been claimed against it.
 *
 * Said with the count and the shift's own name, because "cannot delete" with
 * nothing to act on is the kind of error that gets worked around by deleting
 * something else instead.
 */
export function assertNoClaimedHours(label: string, cascade: ShiftCascade) {
  const n = cascade.claimedLogs.length;
  if (n === 0) return;
  throw new ConvexError(
    `${label} has ${n} logged hour ${n === 1 ? "entry" : "entries"} on it. ` +
      "Those are a record of work claimed or paid, so they are not deleted " +
      "automatically — clear them from the Hours screen first.",
  );
}

export interface CascadeCounts {
  assignments: number;
  coverages: number;
  pendingSwaps: number;
  draftLogs: number;
  windowBlocks: number;
}

/** Delete a shift and everything that only existed because of it. */
export async function deleteShiftCascade(
  ctx: MutationCtx,
  shift: Doc<"shifts">,
  cascade: ShiftCascade,
): Promise<CascadeCounts> {
  for (const log of cascade.draftLogs) await ctx.db.delete(log._id);
  for (const swap of cascade.pendingSwaps) await ctx.db.delete(swap._id);
  for (const coverage of cascade.coverages) await ctx.db.delete(coverage._id);
  for (const assignment of cascade.assignments) await ctx.db.delete(assignment._id);
  for (const block of cascade.windowBlocks) await ctx.db.delete(block._id);
  await ctx.db.delete(shift._id);
  return {
    assignments: cascade.assignments.length,
    coverages: cascade.coverages.length,
    pendingSwaps: cascade.pendingSwaps.length,
    draftLogs: cascade.draftLogs.length,
    windowBlocks: cascade.windowBlocks.length,
  };
}

/** Sum of several cascades, for a duty type that owns many shifts. */
export function totalCounts(all: CascadeCounts[]): CascadeCounts {
  return all.reduce(
    (acc, c) => ({
      assignments: acc.assignments + c.assignments,
      coverages: acc.coverages + c.coverages,
      pendingSwaps: acc.pendingSwaps + c.pendingSwaps,
      draftLogs: acc.draftLogs + c.draftLogs,
      windowBlocks: acc.windowBlocks + c.windowBlocks,
    }),
    { assignments: 0, coverages: 0, pendingSwaps: 0, draftLogs: 0, windowBlocks: 0 },
  );
}

/** "Discussion 0101" / "Midterm 1 proctoring" / a fallback naming the day. */
export function shiftLabel(shift: Doc<"shifts">): string {
  if (shift.description) return shift.description;
  if (shift.recurrence === "once" && shift.date) return `The event on ${shift.date}`;
  return "That shift";
}
