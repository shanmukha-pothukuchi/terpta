import type { FunctionReturnType } from "convex/server";
import { api } from "../../convex/_generated/api";

/**
 * Central re-exports of the backend functions the shell consumes, so pages
 * import from one place and a backend rename touches only this file.
 *
 * Backend contract (convex/users.ts, convex/roster.ts, convex/shifts.ts):
 *   users:current    query    {}                                -> CurrentUser | null
 *   users:chooseRole mutation { role: "ta" | "coordinator" }    -> null
 *   users:devSetRole mutation { role: "ta" | "coordinator" }    -> null
 *   roster:list      query    { periodRef: Id<"staffingPeriods"> } -> RosterRow[]
 *   shifts:list      query    { periodRef: Id<"staffingPeriods"> } -> ShiftRow[]
 */

export type Role = "ta" | "coordinator";

export const usersMe = api.users.current;
export const usersChooseRole = api.users.chooseRole;
export const usersDevSetRole = api.users.devSetRole;
export const rosterListByPeriod = api.roster.list;
export const shiftsListByPeriod = api.shifts.list;

export type CurrentUser = NonNullable<FunctionReturnType<typeof usersMe>>;
export type RosterRow = FunctionReturnType<typeof rosterListByPeriod>[number];
export type ShiftRow = FunctionReturnType<typeof shiftsListByPeriod>[number];
