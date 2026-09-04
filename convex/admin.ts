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

/**
 * Set the weekly hour cap on every TA of a period, with named exceptions.
 *
 * Internal, like {@link resetAll}: a cap is the TA's own answer on their
 * preferences form, so nothing in the app overwrites it in bulk. A
 * coordinator who has agreed new caps out of band runs this by hand and
 * gets back what every row was before, so it can be put back.
 */
export const setMaxHoursPerWeek = internalMutation({
  args: {
    periodRef: v.optional(v.id("staffingPeriods")),
    hours: v.number(),
    /** Email → hours, for the TAs who are not on the common number. */
    overrides: v.optional(v.array(v.object({ email: v.string(), hours: v.number() }))),
  },
  returns: v.array(
    v.object({ email: v.string(), name: v.string(), from: v.number(), to: v.number() }),
  ),
  handler: async (ctx, args) => {
    if (args.hours < 0) throw new ConvexError("hours must be >= 0");
    const byEmail = new Map(
      (args.overrides ?? []).map((o) => [o.email.trim().toLowerCase(), o.hours]),
    );

    const profiles = args.periodRef
      ? await ctx.db
          .query("taProfiles")
          .withIndex("by_period", (q) => q.eq("periodRef", args.periodRef!))
          .collect()
      : await ctx.db.query("taProfiles").collect();

    const changed = [];
    for (const profile of profiles) {
      const user = await ctx.db.get(profile.userRef);
      const email = user?.email ?? "";
      const to = byEmail.get(email.trim().toLowerCase()) ?? args.hours;
      if (to < 0) throw new ConvexError(`hours must be >= 0 for ${email}`);
      const from = profile.maxHoursPerWeek;
      if (from === to) continue;
      await ctx.db.patch(profile._id, { maxHoursPerWeek: to });
      changed.push({ email, name: user?.name ?? "Unknown", from, to });
    }
    return changed;
  },
});
