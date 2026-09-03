import { ConvexError, v } from "convex/values";
import { action, internalMutation, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { roleValidator } from "./schema";
import { isAllowedEmail, requireUser } from "./lib/auth";
import { syncUser } from "./lib/syncUser";

// The Convex runtime exposes process.env; the convex tsconfig has no node
// types, so declare the little we use.
declare const process: { env: Record<string, string | undefined> };

/**
 * The signed-in user's doc plus (if TA) their profile ids.
 *
 * Returns null (never throws) when:
 *  - nobody is signed in,
 *  - the identity's email is not a UMD domain,
 *  - the users row has not been synced yet (frontend polls this right after
 *    login while the WorkOS webhook / sync catches up).
 */
export const current = query({
  args: {},
  returns: v.union(
    v.null(),
    v.object({
      _id: v.id("users"),
      _creationTime: v.number(),
      workosId: v.string(),
      email: v.string(),
      name: v.string(),
      role: v.optional(roleValidator),
      /** Empty unless role === "ta". */
      taProfiles: v.array(
        v.object({
          taProfileId: v.id("taProfiles"),
          periodRef: v.id("staffingPeriods"),
        }),
      ),
    }),
  ),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const user = await ctx.db
      .query("users")
      .withIndex("by_workos_id", (q) => q.eq("workosId", identity.subject))
      .unique();
    if (!user) return null; // not synced yet — caller runs syncSelf
    // Access tokens carry no email claim; gate on the synced address instead.
    if (!isAllowedEmail(user.email)) return null;

    const profiles =
      user.role === "ta"
        ? await ctx.db
            .query("taProfiles")
            .withIndex("by_user_period", (q) => q.eq("userRef", user._id))
            .collect()
        : [];
    const taProfiles = profiles.map((p) => ({
      taProfileId: p._id,
      periodRef: p.periodRef,
    }));

    return { ...user, taProfiles };
  },
});

/** One-time role selection after first login. No-op path is an error: role is immutable once set. */
export const chooseRole = mutation({
  args: { role: roleValidator },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { user } = await requireUser(ctx);
    if (user.role !== undefined) {
      throw new ConvexError("Role already chosen — it cannot be changed");
    }
    await ctx.db.patch(user._id, { role: args.role });
    return null;
  },
});

/**
 * DEV ONLY. Force-switch the caller's role for local testing.
 * Enabled only when the deployment env var ALLOW_DEV_ROLE_SWITCH === "true".
 */
export const devSetRole = mutation({
  args: { role: roleValidator },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (process.env.ALLOW_DEV_ROLE_SWITCH !== "true") {
      throw new ConvexError("devSetRole is disabled on this deployment");
    }
    const { user } = await requireUser(ctx);
    await ctx.db.patch(user._id, { role: args.role });
    return null;
  },
});

/**
 * Create/refresh the caller's `users` row straight from the WorkOS Management
 * API.
 *
 * The user.created webhook is the steady-state path, but it cannot cover first
 * sign-in on a fresh deployment (or any window where the webhook is
 * misconfigured), which would strand the user on "Finishing account setup".
 * The frontend calls this whenever `users.current` comes back null.
 *
 * The WorkOS id comes from the verified access token's `sub`, never from the
 * client, so a caller can only ever sync themselves.
 */
export const syncSelf = action({
  args: {},
  returns: v.null(),
  handler: async (ctx): Promise<null> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Not signed in");

    const apiKey = process.env.WORKOS_API_KEY;
    if (!apiKey) throw new ConvexError("WORKOS_API_KEY is not set on this deployment");

    const res = await fetch(
      `https://api.workos.com/user_management/users/${identity.subject}`,
      { headers: { Authorization: `Bearer ${apiKey}` } },
    );
    if (!res.ok) {
      throw new ConvexError(`WorkOS user lookup failed (${res.status})`);
    }
    const workosUser = (await res.json()) as {
      id: string;
      email: string;
      first_name?: string | null;
      last_name?: string | null;
    };

    await ctx.runMutation(internal.users.upsertFromWorkos, {
      workosId: workosUser.id,
      email: workosUser.email,
      firstName: workosUser.first_name ?? undefined,
      lastName: workosUser.last_name ?? undefined,
    });
    return null;
  },
});

/** Internal half of `syncSelf` (actions cannot touch the database directly). */
export const upsertFromWorkos = internalMutation({
  args: {
    workosId: v.string(),
    email: v.string(),
    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (!isAllowedEmail(args.email)) {
      throw new ConvexError(
        "TerpTA is restricted to umd.edu and terpmail.umd.edu accounts",
      );
    }
    await syncUser(ctx, {
      id: args.workosId,
      email: args.email,
      firstName: args.firstName,
      lastName: args.lastName,
    });
    return null;
  },
});
