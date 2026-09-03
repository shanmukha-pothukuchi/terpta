/**
 * Wipe a deployment back to empty.
 *
 * Internal on purpose: nothing in the app can call this, and it does not
 * appear in the client API. It is run by hand from the Convex dashboard
 * (Functions → admin:resetAll → Run) against the deployment you are looking
 * at, which is the only place a decision like this should be made.
 *
 * Every table in the schema is cleared, users included — the coordinator's
 * own row comes back on the next sign-in through the WorkOS sync, with the
 * role chosen again. The typed-out confirmation is there because the
 * dashboard's Run button is one click from the argument box.
 */
import { ConvexError, v } from "convex/values";
import { internalMutation } from "./_generated/server";
import type { TableNames } from "./_generated/dataModel";

const TABLES: TableNames[] = [
  "hourLogs",
  "shiftCoverages",
  "swapRequests",
  "assignments",
  "changeLog",
  "dateExceptions",
  "availabilityBlocks",
  "shifts",
  "dutyTypes",
  "taProfiles",
  "staffingPeriods",
  "sections",
  "courses",
  "users",
];

export const resetAll = internalMutation({
  args: { confirm: v.string() },
  returns: v.object({ deleted: v.record(v.string(), v.number()) }),
  handler: async (ctx, args) => {
    if (args.confirm !== "RESET") {
      throw new ConvexError('Pass { "confirm": "RESET" } to wipe every table');
    }
    const deleted: Record<string, number> = {};
    for (const table of TABLES) {
      const rows = await ctx.db.query(table).collect();
      for (const row of rows) await ctx.db.delete(row._id);
      deleted[table] = rows.length;
    }
    return { deleted };
  },
});
