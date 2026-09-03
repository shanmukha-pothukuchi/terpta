import { AuthKit, type AuthFunctions } from "@convex-dev/workos-authkit";
import type { ComponentApi } from "@convex-dev/workos-authkit/_generated/component.js";
import type { HttpRouter } from "convex/server";
import { components, internal } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";

// Typed references to the internal functions exported from THIS file
// (the component calls back into `authKitEvent` below).
//
// NOTE: `components`/`internal` are runtime proxies, so the casts below are
// safe. They exist because `npx convex dev --once` codegen (which adds
// `components.workOSAuthKit` / `internal.authkit` to the generated types)
// cannot run until every convex/ module bundles; once it has run, the casts
// are no-ops and can be removed.
const authFunctions: AuthFunctions = (
  internal as unknown as { authkit: AuthFunctions }
).authkit;

export const authKit: AuthKit<DataModel> = new AuthKit<DataModel>(
  (components as unknown as { workOSAuthKit: ComponentApi }).workOSAuthKit,
  { authFunctions },
);

/**
 * Upsert a WorkOS user into our `users` table.
 *
 * Placeholder rows created ahead of first sign-in use
 * `workosId: "invited:<email>"`; the first user.created/updated event for a
 * matching email claims that row so existing references (coordinatorRef,
 * taProfiles.userRef, ...) stay intact.
 */
async function syncUser(
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

// Internal mutation the AuthKit component invokes for WorkOS webhook events.
export const { authKitEvent } = authKit.events({
  "user.created": async (ctx, event) => {
    await syncUser(ctx, event.data);
  },
  "user.updated": async (ctx, event) => {
    await syncUser(ctx, event.data);
  },
  "user.deleted": async (ctx, event) => {
    // Keep the row (assignments/changeLog reference users); revert it to an
    // unclaimed placeholder so a re-created WorkOS account can reclaim it.
    const existing = await ctx.db
      .query("users")
      .withIndex("by_workos_id", (q) => q.eq("workosId", event.data.id))
      .unique();
    if (existing !== null) {
      await ctx.db.patch(existing._id, {
        workosId: `invited:${existing.email}`,
      });
    }
  },
});

/**
 * Convenience for convex/http.ts (owned elsewhere). Both of these work:
 *
 *   import { authKit } from "./authkit";
 *   authKit.registerRoutes(http);
 *
 *   import { registerAuthKitRoutes } from "./authkit";
 *   registerAuthKitRoutes(http);
 */
export function registerAuthKitRoutes(http: HttpRouter): void {
  authKit.registerRoutes(http);
}
