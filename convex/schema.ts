import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const dayValidator = v.union(
  v.literal("M"),
  v.literal("Tu"),
  v.literal("W"),
  v.literal("Th"),
  v.literal("F"),
);

export const sectionTypeValidator = v.union(
  v.literal("lecture"),
  v.literal("discussion"),
  v.literal("lab"),
);

/** sync: fixed slots; async: hours by a due date; window: a range office hours are cut from. */
export const dutyModeValidator = v.union(
  v.literal("sync"),
  v.literal("async"),
  v.literal("window"),
);

export const officeHoursStyleValidator = v.union(
  v.literal("few_long"),
  v.literal("many_short"),
);

export const meetingValidator = v.object({
  day: dayValidator,
  startMin: v.number(),
  endMin: v.number(),
  room: v.string(),
  /**
   * What this meeting is. A UMD section holds both its lecture and its
   * discussion times, so the section's own type cannot say which times a TA
   * should be staffed on. Optional: rows written before this field existed
   * have no kind, and are read as the section's type.
   */
  kind: v.optional(sectionTypeValidator),
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
    /** What the TA asked to be called; falls back to `name` when unset. */
    preferredName: v.optional(v.string()),
    /** Optional, for exam-day reminders. Never shown to other TAs. */
    phone: v.optional(v.string()),
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
    // Instructor(s) of record, from umd.io. Optional: rows imported before
    // this field existed, and any hand-entered section, have none.
    instructors: v.optional(v.array(v.string())),
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
    /** TAs each discussion section needs. Absent means one. */
    taPerSection: v.optional(v.number()),
  }).index("by_coordinator", ["coordinatorRef"]),

  dutyTypes: defineTable({
    periodRef: v.id("staffingPeriods"),
    name: v.string(),
    mode: dutyModeValidator,
    color: v.string(),
    defaultHoursCredit: v.number(),
    /** "window" only: the most office hours a TA is given per week. */
    hoursPerTa: v.optional(v.number()),
    /**
     * "window" only: the fewest office hours a TA must end up with. Absent
     * means the same as the most, i.e. an exact number. Setting it lower
     * lets the generator stop early when the hours left would only fit as a
     * shape the TA said they did not want.
     */
    hoursPerTaMin: v.optional(v.number()),
    /**
     * "window" only: the shortest block the solver may cut, in minutes.
     * Absent means 60 — half-hour office hours are not worth a TA's trip.
     */
    minBlockMinutes: v.optional(v.number()),
    /**
     * "window" only: duty types whose shift times office hours must stay
     * clear of, for everybody — not just the TA holding them.
     */
    noOverlapDutyRefs: v.optional(v.array(v.id("dutyTypes"))),
    /** "window" only: also stay clear of the course's lecture meetings. */
    noOverlapLectures: v.optional(v.boolean()),
    /**
     * Sync only: the most shifts of this kind the solver may give one TA.
     * Absent means no cap. A coordinator placing someone by hand is not
     * bound by it.
     */
    maxPerTa: v.optional(v.number()),
  }).index("by_period", ["periodRef"]),

  shifts: defineTable({
    periodRef: v.id("staffingPeriods"),
    dutyTypeRef: v.id("dutyTypes"),
    /**
     * Sync: TAs the shift needs. Window: the most TAs on duty at once.
     * The ceiling, in other words, in both readings.
     */
    requiredCount: v.number(),
    /**
     * Window only: the fewest TAs that should be on duty at any moment
     * inside it. Absent means none — office hours are cut only to meet each
     * TA's own weekly requirement. Setting it asks the generator to keep the
     * window covered, which is what spreads hours across the day.
     */
    minCount: v.optional(v.number()),
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
    /**
     * Set on an office-hour block the solver cut out of a window shift. The
     * block is a real weekly shift — the schedule, hours and exports treat
     * it like any other — and this is what ties it back to its window so a
     * regenerate can replace it.
     */
    windowRef: v.optional(v.id("shifts")),
    createdBy: v.optional(v.union(v.literal("solver"), v.literal("manual"))),
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
    /**
     * Class times typed by hand when umd.io could not be reached. Treated
     * exactly like enrolled-section meetings when imported blocks are rebuilt.
     */
    manualClassMeetings: v.optional(v.array(meetingValidator)),
    /** Set when the TA finishes (or skips to the end of) the setup wizard. */
    onboardingCompletedAt: v.optional(v.number()),
    /** How they want office hours cut. Absent reads as "few_long". */
    officeHoursStyle: v.optional(officeHoursStyleValidator),
  })
    .index("by_period", ["periodRef"])
    .index("by_user_period", ["userRef", "periodRef"]),

  /**
   * A subscribable calendar address. The secret is the whole credential —
   * long, random and read-only — so a calendar app can keep asking for the
   * schedule without carrying a session. Rotating it is how one is revoked.
   */
  calendarFeeds: defineTable({
    secret: v.string(),
    kind: v.union(v.literal("ta"), v.literal("course")),
    /** Set for a TA's own schedule feed. */
    taProfileRef: v.optional(v.id("taProfiles")),
    periodRef: v.id("staffingPeriods"),
    createdBy: v.id("users"),
    createdAt: v.number(),
  })
    .index("by_secret", ["secret"])
    .index("by_period", ["periodRef"]),

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
    /** Why a coordinator flagged this. Cleared when the flag is lifted. */
    flagNote: v.optional(v.string()),
  })
    .index("by_profile", ["taProfileRef"])
    .index("by_assignment", ["assignmentRef"]),

  swapRequests: defineTable({
    periodRef: v.id("staffingPeriods"),
    assignmentRef: v.id("assignments"),
    /**
     * The shift the assignment pointed at, snapshotted at request time.
     * Approving a permanent swap with no suggested TA deletes the assignment,
     * which used to take the shift's identity with it — the coordinator's log
     * then read "Shan wants out of Duty". The shift itself survives.
     */
    shiftRef: v.optional(v.id("shifts")),
    requesterRef: v.id("taProfiles"),
    suggestedTaRef: v.optional(v.id("taProfiles")),
    reason: v.string(),
    /**
     * How long the swap lasts. "date" covers a single meeting and leaves the
     * recurring assignment alone; "permanent" hands the shift over for the
     * rest of the period. Optional so rows written before this field existed
     * keep working — read them as "permanent", which is what they did.
     */
    scope: v.optional(v.union(v.literal("date"), v.literal("permanent"))),
    /** ISO date, required when `scope` is "date". */
    date: v.optional(v.string()),
    status: v.union(
      v.literal("pending"),
      v.literal("approved"),
      v.literal("declined"),
      v.literal("cancelled"),
    ),
  })
    .index("by_period", ["periodRef"])
    .index("by_requester", ["requesterRef"]),

  /**
   * A one-off substitution on a single date.
   *
   * A date-scoped swap leaves the recurring assignment alone, so the fact that
   * someone else is standing in for one meeting has to live somewhere of its
   * own. The Builder reads these to paint the fill-in over the regular chip on
   * that date; `coverTaRef` stays unset while the slot is still open.
   */
  shiftCoverages: defineTable({
    periodRef: v.id("staffingPeriods"),
    shiftRef: v.id("shifts"),
    date: v.string(), // ISO date
    /** The TA who is out that day. */
    absentTaRef: v.id("taProfiles"),
    /** Who is standing in. Unset means nobody has been found yet. */
    coverTaRef: v.optional(v.id("taProfiles")),
    /** How the cover was chosen. */
    filledBy: v.optional(v.union(v.literal("manual"), v.literal("auto"))),
    /** The approved request this came from, when it came from one. */
    swapRef: v.optional(v.id("swapRequests")),
  })
    .index("by_period", ["periodRef"])
    .index("by_shift_date", ["shiftRef", "date"])
    .index("by_cover", ["coverTaRef"]),

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
