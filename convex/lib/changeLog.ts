/**
 * Writing to the change log.
 *
 * The log started as a coordinator's record of their own post-publish edits,
 * so every write was a bare `ctx.db.insert` next to the thing it described.
 * Now that a TA withdrawing a swap or submitting a week lands in the same
 * list, the row has to say which side of the course made it. Routing the TA
 * side through one function is what keeps that from being a field somebody
 * forgets on the next mutation they add.
 */
import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";

/**
 * Record a change a TA made.
 *
 * Coordinator writes still insert directly and leave `actorRole` unset, which
 * the log reads as "coordinator" — see the schema. Only the TA side has to
 * say so explicitly, because a row that does not is assumed to be the other.
 */
export async function recordTaChange(
  ctx: MutationCtx,
  periodRef: Id<"staffingPeriods">,
  actorRef: Id<"users">,
  action: string,
  before: unknown,
  after: unknown,
): Promise<void> {
  await ctx.db.insert("changeLog", {
    periodRef,
    actorRef,
    actorRole: "ta",
    action,
    before,
    after,
    at: Date.now(),
  });
}
