import { useQuery } from "convex/react";
import { usersMe, type CurrentUser } from "./api";

/**
 * Current app user (our `users` table row, synced from WorkOS by webhook).
 * undefined = loading, null = authenticated but row not synced yet.
 */
export function useCurrentUser(): CurrentUser | null | undefined {
  return useQuery(usersMe, {});
}
