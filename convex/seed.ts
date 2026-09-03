/**
 * Deterministic demo seed. Run with:
 *   npx convex run seed:run
 *
 * Idempotent: skips if the seed coordinator ("seed_nelson") already exists.
 * All randomness comes from a mulberry32 PRNG with a fixed seed — never
 * Math.random — so every fresh deployment gets byte-identical data.
 */
import { v } from "convex/values";
import { internalMutation, type MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import {
  CMSC132_FALL2026_COURSE,
  CMSC132_FALL2026_SECTIONS,
  normalizeUmdioMeetings,
  type NormalizedMeeting,
  type UmdDay,
} from "./lib/umdFixtures";

// ---------------------------------------------------------------------------
// Seeded PRNG (mulberry32)
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(items: T[], rand: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function pickInt(rand: () => number, min: number, max: number): number {
  return min + Math.floor(rand() * (max - min + 1));
}

// ---------------------------------------------------------------------------
// Static seed data
// ---------------------------------------------------------------------------

const TERM = "202608";
const START_DATE = "2026-08-31";
const END_DATE = "2026-12-11";
const DAYS: UmdDay[] = ["M", "Tu", "W", "Th", "F"];

const TAS: { name: string; email: string; slug: string }[] = [
  { name: "Priya Shah", email: "pshah@umd.edu", slug: "priya" },
  { name: "Marcus Lee", email: "mlee12@terpmail.umd.edu", slug: "marcus" },
  { name: "Aisha Rahman", email: "arahman9@terpmail.umd.edu", slug: "aisha" },
  { name: "Diego Torres", email: "dtorres3@umd.edu", slug: "diego" },
  { name: "Emily Chen", email: "echen21@terpmail.umd.edu", slug: "emily" },
  { name: "Noah Kim", email: "nkim45@terpmail.umd.edu", slug: "noah" },
  { name: "Sofia Martinez", email: "smartin8@umd.edu", slug: "sofia" },
  { name: "Ethan Patel", email: "epatel7@terpmail.umd.edu", slug: "ethan" },
  { name: "Grace Liu", email: "gliu16@terpmail.umd.edu", slug: "grace" },
  { name: "Omar Hassan", email: "ohassan2@umd.edu", slug: "omar" },
  { name: "Lily Nguyen", email: "lnguyen5@terpmail.umd.edu", slug: "lily" },
  { name: "Jackson Brown", email: "jbrown33@terpmail.umd.edu", slug: "jackson" },
  { name: "Zoe Williams", email: "zwilliam@umd.edu", slug: "zoe" },
  { name: "Ravi Gupta", email: "rgupta11@terpmail.umd.edu", slug: "ravi" },
  { name: "Hannah Park", email: "hpark29@terpmail.umd.edu", slug: "hannah" },
];

const EXCEPTION_POOL: { startDate: string; endDate: string; reason: string }[] = [
  { startDate: "2026-09-25", endDate: "2026-09-27", reason: "Out of town for a wedding" },
  { startDate: "2026-10-14", endDate: "2026-10-16", reason: "Grace Hopper conference" },
  { startDate: "2026-11-25", endDate: "2026-11-27", reason: "Thanksgiving travel" },
  { startDate: "2026-10-02", endDate: "2026-10-02", reason: "GRE exam" },
  { startDate: "2026-11-06", endDate: "2026-11-08", reason: "Hackathon weekend" },
];

// ---------------------------------------------------------------------------
// seed:run
// ---------------------------------------------------------------------------

const SEEDED_TABLES = [
  "users",
  "courses",
  "sections",
  "staffingPeriods",
  "dutyTypes",
  "shifts",
  "taProfiles",
  "availabilityBlocks",
  "dateExceptions",
  "assignments",
  "hourLogs",
  "swapRequests",
  "changeLog",
  "umdCache",
] as const;

export const run = internalMutation({
  args: { force: v.optional(v.boolean()) },
  returns: v.string(),
  handler: async (ctx, args) => {
    const already = await ctx.db
      .query("users")
      .withIndex("by_workos_id", (q) => q.eq("workosId", "seed_nelson"))
      .unique();
    if (already && !args.force) {
      return "Seed data already present (seed_nelson exists) — skipping. Pass { force: true } to wipe and reseed.";
    }
    if (args.force) {
      for (const table of SEEDED_TABLES) {
        const rows = await ctx.db.query(table).collect();
        for (const row of rows) {
          await ctx.db.delete(row._id);
        }
      }
    }

    const rand = mulberry32(0x7e21833); // deterministic

    // --- Course + sections (from the CMSC132 Fall 2026 fixture) -------------
    const courseRef = await ctx.db.insert("courses", {
      courseId: CMSC132_FALL2026_COURSE.course_id,
      term: TERM,
      name: CMSC132_FALL2026_COURSE.name,
    });

    const sectionRefs: Id<"sections">[] = [];
    const discussionMeetingBySection = new Map<
      Id<"sections">,
      NormalizedMeeting
    >();
    const sectionNumberByRef = new Map<Id<"sections">, string>();
    for (const fixtureSection of CMSC132_FALL2026_SECTIONS) {
      const meetings = normalizeUmdioMeetings(fixtureSection.meetings);
      const sectionRef = await ctx.db.insert("sections", {
        courseRef,
        sectionNumber: fixtureSection.number,
        type: "discussion",
        meetings,
      });
      sectionRefs.push(sectionRef);
      sectionNumberByRef.set(sectionRef, fixtureSection.number);
      const disc = normalizeUmdioMeetings(
        fixtureSection.meetings.filter((m) => m.classtype === "Discussion"),
      )[0];
      if (disc) discussionMeetingBySection.set(sectionRef, disc);
    }

    // --- Coordinator + staffing period ---------------------------------------
    const nelsonRef = await ctx.db.insert("users", {
      workosId: "seed_nelson",
      email: "nelson@umd.edu",
      name: "Dr. Nelson",
      role: "coordinator",
    });

    const periodRef = await ctx.db.insert("staffingPeriods", {
      courseRef,
      term: TERM,
      coordinatorRef: nelsonRef,
      collectionDeadline: "2026-09-14",
      status: "collecting",
    });

    // --- Duty types ----------------------------------------------------------
    const discussionDuty = await ctx.db.insert("dutyTypes", {
      periodRef,
      name: "Discussion",
      mode: "sync",
      color: "#E21833", // UMD red
      defaultHoursCredit: 1,
    });
    const officeHoursDuty = await ctx.db.insert("dutyTypes", {
      periodRef,
      name: "Office Hours",
      mode: "sync",
      color: "#FFD200", // UMD gold
      defaultHoursCredit: 2,
    });
    const proctoringDuty = await ctx.db.insert("dutyTypes", {
      periodRef,
      name: "Exam Proctoring",
      mode: "sync",
      color: "#4A7B9D",
      defaultHoursCredit: 2,
    });
    const gradingDuty = await ctx.db.insert("dutyTypes", {
      periodRef,
      name: "Grading",
      mode: "async",
      color: "#5B8C5A",
      defaultHoursCredit: 1,
    });
    const dutyTypeRefs = [
      discussionDuty,
      officeHoursDuty,
      proctoringDuty,
      gradingDuty,
    ];

    // --- Shifts ---------------------------------------------------------------
    let shiftCount = 0;

    // One weekly Discussion shift per discussion section.
    for (const sectionRef of sectionRefs) {
      const meeting = discussionMeetingBySection.get(sectionRef);
      if (!meeting) continue;
      await ctx.db.insert("shifts", {
        periodRef,
        dutyTypeRef: discussionDuty,
        requiredCount: 1,
        sectionRef,
        description: `Section ${sectionNumberByRef.get(sectionRef)} discussion`,
        recurrence: "weekly",
        day: meeting.day,
        startMin: meeting.startMin,
        endMin: meeting.endMin,
        startDate: START_DATE,
        endDate: END_DATE,
      });
      shiftCount++;
    }

    // 10 weekly 2h Office Hours blocks, two per weekday, 10:00-18:00.
    const OH_STARTS = [600, 720, 840, 960]; // 10:00, 12:00, 14:00, 16:00
    for (const day of DAYS) {
      const starts = shuffled(OH_STARTS, rand).slice(0, 2).sort((a, b) => a - b);
      for (const startMin of starts) {
        await ctx.db.insert("shifts", {
          periodRef,
          dutyTypeRef: officeHoursDuty,
          requiredCount: pickInt(rand, 1, 2),
          description: "Office hours (AVW 4th floor open lab)",
          recurrence: "weekly",
          day,
          startMin,
          endMin: startMin + 120,
          startDate: START_DATE,
          endDate: END_DATE,
        });
        shiftCount++;
      }
    }

    // Midterm proctoring: once, Wednesday 2026-10-14, 7:00-9:00pm.
    await ctx.db.insert("shifts", {
      periodRef,
      dutyTypeRef: proctoringDuty,
      requiredCount: 4,
      description: "Midterm 1 evening proctoring",
      recurrence: "once",
      day: "W",
      date: "2026-10-14",
      startMin: 1140,
      endMin: 1260,
    });
    shiftCount++;

    // Async grading duty.
    await ctx.db.insert("shifts", {
      periodRef,
      dutyTypeRef: gradingDuty,
      requiredCount: 3,
      description: "Project 2 grading",
      hoursRequired: 6,
      dueDate: "2026-10-20",
    });
    shiftCount++;

    // --- TAs: users, profiles, availability, exceptions -----------------------
    const SUBMITTED_BASE = Date.UTC(2026, 8, 8, 15, 0, 0); // 2026-09-08T15:00Z
    let blockCount = 0;
    let exceptionCount = 0;

    for (let i = 0; i < TAS.length; i++) {
      const ta = TAS[i];
      const userRef = await ctx.db.insert("users", {
        workosId: `seed_${ta.slug}`,
        email: ta.email,
        name: ta.name,
        role: "ta",
      });

      const submitted = i % 5 !== 4; // 12 of 15 have submitted availability
      const taProfileRef = await ctx.db.insert("taProfiles", {
        userRef,
        periodRef,
        maxHoursPerWeek: 10,
        enrolledSectionRefs: [],
        syncAsyncPreference: Math.round(rand() * 4) / 4, // 0, .25, .5, .75, 1
        dutyTypePrefs: shuffled(dutyTypeRefs, rand),
        sectionPrefs: shuffled(sectionRefs, rand),
        ...(submitted
          ? { availabilitySubmittedAt: SUBMITTED_BASE + i * 7_200_000 }
          : {}),
      });

      // Manual availability: Mon-Fri 8:00-22:00 in 30-min multiples.
      // (Extends past 20:00 so evening shifts — e.g. 7-9pm exam proctoring —
      // can be fully covered: unpainted time now counts as unavailable.)
      for (const day of DAYS) {
        let cursor = 480; // 8:00
        while (cursor < 1320) {
          const length = Math.min(30 * pickInt(rand, 1, 5), 1320 - cursor);
          const roll = rand();
          if (roll < 0.62) {
            await insertBlock(ctx, taProfileRef, day, cursor, length, "available");
            blockCount++;
          } else if (roll < 0.78) {
            await insertBlock(ctx, taProfileRef, day, cursor, length, "prefer_not");
            blockCount++;
          } else if (roll < 0.9) {
            await insertBlock(ctx, taProfileRef, day, cursor, length, "unavailable");
            blockCount++;
          }
          // else: gap — leave the window unmarked
          cursor += length;
        }
      }

      // 1-2 date exceptions for a few TAs.
      if (i % 4 === 0) {
        const count = pickInt(rand, 1, 2);
        const picks = shuffled(EXCEPTION_POOL, rand).slice(0, count);
        for (const ex of picks) {
          await ctx.db.insert("dateExceptions", {
            taProfileRef,
            startDate: ex.startDate,
            endDate: ex.endDate,
            reason: ex.reason,
          });
          exceptionCount++;
        }
      }
    }

    return (
      `Seeded CMSC132 ${TERM}: 1 course, ${sectionRefs.length} sections, ` +
      `1 coordinator, 1 staffing period, 4 duty types, ${shiftCount} shifts, ` +
      `${TAS.length} TAs, ${blockCount} availability blocks, ${exceptionCount} date exceptions.`
    );
  },
});

async function insertBlock(
  ctx: MutationCtx,
  taProfileRef: Id<"taProfiles">,
  day: UmdDay,
  startMin: number,
  length: number,
  status: "available" | "prefer_not" | "unavailable",
): Promise<void> {
  await ctx.db.insert("availabilityBlocks", {
    taProfileRef,
    day,
    startMin,
    endMin: startMin + length,
    status,
    source: "manual",
  });
}
