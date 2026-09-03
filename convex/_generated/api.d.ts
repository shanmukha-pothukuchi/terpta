/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as authkit from "../authkit.js";
import type * as builder from "../builder.js";
import type * as coverage from "../coverage.js";
import type * as dutyTypes from "../dutyTypes.js";
import type * as emails from "../emails.js";
import type * as exportTokens from "../exportTokens.js";
import type * as hours from "../hours.js";
import type * as http from "../http.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_syncUser from "../lib/syncUser.js";
import type * as lib_umdFixtures from "../lib/umdFixtures.js";
import type * as lib_jupiterp from "../lib/jupiterp.js";
import type * as periods from "../periods.js";
import type * as roster from "../roster.js";
import type * as seed from "../seed.js";
import type * as shifts from "../shifts.js";
import type * as smtp from "../smtp.js";
import type * as solver_solve from "../solver/solve.js";
import type * as solver_types from "../solver/types.js";
import type * as ta from "../ta.js";
import type * as umd from "../umd.js";
import type * as users from "../users.js";
import type * as weeks from "../weeks.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  authkit: typeof authkit;
  builder: typeof builder;
  coverage: typeof coverage;
  dutyTypes: typeof dutyTypes;
  emails: typeof emails;
  exportTokens: typeof exportTokens;
  hours: typeof hours;
  http: typeof http;
  "lib/auth": typeof lib_auth;
  "lib/syncUser": typeof lib_syncUser;
  "lib/umdFixtures": typeof lib_umdFixtures;
  "lib/jupiterp": typeof lib_jupiterp;
  periods: typeof periods;
  roster: typeof roster;
  seed: typeof seed;
  shifts: typeof shifts;
  smtp: typeof smtp;
  "solver/solve": typeof solver_solve;
  "solver/types": typeof solver_types;
  ta: typeof ta;
  umd: typeof umd;
  users: typeof users;
  weeks: typeof weeks;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  workOSAuthKit: import("@convex-dev/workos-authkit/_generated/component.js").ComponentApi<"workOSAuthKit">;
};
