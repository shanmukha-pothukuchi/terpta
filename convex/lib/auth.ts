import { ConvexError } from "convex/values";
import type { Id } from "../_generated/dataModel";
import type { QueryCtx, MutationCtx } from "../_generated/server";

const ALLOWED_DOMAINS = ["umd.edu", "terpmail.umd.edu"];

export function isAllowedEmail(email: string): boolean {
  const domain = email.toLowerCase().split("@")[1];
  return ALLOWED_DOMAINS.includes(domain ?? "");
}

/**
 * Every Convex function goes through this. Rejects unauthenticated calls and
 * any identity whose email is not a UMD domain (defense in depth on top of
 * the WorkOS allowed-domain config).
 */
export async function requireUser(ctx: QueryCtx | MutationCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError("Not signed in");
  const user = await ctx.db
    .query("users")
    .withIndex("by_workos_id", (q) => q.eq("workosId", identity.subject))
    .unique();
  if (!user) throw new ConvexError("User record not synced yet — try again in a moment");
  // WorkOS AuthKit access tokens carry no `email` claim, so the domain check
  // runs against the address on the users row, which only ever comes from the
  // WorkOS Management API (webhook or users.syncSelf) — never from the client.
  if (!isAllowedEmail(user.email)) {
    throw new ConvexError("TerpTA is restricted to umd.edu and terpmail.umd.edu accounts");
  }
  return { user, identity };
}

/** requireUser + coordinator role + ownership of the given period. */
export async function requireCoordinator(
  ctx: QueryCtx | MutationCtx,
  periodRef: Id<"staffingPeriods">,
) {
  const { user } = await requireUser(ctx);
  if (user.role !== "coordinator") throw new ConvexError("Coordinator role required");
  const period = await ctx.db.get(periodRef);
  if (!period) throw new ConvexError("Staffing period not found");
  if (period.coordinatorRef !== user._id) {
    throw new ConvexError("You do not own this staffing period");
  }
  return { user, period };
}

/** requireUser + the caller's own TA profile for a period (TAs touch only their own data). */
export async function requireOwnProfile(
  ctx: QueryCtx | MutationCtx,
  taProfileRef: Id<"taProfiles">,
) {
  const { user } = await requireUser(ctx);
  const profile = await ctx.db.get(taProfileRef);
  if (!profile) throw new ConvexError("TA profile not found");
  if (profile.userRef !== user._id) throw new ConvexError("Not your profile");
  return { user, profile };
}
