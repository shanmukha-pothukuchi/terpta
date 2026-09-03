import { AuthKit, type AuthFunctions } from "@convex-dev/workos-authkit";
import type { ComponentApi } from "@convex-dev/workos-authkit/_generated/component.js";
import type { HttpRouter } from "convex/server";
import { components, internal } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import { syncUser } from "./lib/syncUser";

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
