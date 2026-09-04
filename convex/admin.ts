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
import { blockStatusValidator, dayValidator } from "./schema";
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

/**
 * Replace one TA's painted availability.
 *
 * Internal, and manual blocks only: imported class times are facts about the
 * TA's schedule, not something a coordinator should be able to paint over
 * from here. TAs who cannot express a time in the editor — its grid is half
 * hours, so quarter-past starts are unsayable — end up mailing the real
 * answer instead, and this is how it gets recorded verbatim.
 */
export const setAvailability = internalMutation({
  args: {
    email: v.string(),
    periodRef: v.optional(v.id("staffingPeriods")),
    blocks: v.array(
      v.object({
        day: dayValidator,
        startMin: v.number(),
        endMin: v.number(),
        status: v.optional(blockStatusValidator),
      }),
    ),
  },
  returns: v.object({
    name: v.string(),
    removed: v.number(),
    inserted: v.number(),
    keptImported: v.number(),
  }),
  handler: async (ctx, args) => {
    for (const b of args.blocks) {
      if (b.endMin <= b.startMin) {
        throw new ConvexError(`${b.day} ${b.startMin}-${b.endMin} ends before it starts`);
      }
      if (b.startMin < 0 || b.endMin > 24 * 60) {
        throw new ConvexError("Times are minutes from midnight, 0 to 1440");
      }
    }

    const user = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", args.email.trim().toLowerCase()))
      .unique();
    if (!user) throw new ConvexError(`No user with email ${args.email}`);

    const profiles = (
      await ctx.db.query("taProfiles").collect()
    ).filter(
      (p) =>
        p.userRef === user._id &&
        (args.periodRef === undefined || p.periodRef === args.periodRef),
    );
    if (profiles.length === 0) throw new ConvexError(`${user.name} has no TA profile`);
    if (profiles.length > 1) {
      throw new ConvexError(`${user.name} is a TA in ${profiles.length} periods — pass periodRef`);
    }
    const profile = profiles[0];

    const existing = await ctx.db
      .query("availabilityBlocks")
      .withIndex("by_profile", (q) => q.eq("taProfileRef", profile._id))
      .collect();
    let removed = 0;
    let keptImported = 0;
    for (const block of existing) {
      if (block.source !== "manual") {
        keptImported += 1;
        continue;
      }
      await ctx.db.delete(block._id);
      removed += 1;
    }

    for (const b of args.blocks) {
      await ctx.db.insert("availabilityBlocks", {
        taProfileRef: profile._id,
        day: b.day,
        startMin: Math.round(b.startMin),
        endMin: Math.round(b.endMin),
        status: b.status ?? "available",
        source: "manual",
      });
    }
    // Painted time with no submission date reads as "never submitted" on the
    // roster, which would be a lie about a TA who just told you in words.
    if (profile.availabilitySubmittedAt === undefined && args.blocks.length > 0) {
      await ctx.db.patch(profile._id, { availabilitySubmittedAt: Date.now() });
    }

    return { name: user.name, removed, inserted: args.blocks.length, keptImported };
  },
});
