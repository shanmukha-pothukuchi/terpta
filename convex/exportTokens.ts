import { ConvexError, v } from "convex/values";
import { internalQuery, mutation } from "./_generated/server";
import { dayValidator } from "./schema";
import { requireCoordinator, requireOwnProfile } from "./lib/auth";

// The Convex runtime exposes process.env; @types/node is not installed in
// this project, so declare the minimal shape locally (module-scoped).
declare const process: { env: Record<string, string | undefined> };

// ---------------------------------------------------------------------------
// Signed export tokens (HMAC-SHA256, 15 minute TTL).
// Format: base64url(JSON payload) + "." + base64url(HMAC-SHA256(body))
// ---------------------------------------------------------------------------

const TOKEN_TTL_MS = 15 * 60 * 1000;

export type ExportTokenKind = "schedule" | "hourlogs";

export type ExportTokenPayload = {
  kind: ExportTokenKind;
  /** Present when kind === "schedule". Plain string form of Id<"taProfiles">. */
  taProfileRef?: string;
  /** Present when kind === "hourlogs". Plain string form of Id<"staffingPeriods">. */
  periodRef?: string;
  /** Epoch ms expiry. */
  exp: number;
};

function base64urlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlDecode(s: string): Uint8Array<ArrayBuffer> | null {
  try {
    const b64 =
      s.replace(/-/g, "+").replace(/_/g, "/") +
      "=".repeat((4 - (s.length % 4)) % 4);
    const bin = atob(b64);
    // Allocate from a plain ArrayBuffer so the result satisfies BufferSource.
    const bytes = new Uint8Array(new ArrayBuffer(bin.length));
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

async function hmacKey(usages: KeyUsage[]): Promise<CryptoKey> {
  const secret = process.env.EXPORT_TOKEN_SECRET ?? "dev-secret";
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    usages,
  );
}

/** Sign a payload into a token string. Pure helper (no ctx). */
export async function signPayload(payload: ExportTokenPayload): Promise<string> {
  const body = base64urlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const key = await hmacKey(["sign"]);
  const sig = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)),
  );
  return `${body}.${base64urlEncode(sig)}`;
}

/**
 * Pure verify helper used by http.ts. Returns the decoded payload if the
 * signature is valid, the kind matches, and the token has not expired;
 * otherwise null. Never throws.
 */
export async function verifyToken(
  token: string,
  expectedKind: ExportTokenKind,
): Promise<ExportTokenPayload | null> {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  const sigBytes = base64urlDecode(sig);
  if (!sigBytes) return null;
  const key = await hmacKey(["verify"]);
  let ok = false;
  try {
    ok = await crypto.subtle.verify(
      "HMAC",
      key,
      sigBytes,
      new TextEncoder().encode(body),
    );
  } catch {
    return null;
  }
  if (!ok) return null;
  const payloadBytes = base64urlDecode(body);
  if (!payloadBytes) return null;
  let payload: ExportTokenPayload;
  try {
    payload = JSON.parse(new TextDecoder().decode(payloadBytes));
  } catch {
    return null;
  }
  if (payload.kind !== expectedKind) return null;
  if (typeof payload.exp !== "number" || Date.now() > payload.exp) return null;
  return payload;
}

/**
 * Mint a short-lived export token.
 * - kind "schedule": TA minting a calendar link for their OWN profile.
 * - kind "hourlogs": coordinator minting a CSV export link for a period they own.
 */
export const mint = mutation({
  args: {
    kind: v.union(v.literal("schedule"), v.literal("hourlogs")),
    taProfileRef: v.optional(v.id("taProfiles")),
    periodRef: v.optional(v.id("staffingPeriods")),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    if (args.kind === "schedule") {
      if (!args.taProfileRef) {
        throw new ConvexError("taProfileRef is required for schedule tokens");
      }
      await requireOwnProfile(ctx, args.taProfileRef);
      return await signPayload({
        kind: "schedule",
        taProfileRef: args.taProfileRef,
        exp: Date.now() + TOKEN_TTL_MS,
      });
    }
    if (!args.periodRef) {
      throw new ConvexError("periodRef is required for hourlogs tokens");
    }
    await requireCoordinator(ctx, args.periodRef);
    return await signPayload({
      kind: "hourlogs",
      periodRef: args.periodRef,
      exp: Date.now() + TOKEN_TTL_MS,
    });
  },
});

// ---------------------------------------------------------------------------
// Data loader for the ICS export. No auth here: only reachable from http.ts
// AFTER verifyToken() has validated a signed, unexpired schedule token.
// ---------------------------------------------------------------------------

const scheduleEventValidator = v.object({
  uid: v.string(),
  kind: v.union(v.literal("weekly"), v.literal("once"), v.literal("async")),
  title: v.string(),
  description: v.optional(v.string()),
  // weekly
  day: v.optional(dayValidator),
  startMin: v.optional(v.number()),
  endMin: v.optional(v.number()),
  startDate: v.optional(v.string()),
  endDate: v.optional(v.string()),
  // once
  date: v.optional(v.string()),
  // async
  hoursRequired: v.optional(v.number()),
  dueDate: v.optional(v.string()),
});

/**
 * Every staffed hour of a course, for the feed students subscribe to.
 *
 * Names go in the description rather than the title: a student scanning
 * their week wants to know office hours are on, and which TA is holding
 * them is the detail behind it.
 */
export const courseCalendarForExport = internalQuery({
  args: {
    periodRef: v.id("staffingPeriods"),
    /** Only these kinds of work; absent for all of them. */
    dutyTypeRefs: v.optional(v.array(v.id("dutyTypes"))),
    /** What the coordinator called the link, for the calendar's name. */
    label: v.optional(v.string()),
  },
  returns: v.union(
    v.null(),
    v.object({
      taName: v.string(),
      taEmail: v.string(),
      events: v.array(scheduleEventValidator),
    }),
  ),
  handler: async (ctx, args) => {
    const period = await ctx.db.get(args.periodRef);
    if (!period) return null;
    const course = await ctx.db.get(period.courseRef);

    const shifts = await ctx.db
      .query("shifts")
      .withIndex("by_period", (q) => q.eq("periodRef", args.periodRef))
      .collect();

    const dutyNames = new Map<string, string>();
    for (const duty of await ctx.db
      .query("dutyTypes")
      .withIndex("by_period", (q) => q.eq("periodRef", args.periodRef))
      .collect()) {
      dutyNames.set(duty._id as string, duty.name);
    }

    const carried =
      args.dutyTypeRefs === undefined ? null : new Set<string>(args.dutyTypeRefs);

    const events = [];
    for (const shift of shifts) {
      // Not what this link was made to carry.
      if (carried && !carried.has(shift.dutyTypeRef as string)) continue;
      const rows = await ctx.db
        .query("assignments")
        .withIndex("by_shift", (q) => q.eq("shiftRef", shift._id))
        .collect();
      // Nobody is on it, so nobody should be told to turn up to it.
      if (rows.length === 0) continue;

      const names: string[] = [];
      for (const row of rows) {
        const profile = await ctx.db.get(row.taProfileRef);
        const user = profile ? await ctx.db.get(profile.userRef) : null;
        const name = user?.preferredName || user?.name;
        if (name) names.push(name);
      }
      names.sort();

      let title = dutyNames.get(shift.dutyTypeRef as string) ?? "Shift";
      if (shift.sectionRef) {
        const section = await ctx.db.get(shift.sectionRef);
        if (section) title = `${title} ${section.sectionNumber}`;
      } else if (shift.description) {
        title = shift.description;
      }

      const description = names.length > 0 ? `With ${names.join(", ")}` : undefined;
      if (shift.recurrence === "weekly" && shift.day && shift.startMin !== undefined) {
        events.push({
          uid: `${shift._id}@terpta`,
          kind: "weekly" as const,
          title,
          ...(description ? { description } : {}),
          day: shift.day,
          startMin: shift.startMin,
          endMin: shift.endMin ?? shift.startMin,
          startDate: shift.startDate ?? "2026-08-31",
          endDate: shift.endDate ?? "2026-12-11",
        });
      } else if (shift.recurrence === "once" && shift.date && shift.startMin !== undefined) {
        events.push({
          uid: `${shift._id}@terpta`,
          kind: "once" as const,
          title,
          ...(description ? { description } : {}),
          date: shift.date,
          startMin: shift.startMin,
          endMin: shift.endMin ?? shift.startMin,
        });
      }
      // Async pools have no hour to sit in a student's calendar.
    }

    const courseId = course?.courseId ?? "Course";
    return {
      taName: args.label ? `${courseId} ${args.label}` : `${courseId} staff`,
      taEmail: "",
      events,
    };
  },
});

export const scheduleForExport = internalQuery({
  args: { taProfileRef: v.id("taProfiles") },
  returns: v.union(
    v.null(),
    v.object({
      taName: v.string(),
      taEmail: v.string(),
      events: v.array(scheduleEventValidator),
    }),
  ),
  handler: async (ctx, args) => {
    const profile = await ctx.db.get(args.taProfileRef);
    if (!profile) return null;
    const user = await ctx.db.get(profile.userRef);
    const assignments = await ctx.db
      .query("assignments")
      .withIndex("by_profile", (q) => q.eq("taProfileRef", args.taProfileRef))
      .collect();

    const dutyNameCache = new Map<string, string>();
    const sectionLabelCache = new Map<string, string>();
    const events = [];

    for (const assignment of assignments) {
      const shift = await ctx.db.get(assignment.shiftRef);
      if (!shift) continue;

      let dutyName = dutyNameCache.get(shift.dutyTypeRef);
      if (dutyName === undefined) {
        const dutyType = await ctx.db.get(shift.dutyTypeRef);
        dutyName = dutyType?.name ?? "Duty";
        dutyNameCache.set(shift.dutyTypeRef, dutyName);
      }

      let sectionLabel = "";
      if (shift.sectionRef) {
        const cached = sectionLabelCache.get(shift.sectionRef);
        if (cached !== undefined) {
          sectionLabel = cached;
        } else {
          const section = await ctx.db.get(shift.sectionRef);
          sectionLabel = section ? ` (${section.sectionNumber})` : "";
          sectionLabelCache.set(shift.sectionRef, sectionLabel);
        }
      }

      const title = `${dutyName}${sectionLabel}`;
      const uid = `${assignment._id}@terpta`;

      if (
        shift.recurrence === "weekly" &&
        shift.day !== undefined &&
        shift.startMin !== undefined &&
        shift.endMin !== undefined &&
        shift.startDate !== undefined &&
        shift.endDate !== undefined
      ) {
        events.push({
          uid,
          kind: "weekly" as const,
          title,
          description: shift.description,
          day: shift.day,
          startMin: shift.startMin,
          endMin: shift.endMin,
          startDate: shift.startDate,
          endDate: shift.endDate,
        });
      } else if (
        shift.recurrence === "once" &&
        shift.date !== undefined &&
        shift.startMin !== undefined &&
        shift.endMin !== undefined
      ) {
        events.push({
          uid,
          kind: "once" as const,
          title,
          description: shift.description,
          date: shift.date,
          startMin: shift.startMin,
          endMin: shift.endMin,
        });
      } else if (shift.hoursRequired !== undefined) {
        events.push({
          uid,
          kind: "async" as const,
          title,
          description: shift.description,
          hoursRequired: assignment.hoursAllocated ?? shift.hoursRequired,
          dueDate: shift.dueDate,
        });
      }
    }

    return {
      taName: user?.name ?? "TA",
      taEmail: user?.email ?? "",
      events,
    };
  },
});
