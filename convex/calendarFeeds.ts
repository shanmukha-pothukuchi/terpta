/**
 * Subscribable calendar feeds.
 *
 * The .ics download was a snapshot: a TA added it in September and it still
 * said September in November. A feed is a URL a calendar app keeps asking,
 * so a schedule that changes — published, regenerated, a shift moved — turns
 * up in the same calendar entry without anybody re-adding anything.
 *
 * The URL is the credential, as it is for every calendar feed: long, random,
 * unguessable, and revocable by rotating it. It carries no session, so it
 * keeps working in an app that has never heard of WorkOS, and it is
 * read-only. Nothing else in the app accepts it.
 */
import { ConvexError, v } from "convex/values";
import { internalQuery, mutation } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireCoordinator, requireOwnProfile } from "./lib/auth";

const feedKindValidator = v.union(v.literal("ta"), v.literal("course"));

/** 122 bits of randomness, dashes stripped, as the whole of the credential. */
function newSecret(): string {
  return `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, "");
}

/**
 * The caller's own schedule feed, made on first ask.
 *
 * A mutation rather than a query: asking for the address is what creates it,
 * and a TA who never opens the dialog never has one to leak.
 */
export const mine = mutation({
  args: { taProfileRef: v.id("taProfiles") },
  returns: v.object({ secret: v.string() }),
  handler: async (ctx, args) => {
    const { user, profile } = await requireOwnProfile(ctx, args.taProfileRef);
    const existing = (
      await ctx.db
        .query("calendarFeeds")
        .withIndex("by_period", (q) => q.eq("periodRef", profile.periodRef))
        .collect()
    ).find((f) => f.kind === "ta" && f.taProfileRef === args.taProfileRef);
    if (existing) return { secret: existing.secret };

    const secret = newSecret();
    await ctx.db.insert("calendarFeeds", {
      secret,
      kind: "ta",
      taProfileRef: args.taProfileRef,
      periodRef: profile.periodRef,
      createdBy: user._id,
      createdAt: Date.now(),
    });
    return { secret };
  },
});

/** The whole course's staffed week, for handing to students. */
export const forPeriod = mutation({
  args: { periodRef: v.id("staffingPeriods") },
  returns: v.object({ secret: v.string() }),
  handler: async (ctx, args) => {
    const { user } = await requireCoordinator(ctx, args.periodRef);
    const existing = (
      await ctx.db
        .query("calendarFeeds")
        .withIndex("by_period", (q) => q.eq("periodRef", args.periodRef))
        .collect()
    ).find((f) => f.kind === "course");
    if (existing) return { secret: existing.secret };

    const secret = newSecret();
    await ctx.db.insert("calendarFeeds", {
      secret,
      kind: "course",
      periodRef: args.periodRef,
      createdBy: user._id,
      createdAt: Date.now(),
    });
    return { secret };
  },
});

/**
 * Replace the address, which is the only way to take one back.
 *
 * Everyone subscribed to the old one stops receiving updates — that being
 * the point — so the dialog says so before it is offered.
 */
export const rotate = mutation({
  args: {
    kind: feedKindValidator,
    taProfileRef: v.optional(v.id("taProfiles")),
    periodRef: v.optional(v.id("staffingPeriods")),
  },
  returns: v.object({ secret: v.string() }),
  handler: async (ctx, args) => {
    let periodRef: Id<"staffingPeriods">;
    let owner: Doc<"users">;
    if (args.kind === "ta") {
      if (!args.taProfileRef) throw new ConvexError("taProfileRef is required");
      const { user, profile } = await requireOwnProfile(ctx, args.taProfileRef);
      periodRef = profile.periodRef;
      owner = user;
    } else {
      if (!args.periodRef) throw new ConvexError("periodRef is required");
      const { user } = await requireCoordinator(ctx, args.periodRef);
      periodRef = args.periodRef;
      owner = user;
    }

    const feeds = (
      await ctx.db
        .query("calendarFeeds")
        .withIndex("by_period", (q) => q.eq("periodRef", periodRef))
        .collect()
    ).filter((f) =>
      args.kind === "ta"
        ? f.kind === "ta" && f.taProfileRef === args.taProfileRef
        : f.kind === "course",
    );
    for (const feed of feeds) await ctx.db.delete(feed._id);

    const secret = newSecret();
    await ctx.db.insert("calendarFeeds", {
      secret,
      kind: args.kind,
      ...(args.taProfileRef ? { taProfileRef: args.taProfileRef } : {}),
      periodRef,
      createdBy: owner._id,
      createdAt: Date.now(),
    });
    return { secret };
  },
});

/** What a feed address points at. Used by the .ics route, nowhere else. */
export const resolve = internalQuery({
  args: { secret: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      kind: feedKindValidator,
      taProfileRef: v.optional(v.id("taProfiles")),
      periodRef: v.id("staffingPeriods"),
      published: v.boolean(),
    }),
  ),
  handler: async (ctx, args) => {
    if (args.secret.length < 24) return null;
    const feed = await ctx.db
      .query("calendarFeeds")
      .withIndex("by_secret", (q) => q.eq("secret", args.secret))
      .unique();
    if (!feed) return null;
    const period = await ctx.db.get(feed.periodRef);
    return {
      kind: feed.kind,
      ...(feed.taProfileRef ? { taProfileRef: feed.taProfileRef } : {}),
      periodRef: feed.periodRef,
      published: period?.status === "published",
    };
  },
});
