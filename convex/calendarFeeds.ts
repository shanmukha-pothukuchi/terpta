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
 *
 * A TA has one feed: their shifts. A course can have any number, each
 * carrying a chosen set of duty types — everything for the syllabus, office
 * hours alone for the students who only want those, discussions for a
 * section page — so what students see is decided per link, not per course.
 */
import { ConvexError, v } from "convex/values";
import {
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireCoordinator, requireOwnProfile } from "./lib/auth";

const feedKindValidator = v.union(v.literal("ta"), v.literal("course"));

/** 122 bits of randomness, dashes stripped, as the whole of the credential. */
function newSecret(): string {
  return `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, "");
}

const MAX_LABEL = 60;

function cleanLabel(label: string | undefined): string | undefined {
  const trimmed = label?.trim();
  return trimmed ? trimmed.slice(0, MAX_LABEL) : undefined;
}

/**
 * The duty types a course feed should carry, checked against the period.
 *
 * Absent means everything. An empty list is refused rather than stored: a
 * link that carries nothing is a mistake, not a choice.
 */
async function cleanDutyTypeRefs(
  ctx: QueryCtx | MutationCtx,
  periodRef: Id<"staffingPeriods">,
  refs: Id<"dutyTypes">[] | undefined,
): Promise<Id<"dutyTypes">[] | undefined> {
  if (refs === undefined) return undefined;
  const unique = [...new Set(refs)];
  if (unique.length === 0) {
    throw new ConvexError("Pick at least one kind of work for the link to carry");
  }
  for (const ref of unique) {
    const duty = await ctx.db.get(ref);
    if (!duty || duty.periodRef !== periodRef) {
      throw new ConvexError("That duty type is not part of this period");
    }
  }
  return unique;
}

const courseFeedValidator = v.object({
  _id: v.id("calendarFeeds"),
  secret: v.string(),
  label: v.optional(v.string()),
  dutyTypeRefs: v.optional(v.array(v.id("dutyTypes"))),
  createdAt: v.number(),
});

async function requireCourseFeed(
  ctx: QueryCtx | MutationCtx,
  feedRef: Id<"calendarFeeds">,
) {
  const feed = await ctx.db.get(feedRef);
  if (!feed || feed.kind !== "course") throw new ConvexError("Calendar link not found");
  const { user } = await requireCoordinator(ctx, feed.periodRef);
  return { user, feed };
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

/** Every course feed of a period, oldest first, for the coordinator's dialog. */
export const listForPeriod = query({
  args: { periodRef: v.id("staffingPeriods") },
  returns: v.array(courseFeedValidator),
  handler: async (ctx, args) => {
    await requireCoordinator(ctx, args.periodRef);
    const feeds = await ctx.db
      .query("calendarFeeds")
      .withIndex("by_period", (q) => q.eq("periodRef", args.periodRef))
      .collect();
    return feeds
      .filter((f) => f.kind === "course")
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((f) => ({
        _id: f._id,
        secret: f.secret,
        ...(f.label !== undefined ? { label: f.label } : {}),
        ...(f.dutyTypeRefs !== undefined ? { dutyTypeRefs: f.dutyTypeRefs } : {}),
        createdAt: f.createdAt,
      }));
  },
});

/**
 * A new course feed. Each call makes another: a course hands out as many
 * links as it has audiences.
 */
export const createForPeriod = mutation({
  args: {
    periodRef: v.id("staffingPeriods"),
    label: v.optional(v.string()),
    /** Absent for everything. */
    dutyTypeRefs: v.optional(v.array(v.id("dutyTypes"))),
  },
  returns: v.object({ feedRef: v.id("calendarFeeds"), secret: v.string() }),
  handler: async (ctx, args) => {
    const { user } = await requireCoordinator(ctx, args.periodRef);
    const label = cleanLabel(args.label);
    const dutyTypeRefs = await cleanDutyTypeRefs(ctx, args.periodRef, args.dutyTypeRefs);

    const secret = newSecret();
    const feedRef = await ctx.db.insert("calendarFeeds", {
      secret,
      kind: "course",
      periodRef: args.periodRef,
      ...(label !== undefined ? { label } : {}),
      ...(dutyTypeRefs !== undefined ? { dutyTypeRefs } : {}),
      createdBy: user._id,
      createdAt: Date.now(),
    });
    return { feedRef, secret };
  },
});

/**
 * Change what a course feed carries, or what it is called, keeping its
 * address. Everyone already subscribed sees the new set on their next poll,
 * which is the point of editing rather than replacing.
 */
export const update = mutation({
  args: {
    feedRef: v.id("calendarFeeds"),
    label: v.optional(v.string()),
    /** Absent for everything. */
    dutyTypeRefs: v.optional(v.array(v.id("dutyTypes"))),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { feed } = await requireCourseFeed(ctx, args.feedRef);
    const label = cleanLabel(args.label);
    const dutyTypeRefs = await cleanDutyTypeRefs(ctx, feed.periodRef, args.dutyTypeRefs);
    // An undefined field in a patch clears it, which is how "everything"
    // and "no name" are stored.
    await ctx.db.patch(args.feedRef, { label, dutyTypeRefs });
    return null;
  },
});

/** Take a course feed back for good. Everyone subscribed stops receiving. */
export const remove = mutation({
  args: { feedRef: v.id("calendarFeeds") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireCourseFeed(ctx, args.feedRef);
    await ctx.db.delete(args.feedRef);
    return null;
  },
});

/**
 * Replace the address, which is the only way to take one back from the
 * people who have it while keeping it for yourself.
 *
 * Everyone subscribed to the old one stops receiving updates — that being
 * the point — so the dialog says so before it is offered. A course feed
 * keeps its label and its set of duty types under the new address.
 */
export const rotate = mutation({
  args: {
    kind: feedKindValidator,
    taProfileRef: v.optional(v.id("taProfiles")),
    feedRef: v.optional(v.id("calendarFeeds")),
  },
  returns: v.object({ secret: v.string() }),
  handler: async (ctx, args) => {
    const secret = newSecret();

    if (args.kind === "course") {
      if (!args.feedRef) throw new ConvexError("feedRef is required");
      const { feed } = await requireCourseFeed(ctx, args.feedRef);
      await ctx.db.patch(feed._id, { secret });
      return { secret };
    }

    if (!args.taProfileRef) throw new ConvexError("taProfileRef is required");
    const { user, profile } = await requireOwnProfile(ctx, args.taProfileRef);
    const feeds = (
      await ctx.db
        .query("calendarFeeds")
        .withIndex("by_period", (q) => q.eq("periodRef", profile.periodRef))
        .collect()
    ).filter((f) => f.kind === "ta" && f.taProfileRef === args.taProfileRef);
    for (const feed of feeds) await ctx.db.delete(feed._id);

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

/** What a feed address points at. Used by the .ics route, nowhere else. */
export const resolve = internalQuery({
  args: { secret: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      kind: feedKindValidator,
      taProfileRef: v.optional(v.id("taProfiles")),
      periodRef: v.id("staffingPeriods"),
      label: v.optional(v.string()),
      dutyTypeRefs: v.optional(v.array(v.id("dutyTypes"))),
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
      ...(feed.label !== undefined ? { label: feed.label } : {}),
      ...(feed.dutyTypeRefs !== undefined ? { dutyTypeRefs: feed.dutyTypeRefs } : {}),
      published: period?.status === "published",
    };
  },
});
