import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { roleValidator } from "./schema";
import { isAllowedEmail, requireUser } from "./lib/auth";

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
    if (!identity.email || !isAllowedEmail(identity.email)) return null;
    const user = await ctx.db
      .query("users")
      .withIndex("by_workos_id", (q) => q.eq("workosId", identity.subject))
      .unique();
    if (!user) return null; // not synced yet — caller retries

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
      throw new Error("Role already chosen — it cannot be changed");
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
      throw new Error("devSetRole is disabled on this deployment");
    }
    const { user } = await requireUser(ctx);
    await ctx.db.patch(user._id, { role: args.role });
    return null;
  },
});
