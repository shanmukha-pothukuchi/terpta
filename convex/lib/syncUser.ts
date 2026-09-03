import type { MutationCtx } from "../_generated/server";

/**
 * Upsert a WorkOS user into our `users` table.
 *
 * Placeholder rows created ahead of first sign-in use
 * `workosId: "invited:<email>"`; the first sync for a matching email claims
 * that row so existing references (coordinatorRef, taProfiles.userRef, ...)
 * stay intact.
 *
 * Shared by the WorkOS webhook (convex/authkit.ts) and the on-demand
 * self-sync the app runs at first sign-in (convex/users.ts).
 */
export async function syncUser(
  ctx: MutationCtx,
  data: {
    id: string;
    email: string;
    firstName?: string | null;
    lastName?: string | null;
  },
): Promise<void> {
  const name =
    [data.firstName, data.lastName].filter(Boolean).join(" ") || data.email;

  const byWorkosId = await ctx.db
    .query("users")
    .withIndex("by_workos_id", (q) => q.eq("workosId", data.id))
    .unique();
  if (byWorkosId !== null) {
    await ctx.db.patch(byWorkosId._id, { email: data.email, name });
    return;
  }

  const byEmail = await ctx.db
    .query("users")
    .withIndex("by_email", (q) => q.eq("email", data.email))
    .unique();
  if (byEmail !== null && byEmail.workosId.startsWith("invited:")) {
    await ctx.db.patch(byEmail._id, { workosId: data.id, name });
    return;
  }

  await ctx.db.insert("users", {
    workosId: data.id,
    email: data.email,
    name,
    // role intentionally unset — the frontend shows a role chooser.
  });
}
