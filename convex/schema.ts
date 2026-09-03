import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const dayValidator = v.union(
  v.literal("M"),
  v.literal("Tu"),
  v.literal("W"),
  v.literal("Th"),
  v.literal("F"),
);

export const meetingValidator = v.object({
  day: dayValidator,
  startMin: v.number(),
  endMin: v.number(),
  room: v.string(),
});

export const roleValidator = v.union(v.literal("ta"), v.literal("coordinator"));

export const blockStatusValidator = v.union(
  v.literal("available"),
  v.literal("prefer_not"),
  v.literal("unavailable"),
);

export default defineSchema({
  users: defineTable({
    workosId: v.string(),
    email: v.string(),
    name: v.string(),
    role: v.optional(roleValidator),
  })
    .index("by_workos_id", ["workosId"])
    .index("by_email", ["email"]),

  courses: defineTable({
    courseId: v.string(), // e.g. "CMSC132"
    term: v.string(), // e.g. "202608"
    name: v.string(),
  }).index("by_course_term", ["courseId", "term"]),

  sections: defineTable({
    courseRef: v.id("courses"),
    sectionNumber: v.string(), // e.g. "0101"
    type: v.union(v.literal("lecture"), v.literal("discussion"), v.literal("lab")),
    meetings: v.array(meetingValidator),
  }).index("by_course", ["courseRef"]),

  staffingPeriods: defineTable({
    courseRef: v.id("courses"),
    term: v.string(),
    coordinatorRef: v.id("users"),
    collectionDeadline: v.string(), // ISO date YYYY-MM-DD
    status: v.union(
      v.literal("draft"),
      v.literal("collecting"),
      v.literal("generated"),
      v.literal("published"),
    ),
  }).index("by_coordinator", ["coordinatorRef"]),

  dutyTypes: defineTable({
    periodRef: v.id("staffingPeriods"),
    name: v.string(),
    mode: v.union(v.literal("sync"), v.literal("async")),
    color: v.string(),
    defaultHoursCredit: v.number(),
  }).index("by_period", ["periodRef"]),

  shifts: defineTable({
    periodRef: v.id("staffingPeriods"),
    dutyTypeRef: v.id("dutyTypes"),
    requiredCount: v.number(),
    sectionRef: v.optional(v.id("sections")),
    description: v.optional(v.string()),
    // sync shifts
    recurrence: v.optional(v.union(v.literal("weekly"), v.literal("once"))),
    day: v.optional(dayValidator),
    startMin: v.optional(v.number()),
    endMin: v.optional(v.number()),
    date: v.optional(v.string()), // once: ISO date
    startDate: v.optional(v.string()), // weekly
    endDate: v.optional(v.string()), // weekly
    // async duties
    hoursRequired: v.optional(v.number()),
    dueDate: v.optional(v.string()),
  }).index("by_period", ["periodRef"]),

  taProfiles: defineTable({
    userRef: v.id("users"),
    periodRef: v.id("staffingPeriods"),
    maxHoursPerWeek: v.number(),
    enrolledSectionRefs: v.array(v.id("sections")),
    syncAsyncPreference: v.number(), // 0 = all sync, 1 = all async
    dutyTypePrefs: v.array(v.id("dutyTypes")), // ranked, best first
    sectionPrefs: v.array(v.id("sections")), // ranked, best first
    availabilitySubmittedAt: v.optional(v.number()),
  })
    .index("by_period", ["periodRef"])
    .index("by_user_period", ["userRef", "periodRef"]),

  availabilityBlocks: defineTable({
    taProfileRef: v.id("taProfiles"),
    day: dayValidator,
    startMin: v.number(),
    endMin: v.number(),
    status: blockStatusValidator,
    source: v.union(v.literal("manual"), v.literal("imported_class")),
  }).index("by_profile", ["taProfileRef"]),

  dateExceptions: defineTable({
    taProfileRef: v.id("taProfiles"),
    startDate: v.string(), // ISO date
    endDate: v.string(), // ISO date, inclusive
    reason: v.string(),
  }).index("by_profile", ["taProfileRef"]),

  assignments: defineTable({
    shiftRef: v.id("shifts"),
    taProfileRef: v.id("taProfiles"),
    hoursAllocated: v.optional(v.number()), // async only
    locked: v.boolean(),
    createdBy: v.union(v.literal("solver"), v.literal("manual")),
  })
    .index("by_shift", ["shiftRef"])
    .index("by_profile", ["taProfileRef"]),

  hourLogs: defineTable({
    assignmentRef: v.id("assignments"),
    taProfileRef: v.id("taProfiles"),
    date: v.string(), // ISO date
    hours: v.number(),
    note: v.optional(v.string()),
    status: v.union(
      v.literal("draft"),
      v.literal("submitted"),
      v.literal("approved"),
      v.literal("flagged"),
    ),
  })
    .index("by_profile", ["taProfileRef"])
    .index("by_assignment", ["assignmentRef"]),

  swapRequests: defineTable({
    periodRef: v.id("staffingPeriods"),
    assignmentRef: v.id("assignments"),
    requesterRef: v.id("taProfiles"),
    suggestedTaRef: v.optional(v.id("taProfiles")),
    reason: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("approved"),
      v.literal("declined"),
    ),
  }).index("by_period", ["periodRef"]),

  changeLog: defineTable({
    periodRef: v.id("staffingPeriods"),
    actorRef: v.id("users"),
    action: v.string(),
    before: v.any(),
    after: v.any(),
    at: v.number(), // epoch ms
  }).index("by_period", ["periodRef"]),

  umdCache: defineTable({
    key: v.string(),
    payload: v.any(),
    fetchedAt: v.number(), // epoch ms
  }).index("by_key", ["key"]),
});
