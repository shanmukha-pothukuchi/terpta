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
import type { Id, TableNames } from "./_generated/dataModel";

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

/**
 * Stretch or shrink one TA's generated office-hour blocks, by hand.
 *
 * Internal, like the rest of this file: the board has no time editor, so a
 * coordinator who has agreed a longer Tuesday with one TA out of band has
 * nowhere to record it and ends up re-running the generator over a schedule
 * everybody has already read.
 *
 * Deltas are signed minutes, so a quarter hour on the end is
 * `{ endDeltaMin: 15 }` and a quarter hour off the front is
 * `{ startDeltaMin: -15 }`. Only blocks cut from a window are touched —
 * a discussion meets when it meets.
 *
 * Refuses rather than guesses: a block somebody else is also standing on, a
 * stretch past the edge of its own window, one that would collide with the
 * TA's own shifts, or one that would put the window over the heads the
 * coordinator asked for, all stop the whole run. Nothing is written unless
 * every block passes, and what it changed comes back so it can be put back.
 */
export const stretchOfficeHours = internalMutation({
  args: {
    /** Email, or enough of the TA's name to pick them out. */
    who: v.string(),
    periodRef: v.optional(v.id("staffingPeriods")),
    /** Which weekdays to touch. Absent means all of them. */
    days: v.optional(v.array(dayValidator)),
    /** Only blocks starting before this, in minutes from midnight. */
    startsBeforeMin: v.optional(v.number()),
    startDeltaMin: v.optional(v.number()),
    endDeltaMin: v.optional(v.number()),
    /** Report what would change and write nothing. */
    dryRun: v.optional(v.boolean()),
  },
  returns: v.array(
    v.object({
      day: dayValidator,
      description: v.string(),
      fromStartMin: v.number(),
      fromEndMin: v.number(),
      toStartMin: v.number(),
      toEndMin: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const startDelta = Math.round(args.startDeltaMin ?? 0);
    const endDelta = Math.round(args.endDeltaMin ?? 0);
    if (startDelta === 0 && endDelta === 0) {
      throw new ConvexError("Nothing to do: both deltas are zero");
    }

    const needle = args.who.trim().toLowerCase();
    const users = (await ctx.db.query("users").collect()).filter(
      (u) => u.email.toLowerCase() === needle || u.name.toLowerCase().includes(needle),
    );
    if (users.length === 0) throw new ConvexError(`Nobody matches "${args.who}"`);
    if (users.length > 1) {
      throw new ConvexError(
        `"${args.who}" matches ${users.map((u) => u.name).join(", ")} — use an email`,
      );
    }
    const user = users[0];

    const profiles = (await ctx.db.query("taProfiles").collect()).filter(
      (p) =>
        p.userRef === user._id &&
        (args.periodRef === undefined || p.periodRef === args.periodRef),
    );
    if (profiles.length === 0) throw new ConvexError(`${user.name} has no TA profile`);
    if (profiles.length > 1) {
      throw new ConvexError(
        `${user.name} is a TA in ${profiles.length} periods — pass periodRef`,
      );
    }
    const profile = profiles[0];

    const shifts = await ctx.db
      .query("shifts")
      .withIndex("by_period", (q) => q.eq("periodRef", profile.periodRef))
      .collect();
    const shiftById = new Map(shifts.map((s) => [s._id as string, s]));

    const assignments = (
      await ctx.db.query("assignments").collect()
    ).filter((a) => a.taProfileRef === profile._id && shiftById.has(a.shiftRef as string));
    const mine = assignments
      .map((a) => shiftById.get(a.shiftRef as string)!)
      .filter((s) => s.day !== undefined && s.startMin !== undefined && s.endMin !== undefined);

    const days = args.days;
    const targets = mine
      .filter((s) => s.windowRef !== undefined)
      .filter((s) => days === undefined || days.includes(s.day!))
      .filter((s) => args.startsBeforeMin === undefined || s.startMin! < args.startsBeforeMin)
      .sort((a, b) => a.startMin! - b.startMin!);
    if (targets.length === 0) {
      throw new ConvexError(`No office-hour blocks of ${user.name}'s match that`);
    }

    const overlaps = (aS: number, aE: number, bS: number, bE: number) => aS < bE && bS < aE;
    const moved = new Map<string, { startMin: number; endMin: number }>();
    const report = [];

    for (const block of targets) {
      const toStartMin = block.startMin! + startDelta;
      const toEndMin = block.endMin! + endDelta;
      const where = `${block.description ?? "Office hours"} ${block.day}`;
      if (toEndMin <= toStartMin) {
        throw new ConvexError(`${where} would end before it starts`);
      }

      // Everybody on a block shares its hours, so growing it grows theirs.
      const sharers = (await ctx.db.query("assignments").collect()).filter(
        (a) => a.shiftRef === block._id && a.taProfileRef !== profile._id,
      );
      if (sharers.length > 0) {
        throw new ConvexError(
          `${where} is shared with ${sharers.length} other TA(s) — split it first`,
        );
      }

      const window = await ctx.db.get(block.windowRef!);
      if (!window || window.startMin === undefined || window.endMin === undefined) {
        throw new ConvexError(`${where} has no window to sit in`);
      }
      if (toStartMin < window.startMin || toEndMin > window.endMin) {
        throw new ConvexError(
          `${where} would reach outside its window (${window.startMin}-${window.endMin})`,
        );
      }

      for (const other of mine) {
        if (other._id === block._id || other.day !== block.day) continue;
        const at = moved.get(other._id as string);
        const s = at?.startMin ?? other.startMin!;
        const e = at?.endMin ?? other.endMin!;
        if (overlaps(toStartMin, toEndMin, s, e)) {
          throw new ConvexError(`${where} would run into ${other.description ?? "another shift"}`);
        }
      }

      // The window's own ceiling on heads at once, counted over the stretch.
      let atOnce = 1;
      for (const other of shifts) {
        if (other._id === block._id) continue;
        if (String(other.windowRef) !== String(window._id) || other.day !== block.day) continue;
        const at = moved.get(other._id as string);
        const s = at?.startMin ?? other.startMin!;
        const e = at?.endMin ?? other.endMin!;
        if (overlaps(toStartMin, toEndMin, s, e)) atOnce += other.requiredCount;
      }
      if (atOnce > window.requiredCount) {
        throw new ConvexError(
          `${where} would put ${atOnce} TAs on a window that holds ${window.requiredCount}`,
        );
      }

      moved.set(block._id as string, { startMin: toStartMin, endMin: toEndMin });
      report.push({
        day: block.day!,
        description: block.description ?? "Office hours",
        fromStartMin: block.startMin!,
        fromEndMin: block.endMin!,
        toStartMin,
        toEndMin,
      });
    }

    if (args.dryRun === true) return report;
    for (const [shiftId, times] of moved) {
      await ctx.db.patch(shiftId as Id<"shifts">, times);
    }
    return report;
  },
});
