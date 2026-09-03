/**
 * UMD course import: umd.io adapter + 24h cache + course/section upsert +
 * imported-class availability regeneration.
 *
 * The network adapter sits behind `UmdScheduleSource` so a Testudo scraper can
 * replace umd.io later without touching the import pipeline.
 */
import { ConvexError, v } from "convex/values";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { meetingValidator } from "./schema";
import { requireUser } from "./lib/auth";
import {
  classifyUmdioSection,
  getFixture,
  normalizeUmdioMeetings,
  type NormalizedMeeting,
  type SectionType,
  type UmdDay,
  type UmdioCourse,
  type UmdioSection,
} from "./lib/umdFixtures";
import { departmentOf, umdioSource } from "./lib/umdio";

// ---------------------------------------------------------------------------
// umdCache internal helpers (actions cannot touch ctx.db)
// ---------------------------------------------------------------------------

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function cacheKey(courseId: string, term: string): string {
  return `umdio:${courseId.toUpperCase()}:${term}`;
}

export const getCacheEntry = internalQuery({
  args: { key: v.string() },
  returns: v.union(
    v.null(),
    v.object({ payload: v.any(), fetchedAt: v.number() }),
  ),
  handler: async (ctx, args) => {
    const entry = await ctx.db
      .query("umdCache")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .unique();
    if (!entry) return null;
    return { payload: entry.payload, fetchedAt: entry.fetchedAt };
  },
});

export const setCacheEntry = internalMutation({
  args: { key: v.string(), payload: v.any() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("umdCache")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, {
        payload: args.payload,
        fetchedAt: Date.now(),
      });
    } else {
      await ctx.db.insert("umdCache", {
        key: args.key,
        payload: args.payload,
        fetchedAt: Date.now(),
      });
    }
    return null;
  },
});

// ---------------------------------------------------------------------------
// Auth bridge for the action (actions have no ctx.db)
// ---------------------------------------------------------------------------

export const assertCoordinator = internalQuery({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const { user } = await requireUser(ctx);
    if (user.role !== "coordinator") {
      throw new ConvexError("Coordinator role required to import courses");
    }
    return null;
  },
});

// ---------------------------------------------------------------------------
// Upsert courses + sections (match on courseId+term / courseRef+sectionNumber)
// ---------------------------------------------------------------------------

const sectionTypeValidator = v.union(
  v.literal("lecture"),
  v.literal("discussion"),
  v.literal("lab"),
);

export const upsertCourseAndSections = internalMutation({
  args: {
    courseId: v.string(),
    term: v.string(),
    name: v.string(),
    sections: v.array(
      v.object({
        sectionNumber: v.string(),
        type: sectionTypeValidator,
        meetings: v.array(meetingValidator),
        instructors: v.array(v.string()),
      }),
    ),
  },
  returns: v.object({
    courseRef: v.id("courses"),
    sectionRefs: v.array(v.id("sections")),
  }),
  handler: async (ctx, args) => {
    let course = await ctx.db
      .query("courses")
      .withIndex("by_course_term", (q) =>
        q.eq("courseId", args.courseId).eq("term", args.term),
      )
      .unique();
    let courseRef: Id<"courses">;
    if (course) {
      courseRef = course._id;
      if (course.name !== args.name) {
        await ctx.db.patch(courseRef, { name: args.name });
      }
    } else {
      courseRef = await ctx.db.insert("courses", {
        courseId: args.courseId,
        term: args.term,
        name: args.name,
      });
    }

    const existingSections = await ctx.db
      .query("sections")
      .withIndex("by_course", (q) => q.eq("courseRef", courseRef))
      .collect();
    const byNumber = new Map(
      existingSections.map((s) => [s.sectionNumber, s]),
    );

    const sectionRefs: Id<"sections">[] = [];
    for (const incoming of args.sections) {
      const existing = byNumber.get(incoming.sectionNumber);
      if (existing) {
        // Update meetings/type in place — never duplicate.
        await ctx.db.patch(existing._id, {
          type: incoming.type,
          meetings: incoming.meetings,
          instructors: incoming.instructors,
        });
        sectionRefs.push(existing._id);
      } else {
        sectionRefs.push(
          await ctx.db.insert("sections", {
            courseRef,
            sectionNumber: incoming.sectionNumber,
            type: incoming.type,
            meetings: incoming.meetings,
            instructors: incoming.instructors,
          }),
        );
      }
    }
    // Sections that disappeared upstream are intentionally left in place:
    // shifts/taProfiles may reference them.
    return { courseRef, sectionRefs };
  },
});

// ---------------------------------------------------------------------------
// importCourse action
// ---------------------------------------------------------------------------

type RawPayload = {
  source: "umdio" | "fixture";
  course: UmdioCourse;
  sections: UmdioSection[];
};

function normalizePayload(payload: RawPayload): {
  name: string;
  sections: {
    sectionNumber: string;
    type: SectionType;
    meetings: NormalizedMeeting[];
    instructors: string[];
  }[];
} {
  return {
    name: payload.course.name,
    sections: payload.sections.map((s) => ({
      sectionNumber: s.number,
      type: classifyUmdioSection(s),
      meetings: normalizeUmdioMeetings(s.meetings),
      instructors: (s.instructors ?? []).filter((n) => n.trim().length > 0),
    })),
  };
}

const importResultValidator = v.object({
  courseRef: v.id("courses"),
  courseName: v.string(),
  sectionRefs: v.array(v.id("sections")),
  source: v.union(v.literal("umdio"), v.literal("cache"), v.literal("fixture")),
  sectionsImported: v.number(),
});

interface ImportResult {
  courseRef: Id<"courses">;
  courseName: string;
  sectionRefs: Id<"sections">[];
  source: "umdio" | "cache" | "fixture";
  sectionsImported: number;
}

/**
 * Imports a course + its sections from umd.io (24h-cached), falling back to
 * bundled fixtures when umd.io is down. Coordinator-only.
 */
export const importCourse = action({
  args: { courseId: v.string(), term: v.string() },
  returns: importResultValidator,
  handler: async (ctx, args): Promise<ImportResult> => {
    await ctx.runQuery(internal.umd.assertCoordinator, {});
    return await ctx.runAction(internal.umd.importCourseUnchecked, args);
  },
});

/**
 * The import pipeline itself, with no authorization of its own. Callers gate
 * it: importCourse requires a coordinator, importForEnrollment only a signed-in
 * user (course data is public and the upsert is idempotent).
 */
export const importCourseUnchecked = internalAction({
  args: { courseId: v.string(), term: v.string() },
  returns: importResultValidator,
  handler: async (ctx, args): Promise<ImportResult> => {
    const courseId = args.courseId.toUpperCase().trim();
    const term = args.term.trim();
    const key = cacheKey(courseId, term);
    const now = Date.now();

    // Explicit annotation breaks the same-file api type circularity.
    const cached: { payload: unknown; fetchedAt: number } | null =
      await ctx.runQuery(internal.umd.getCacheEntry, { key });

    let payload: RawPayload | null = null;
    let resultSource: "umdio" | "cache" | "fixture";

    if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
      payload = cached.payload as RawPayload;
      resultSource = payload.source === "fixture" ? "fixture" : "cache";
    } else {
      try {
        const course = await umdioSource.fetchCourse(courseId, term);
        const sections = await umdioSource.fetchSections(courseId, term);
        payload = { source: "umdio", course, sections };
        resultSource = "umdio";
        await ctx.runMutation(internal.umd.setCacheEntry, { key, payload });
      } catch (err) {
        // umd.io is known-flaky (frequent 502s). Prefer a stale cache over
        // fixtures, and fixtures over failing outright.
        if (cached) {
          payload = cached.payload as RawPayload;
          resultSource = payload.source === "fixture" ? "fixture" : "cache";
        } else {
          const fixture = getFixture(courseId, term);
          if (fixture) {
            // Deliberately NOT cached: the next import retries the live API.
            payload = {
              source: "fixture",
              course: fixture.course,
              sections: fixture.sections,
            };
            resultSource = "fixture";
          } else {
            throw new ConvexError(
              `umd.io unavailable — enter sections manually (${err instanceof Error ? err.message : String(err)})`,
            );
          }
        }
      }
    }

    const normalized = normalizePayload(payload);
    const upserted: {
      courseRef: Id<"courses">;
      sectionRefs: Id<"sections">[];
    } = await ctx.runMutation(internal.umd.upsertCourseAndSections, {
      courseId,
      term,
      name: normalized.name,
      sections: normalized.sections,
    });
    const { courseRef, sectionRefs } = upserted;

    return {
      courseRef,
      courseName: normalized.name,
      sectionRefs,
      source: resultSource,
      sectionsImported: sectionRefs.length,
    };
  },
});

// ---------------------------------------------------------------------------
// regenerateImportedBlocks — other agents call internal.umd.regenerateImportedBlocks
// ---------------------------------------------------------------------------

/**
 * Deletes all "imported_class" availability blocks for a TA profile and
 * recreates them (status "unavailable") from the meetings of the profile's
 * enrolledSectionRefs. Deduplicates identical (day, start, end) meetings so
 * shared lecture blocks never produce duplicate rows.
 */
export const regenerateImportedBlocks = internalMutation({
  args: { taProfileRef: v.id("taProfiles") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const profile = await ctx.db.get(args.taProfileRef);
    if (!profile) throw new ConvexError("TA profile not found");

    const blocks = await ctx.db
      .query("availabilityBlocks")
      .withIndex("by_profile", (q) => q.eq("taProfileRef", args.taProfileRef))
      .collect();
    for (const block of blocks) {
      if (block.source === "imported_class") {
        await ctx.db.delete(block._id);
      }
    }

    const seen = new Set<string>();
    const meetingSources = [];
    for (const sectionRef of profile.enrolledSectionRefs) {
      const section = await ctx.db.get(sectionRef);
      if (section) meetingSources.push(section.meetings);
    }
    // Times typed by hand during onboarding lock the grid just like imports.
    if (profile.manualClassMeetings?.length) {
      meetingSources.push(profile.manualClassMeetings);
    }
    for (const meetings of meetingSources) {
      for (const meeting of meetings) {
        const dedupeKey = `${meeting.day}:${meeting.startMin}:${meeting.endMin}`;
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);
        await ctx.db.insert("availabilityBlocks", {
          taProfileRef: args.taProfileRef,
          day: meeting.day,
          startMin: meeting.startMin,
          endMin: meeting.endMin,
          status: "unavailable",
          source: "imported_class",
        });
      }
    }
    return null;
  },
});

// ---------------------------------------------------------------------------
// TA onboarding: course autocomplete + self-service section import
// ---------------------------------------------------------------------------

/**
 * Course autocomplete for "which classes are you taking?".
 *
 * Matches on the course id prefix, so "CMSC1" offers CMSC131, CMSC132, ...
 * The department listing behind it is cached for a day, because a TA types
 * several characters per course and the departments barely change.
 */
export const searchCourses = action({
  args: { query: v.string(), term: v.string(), limit: v.optional(v.number()) },
  returns: v.array(v.object({ courseId: v.string(), name: v.string() })),
  handler: async (ctx, args): Promise<Array<{ courseId: string; name: string }>> => {
    await ctx.runQuery(internal.umd.assertSignedIn, {});

    const query = args.query.trim().toUpperCase().replace(/\s+/g, "");
    const dept = departmentOf(query);
    if (!dept) return []; // fewer than two letters is not worth a round trip

    const term = args.term.trim();
    const key = `umdio:dept:${dept}:${term}`;
    const now = Date.now();
    const cached: { payload: unknown; fetchedAt: number } | null =
      await ctx.runQuery(internal.umd.getCacheEntry, { key });

    let courses: Array<{ courseId: string; name: string }>;
    if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
      courses = cached.payload as Array<{ courseId: string; name: string }>;
    } else {
      try {
        courses = await umdioSource.fetchDepartmentCourses(dept, term);
      } catch {
        // Autocomplete is a convenience; the caller falls back to manual entry.
        return cached ? (cached.payload as Array<{ courseId: string; name: string }>) : [];
      }
      await ctx.runMutation(internal.umd.setCacheEntry, { key, payload: courses });
    }

    return courses
      .filter((c) => c.courseId.startsWith(query))
      .sort((a, b) => a.courseId.localeCompare(b.courseId))
      .slice(0, args.limit ?? 8);
  },
});

/** Any signed-in user. Course data is public; only the write paths are gated. */
export const assertSignedIn = internalQuery({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    await requireUser(ctx);
    return null;
  },
});

/**
 * Import a course a TA is *enrolled in* so its sections can be picked in
 * onboarding. Same pipeline as importCourse, minus the coordinator gate:
 * courses/sections are shared public reference data keyed by course + term,
 * and the upsert is idempotent.
 */
export const importForEnrollment = action({
  args: { courseId: v.string(), term: v.string() },
  returns: v.object({
    courseRef: v.id("courses"),
    courseName: v.string(),
    source: v.union(v.literal("umdio"), v.literal("cache"), v.literal("fixture")),
    sections: v.array(
      v.object({
        _id: v.id("sections"),
        sectionNumber: v.string(),
        type: sectionTypeValidator,
        meetings: v.array(meetingValidator),
        instructors: v.optional(v.array(v.string())),
      }),
    ),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{
    courseRef: Id<"courses">;
    courseName: string;
    source: "umdio" | "cache" | "fixture";
    sections: Array<{
      _id: Id<"sections">;
      sectionNumber: string;
      type: "lecture" | "discussion" | "lab";
      meetings: Array<{ day: UmdDay; startMin: number; endMin: number; room: string }>;
      instructors?: string[];
    }>;
  }> => {
    await ctx.runQuery(internal.umd.assertSignedIn, {});
    const result: ImportResult = await ctx.runAction(internal.umd.importCourseUnchecked, {
      courseId: args.courseId,
      term: args.term,
    });
    const sections: Array<{
      _id: Id<"sections">;
      sectionNumber: string;
      type: "lecture" | "discussion" | "lab";
      meetings: Array<{ day: UmdDay; startMin: number; endMin: number; room: string }>;
      instructors?: string[];
    }> = await ctx.runQuery(internal.umd.listSectionsOfCourse, {
      courseRef: result.courseRef,
    });
    return {
      courseRef: result.courseRef,
      courseName: result.courseName,
      source: result.source,
      sections,
    };
  },
});

/** Sections of any course. Public reference data, so no ownership check. */
export const listSectionsOfCourse = internalQuery({
  args: { courseRef: v.id("courses") },
  returns: v.array(
    v.object({
      _id: v.id("sections"),
      sectionNumber: v.string(),
      type: sectionTypeValidator,
      meetings: v.array(meetingValidator),
      instructors: v.optional(v.array(v.string())),
    }),
  ),
  handler: async (ctx, args) => {
    const sections = await ctx.db
      .query("sections")
      .withIndex("by_course", (q) => q.eq("courseRef", args.courseRef))
      .collect();
    sections.sort((a, b) => a.sectionNumber.localeCompare(b.sectionNumber));
    return sections.map((s) => ({
      _id: s._id,
      sectionNumber: s.sectionNumber,
      type: s.type,
      meetings: s.meetings,
      instructors: s.instructors,
    }));
  },
});
