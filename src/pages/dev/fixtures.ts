/**
 * DEV preview fixtures — realistic data mirroring the design-mock scenario:
 * section 0107 unfilled, Daniel's Tue OH class conflict, Priya's Oct 14 exam
 * date exception, Marcus over cap at 11/10h.
 *
 * Only imported from the /dev/preview harness (DEV builds).
 */
import type { Id, TableNames } from "../../../convex/_generated/dataModel";
import type { DayCode } from "../../lib/format";
import type { BuilderFixture } from "../coordinator/Builder";
import type {
  BoardData,
  DutyType,
  RosterRow,
  ShiftRow,
  TaDetailData,
} from "../coordinator/builder/model";
import type { HourLogRow, TaTotalsRow } from "../coordinator/Hours";
import type { PaletteTa } from "../../components/CommandPalette";
import type { PeriodEntry } from "../../lib/period";
import type { ScheduleViewProps } from "../ta/Schedule";
import type { HoursViewProps as TaHoursViewProps } from "../ta/Hours";
import type { PeriodSetupViewProps } from "../coordinator/PeriodSetup";
import type { CoveragePanelViewProps } from "../coordinator/builder/CoveragePanel";
import type { WeekOverlayInput } from "../coordinator/builder/weekOverlay";
import { dateOfDayInWeek } from "../../lib/week";

const fid = <T extends TableNames>(s: string) => s as Id<T>;
const T0 = 1756800000000; // fixture _creationTime

/* ------------------------------------------------------------------ */
/* Period                                                              */
/* ------------------------------------------------------------------ */

export const PERIOD_ID = fid<"staffingPeriods">("preview-period");

export const periodEntry: PeriodEntry = {
  periodId: PERIOD_ID,
  courseId: "CMSC132",
  courseName: "Object-Oriented Programming II",
  term: "Fall 2026",
  status: "generated",
  collectionDeadline: "2026-09-14",
  taProfileId: null,
  label: "CMSC132 · Fall 2026",
};

/* ------------------------------------------------------------------ */
/* Duty types                                                          */
/* ------------------------------------------------------------------ */

function dutyType(
  id: string,
  name: string,
  mode: "sync" | "async",
  color: string,
  defaultHoursCredit: number,
  shiftCount = 0,
): DutyType {
  return {
    _id: fid<"dutyTypes">(id),
    _creationTime: T0,
    periodRef: PERIOD_ID,
    name,
    mode,
    color,
    defaultHoursCredit,
    shiftCount,
  };
}

export const dutyTypes: DutyType[] = [
  dutyType("dt-disc", "Discussion", "sync", "#E21833", 2),
  dutyType("dt-oh", "Office Hours", "sync", "#7D93B2", 2),
  dutyType("dt-grading", "Grading", "async", "#3DD68C", 3),
  dutyType("dt-exam", "Exam Proctoring", "sync", "#F5A524", 2),
];
const [DT_DISC, DT_OH, DT_GRADING, DT_EXAM] = dutyTypes;

/* ------------------------------------------------------------------ */
/* Sections + shifts                                                   */
/* ------------------------------------------------------------------ */

interface SectionSeed {
  id: string;
  number: string;
  day: DayCode;
  startMin: number;
  endMin: number;
  room: string;
}

const SECTION_SEEDS: SectionSeed[] = [
  { id: "sec-0101", number: "0101", day: "M", startMin: 600, endMin: 650, room: "CSI 2118" },
  { id: "sec-0102", number: "0102", day: "M", startMin: 660, endMin: 710, room: "CSI 2118" },
  { id: "sec-0103", number: "0103", day: "Tu", startMin: 600, endMin: 650, room: "CSI 1121" },
  { id: "sec-0104", number: "0104", day: "W", startMin: 600, endMin: 650, room: "CSI 2118" },
  { id: "sec-0105", number: "0105", day: "W", startMin: 660, endMin: 710, room: "CSI 2107" },
  { id: "sec-0106", number: "0106", day: "Th", startMin: 600, endMin: 650, room: "CSI 1121" },
  { id: "sec-0107", number: "0107", day: "Th", startMin: 660, endMin: 710, room: "CSI 1121" },
];

export const boardSections: BoardData["sections"] = SECTION_SEEDS.map((s) => ({
  _id: fid<"sections">(s.id),
  sectionNumber: s.number,
  meetings: [{ day: s.day, startMin: s.startMin, endMin: s.endMin, room: s.room }],
}));

function weeklyShift(
  id: string,
  dutyTypeRef: Id<"dutyTypes">,
  day: DayCode,
  startMin: number,
  endMin: number,
  requiredCount: number,
  availableTaCount: number,
  sectionRef?: Id<"sections">,
  instructor?: string,
  description?: string,
): ShiftRow {
  return {
    _id: fid<"shifts">(id),
    _creationTime: T0,
    periodRef: PERIOD_ID,
    dutyTypeRef,
    requiredCount,
    description,
    sectionInstructors: instructor ? [instructor] : undefined,
    sectionRef,
    recurrence: "weekly",
    day,
    startMin,
    endMin,
    availableTaCount,
  };
}

const discussionShifts: ShiftRow[] = SECTION_SEEDS.map((s, i) =>
  weeklyShift(
    `shift-disc-${s.number}`,
    DT_DISC._id,
    s.day,
    s.startMin,
    s.endMin,
    1,
    // 0107 has almost nobody free — it is the unfilled slot in the mock.
    s.number === "0107" ? 1 : 3 + (i % 3),
    fid<"sections">(s.id),
    // Sections split across two instructors of record, as umd.io reports them.
    Number(s.number) < 105 ? "Anwar Mamat" : "Cliff Bakalian",
    // Real descriptions repeat the duty type, which is what used to push the
    // section number out of a narrow day column.
    `Discussion ${s.number}`,
  ),
);

const ohMonday = weeklyShift("shift-oh-mon", DT_OH._id, "M", 780, 900, 2, 6);
const ohTuesday = weeklyShift("shift-oh-tue", DT_OH._id, "Tu", 840, 960, 2, 3);

/* Collision cases for the week grid's lane splitting.
   - Monday 10:00–10:50 sits exactly on top of section 0101: two blocks, same
     day, same time — the pair must render side by side, while 0102 right after
     it stays full width.
   - Wednesday 10:30–11:40 straddles both 0104 and 0105, so the three of them
     form one cluster: 0104/0105 share a lane (they do not overlap each other)
     and the office-hour block takes the second. */
const ohMondayClash = weeklyShift("shift-oh-mon-clash", DT_OH._id, "M", 600, 650, 1, 1);
const ohWedStraddle = weeklyShift("shift-oh-wed-straddle", DT_OH._id, "W", 630, 700, 1, 0);

const examShift: ShiftRow = {
  _id: fid<"shifts">("shift-exam-midterm"),
  _creationTime: T0,
  periodRef: PERIOD_ID,
  dutyTypeRef: DT_EXAM._id,
  requiredCount: 3,
  description: "Midterm 1 proctoring",
  recurrence: "once",
  date: "2026-10-14",
  startMin: 1140,
  endMin: 1260,
  availableTaCount: 4,
  sectionInstructors: undefined,
};

const gradingPool: ShiftRow = {
  _id: fid<"shifts">("shift-grading"),
  _creationTime: T0,
  periodRef: PERIOD_ID,
  dutyTypeRef: DT_GRADING._id,
  requiredCount: 0,
  description: "Project + quiz grading",
  hoursRequired: 40,
  dueDate: "2026-12-14",
  availableTaCount: 6,
  sectionInstructors: undefined,
};

export const shifts: ShiftRow[] = [
  ...discussionShifts,
  ohMonday,
  ohTuesday,
  ohMondayClash,
  ohWedStraddle,
  examShift,
  gradingPool,
];

/* ------------------------------------------------------------------ */
/* Roster                                                              */
/* ------------------------------------------------------------------ */

function rosterRow(
  id: string,
  name: string,
  email: string,
  opts: Partial<RosterRow> = {},
): RosterRow {
  return {
    taProfileRef: fid<"taProfiles">(id),
    userRef: fid<"users">(`user-${id}`),
    name,
    email,
    invitePending: false,
    status: "submitted",
    availabilitySubmittedAt: T0,
    maxHoursPerWeek: 10,
    syncAsyncPreference: 0.5,
    topDutyTypeNames: ["Discussion", "Office Hours"],
    sectionPrefCount: 2,
    assignedWeeklyHours: 0,
    assignedOnceHours: 0,
    assignedAsyncHours: 0,
    ...opts,
  };
}

export const roster: RosterRow[] = [
  rosterRow("ta-priya", "Priya Shah", "pshah@umd.edu", {
    assignedWeeklyHours: 1.7,
    assignedOnceHours: 2,
    topDutyTypeNames: ["Discussion", "Grading", "Office Hours"],
    syncAsyncPreference: 0.4,
  }),
  rosterRow("ta-daniel", "Daniel Chen", "dchen@umd.edu", {
    maxHoursPerWeek: 8,
    assignedWeeklyHours: 2.8,
    syncAsyncPreference: 0.35,
    sectionPrefCount: 3,
  }),
  rosterRow("ta-marcus", "Marcus Johnson", "mjohnson@umd.edu", {
    assignedWeeklyHours: 11, // over the 10h cap — mock scenario
    topDutyTypeNames: ["Office Hours", "Exam Proctoring"],
    syncAsyncPreference: 0.2,
  }),
  rosterRow("ta-sarah", "Sarah Kim", "skim@umd.edu", {
    assignedWeeklyHours: 4.8,
    assignedAsyncHours: 12,
    syncAsyncPreference: 0.7,
  }),
  rosterRow("ta-alex", "Alex Rivera", "arivera@umd.edu", {
    status: "missing",
    availabilitySubmittedAt: undefined,
    maxHoursPerWeek: 12,
    // Assigned despite never submitting availability — the load must show.
    assignedWeeklyHours: 0.8,
    topDutyTypeNames: [],
    sectionPrefCount: 0,
  }),
  rosterRow("ta-emma", "Emma Wilson", "ewilson@umd.edu", {
    assignedWeeklyHours: 3.5,
    assignedAsyncHours: 20,
    topDutyTypeNames: ["Grading", "Discussion"],
    syncAsyncPreference: 0.8,
  }),
];
const [PRIYA, DANIEL, MARCUS, SARAH, ALEX, EMMA] = roster;
void ALEX;

/* ------------------------------------------------------------------ */
/* Builder board                                                       */
/* ------------------------------------------------------------------ */

function assignment(
  id: string,
  shiftRef: Id<"shifts">,
  taProfileRef: Id<"taProfiles">,
  opts: Partial<BoardData["assignments"][number]> = {},
): BoardData["assignments"][number] {
  return {
    _id: fid<"assignments">(id),
    shiftRef,
    taProfileRef,
    locked: false,
    createdBy: "solver",
    ...opts,
  };
}

const assignments: BoardData["assignments"] = [
  assignment("as-0101", discussionShifts[0]._id, PRIYA.taProfileRef),
  assignment("as-0102", discussionShifts[1]._id, DANIEL.taProfileRef),
  assignment("as-0103", discussionShifts[2]._id, MARCUS.taProfileRef),
  assignment("as-0104", discussionShifts[3]._id, SARAH.taProfileRef, { locked: true }),
  assignment("as-0105", discussionShifts[4]._id, EMMA.taProfileRef),
  assignment("as-0106", discussionShifts[5]._id, PRIYA.taProfileRef),
  // 0107 intentionally unfilled (design-mock scenario)
  // Alex has not submitted availability but IS assigned — the roster row must
  // still show real numbers, with the "no availability" warning beside them.
  assignment("as-oh-mon-clash", ohMondayClash._id, ALEX.taProfileRef),
  assignment("as-oh-mon-1", ohMonday._id, MARCUS.taProfileRef),
  assignment("as-oh-mon-2", ohMonday._id, SARAH.taProfileRef),
  assignment("as-oh-tue-1", ohTuesday._id, DANIEL.taProfileRef),
  assignment("as-exam-1", examShift._id, PRIYA.taProfileRef, { createdBy: "manual" }),
  assignment("as-exam-2", examShift._id, MARCUS.taProfileRef),
  assignment("as-grading-1", gradingPool._id, EMMA.taProfileRef, { hoursAllocated: 20 }),
  assignment("as-grading-2", gradingPool._id, SARAH.taProfileRef, {
    hoursAllocated: 12,
    createdBy: "manual",
  }),
];

export const board: BoardData = {
  assignments,
  conflicts: [
    {
      assignmentRef: fid<"assignments">("as-oh-tue-1"),
      taProfileRef: DANIEL.taProfileRef,
      shiftRef: ohTuesday._id,
      type: "class_conflict",
      detail: "Overlaps CMSC351 lecture · Tu 2:00–3:15 PM",
    },
    {
      assignmentRef: fid<"assignments">("as-exam-1"),
      taProfileRef: PRIYA.taProfileRef,
      shiftRef: examShift._id,
      type: "unavailable",
      detail: "Date exception Oct 14–16 · out of town",
    },
    {
      assignmentRef: fid<"assignments">("as-oh-mon-1"),
      taProfileRef: MARCUS.taProfileRef,
      shiftRef: ohMonday._id,
      type: "over_cap",
      detail: "11h assigned vs 10h/wk cap",
    },
  ],
  taLoads: [
    { taProfileRef: PRIYA.taProfileRef, weeklyHours: 1.7, maxHoursPerWeek: 10 },
    { taProfileRef: DANIEL.taProfileRef, weeklyHours: 2.8, maxHoursPerWeek: 8 },
    { taProfileRef: MARCUS.taProfileRef, weeklyHours: 11, maxHoursPerWeek: 10 },
    { taProfileRef: SARAH.taProfileRef, weeklyHours: 4.8, maxHoursPerWeek: 10 },
    { taProfileRef: ALEX.taProfileRef, weeklyHours: 0.8, maxHoursPerWeek: 12 },
    { taProfileRef: EMMA.taProfileRef, weeklyHours: 3.5, maxHoursPerWeek: 10 },
  ],
  sections: boardSections,
};

export const builderFixture: BuilderFixture = {
  shifts,
  dutyTypes,
  roster,
  board,
  status: "generated",
  courseLabel: "CMSC132 · Fall 2026",
};

/** Monday of the mock week — the same week the TA schedule fixture uses. */
export const BUILDER_WEEK_START = "2026-09-14";

/**
 * One week where the template is not the truth: a covered absence, an
 * uncovered one, and a shift out of term. Every marker the board can draw for
 * a week, so the preview shows all three side by side.
 */
export const builderWeek: WeekOverlayInput = {
  weekStart: BUILDER_WEEK_START,
  weekEnd: dateOfDayInWeek(BUILDER_WEEK_START, "F"),
  dormantShiftRefs: [ohTuesday._id],
  eventShiftRefs: [],
  absences: [
    {
      taProfileRef: MARCUS.taProfileRef,
      name: "Marcus Webb",
      reason: "Interview",
      dates: [dateOfDayInWeek(BUILDER_WEEK_START, discussionShifts[2].day as DayCode)],
    },
    {
      taProfileRef: PRIYA.taProfileRef,
      name: "Priya Shah",
      reason: "Conference travel",
      dates: [dateOfDayInWeek(BUILDER_WEEK_START, discussionShifts[0].day as DayCode)],
    },
  ],
  coverages: [
    {
      shiftRef: discussionShifts[0]._id,
      date: dateOfDayInWeek(BUILDER_WEEK_START, discussionShifts[0].day as DayCode),
      day: discussionShifts[0].day as DayCode,
      absentTaRef: PRIYA.taProfileRef,
      absentName: "Priya Shah",
      coverTaRef: DANIEL.taProfileRef,
      coverName: "Daniel Chen",
    },
    {
      shiftRef: discussionShifts[2]._id,
      date: dateOfDayInWeek(BUILDER_WEEK_START, discussionShifts[2].day as DayCode),
      day: discussionShifts[2].day as DayCode,
      absentTaRef: MARCUS.taProfileRef,
      absentName: "Marcus Webb",
      coverTaRef: null,
      coverName: null,
    },
    // The hole was filled by editing the roster rather than by recording a
    // substitute: Sarah came off the shift and Emma went on. No coverTaRef is
    // ever written that way, so the slot has to read the board to notice.
    {
      shiftRef: discussionShifts[4]._id,
      date: dateOfDayInWeek(BUILDER_WEEK_START, discussionShifts[4].day as DayCode),
      day: discussionShifts[4].day as DayCode,
      absentTaRef: SARAH.taProfileRef,
      absentName: "Sarah Kim",
      coverTaRef: null,
      coverName: null,
    },
  ],
};

/** Drawer payload for Daniel Chen (his Tue OH assignment conflicts). */
export const danielDetail: TaDetailData = {
  name: "Daniel Chen",
  email: "dchen@umd.edu",
  maxHoursPerWeek: 8,
  syncAsyncPreference: 0.35,
  availabilitySubmitted: true,
  dutyTypePrefNames: ["Discussion", "Office Hours", "Grading"],
  sectionPrefNumbers: ["0102", "0103"],
  enrolledSectionNumbers: ["0101"],
  blocks: [
    { day: "M", startMin: 540, endMin: 720, status: "available", source: "manual" },
    { day: "M", startMin: 720, endMin: 840, status: "prefer_not", source: "manual" },
    { day: "Tu", startMin: 540, endMin: 840, status: "available", source: "manual" },
    { day: "Tu", startMin: 840, endMin: 915, status: "unavailable", source: "imported_class" },
    { day: "W", startMin: 540, endMin: 1020, status: "available", source: "manual" },
    { day: "Th", startMin: 600, endMin: 900, status: "available", source: "manual" },
    { day: "F", startMin: 540, endMin: 660, status: "prefer_not", source: "manual" },
  ],
  exceptions: [
    { startDate: "2026-11-25", endDate: "2026-11-27", reason: "Thanksgiving travel" },
  ],
};

export const danielId = DANIEL.taProfileRef;

/* ------------------------------------------------------------------ */
/* Command palette                                                     */
/* ------------------------------------------------------------------ */

export const paletteTas: PaletteTa[] = roster.map((r) => ({
  taProfileRef: r.taProfileRef as string,
  name: r.name,
  email: r.email,
}));

/* ------------------------------------------------------------------ */
/* Coordinator hours-approval queue                                    */
/* ------------------------------------------------------------------ */

function hourLog(
  id: string,
  ta: RosterRow,
  dt: DutyType,
  shiftRef: Id<"shifts">,
  date: string,
  hours: number,
  status: HourLogRow["status"],
  note?: string,
): HourLogRow {
  return {
    hourLogId: fid<"hourLogs">(id),
    assignmentRef: fid<"assignments">(`as-log-${id}`),
    shiftRef,
    dutyTypeRef: dt._id,
    dutyTypeName: dt.name,
    taProfileRef: ta.taProfileRef,
    taName: ta.name,
    taEmail: ta.email,
    date,
    hours,
    status,
    note,
    // The coordinator's flag reason is a separate field from the TA's note.
    flagNote: status === "flagged" ? note : undefined,
  };
}

export const hourLogs: HourLogRow[] = [
  hourLog("hl-1", PRIYA, DT_DISC, discussionShifts[0]._id, "2026-09-14", 1, "submitted"),
  hourLog("hl-2", PRIYA, DT_DISC, discussionShifts[5]._id, "2026-09-17", 1, "submitted"),
  hourLog("hl-3", DANIEL, DT_OH, ohTuesday._id, "2026-09-15", 2, "submitted"),
  hourLog("hl-4", MARCUS, DT_OH, ohMonday._id, "2026-09-14", 2, "approved"),
  hourLog(
    "hl-5",
    MARCUS,
    DT_OH,
    ohMonday._id,
    "2026-09-16",
    4.5,
    "flagged",
    "Logged 4.5h against a 2h block — double-check with Marcus.",
  ),
  hourLog("hl-6", SARAH, DT_GRADING, gradingPool._id, "2026-09-16", 3, "submitted", "P1 grading batch"),
  hourLog("hl-7", EMMA, DT_GRADING, gradingPool._id, "2026-09-18", 2.5, "draft"),
];

export const taTotals: TaTotalsRow[] = [
  {
    taProfileRef: PRIYA.taProfileRef,
    taName: PRIYA.name,
    taEmail: PRIYA.email,
    approvedHours: 3,
    submittedHours: 2,
    flaggedHours: 0,
    maxHoursPerWeek: 10,
  },
  {
    taProfileRef: DANIEL.taProfileRef,
    taName: DANIEL.name,
    taEmail: DANIEL.email,
    approvedHours: 2,
    submittedHours: 2,
    flaggedHours: 0,
    maxHoursPerWeek: 8,
  },
  {
    taProfileRef: MARCUS.taProfileRef,
    taName: MARCUS.name,
    taEmail: MARCUS.email,
    approvedHours: 7.5,
    submittedHours: 0,
    flaggedHours: 4.5,
    maxHoursPerWeek: 10,
  },
  {
    taProfileRef: SARAH.taProfileRef,
    taName: SARAH.name,
    taEmail: SARAH.email,
    approvedHours: 4,
    submittedHours: 3,
    flaggedHours: 0,
    maxHoursPerWeek: 10,
  },
];

/* ------------------------------------------------------------------ */
/* TA schedule + hours (Priya's point of view)                         */
/* ------------------------------------------------------------------ */

type ScheduleItems = ScheduleViewProps["items"];
type ScheduleHourLogs = ScheduleViewProps["hourLogs"];

function scheduleItem(
  assignmentId: string,
  shift: ShiftRow,
  dt: DutyType,
  opts: { hoursAllocated?: number; locked?: boolean } = {},
): ScheduleItems[number] {
  const { availableTaCount, ...shiftDoc } = shift;
  void availableTaCount;
  return {
    assignment: {
      _id: fid<"assignments">(assignmentId),
      _creationTime: T0,
      shiftRef: shift._id,
      taProfileRef: PRIYA.taProfileRef,
      hoursAllocated: opts.hoursAllocated,
      locked: opts.locked ?? false,
      createdBy: "solver",
    },
    shift: shiftDoc,
    dutyType: dt,
  };
}

export const scheduleItems: ScheduleItems = [
  scheduleItem("sa-1", discussionShifts[0], DT_DISC),
  scheduleItem("sa-2", discussionShifts[5], DT_DISC),
  scheduleItem("sa-3", ohMonday, DT_OH),
  scheduleItem("sa-4", examShift, DT_EXAM, { locked: true }),
  scheduleItem("sa-5", gradingPool, DT_GRADING, { hoursAllocated: 3 }),
];

export const taHourLogs: ScheduleHourLogs = [
  {
    _id: fid<"hourLogs">("ta-hl-1"),
    _creationTime: T0,
    assignmentRef: fid<"assignments">("sa-1"),
    taProfileRef: PRIYA.taProfileRef,
    date: "2026-09-14",
    hours: 1,
    status: "approved",
  },
  {
    _id: fid<"hourLogs">("ta-hl-2"),
    _creationTime: T0,
    assignmentRef: fid<"assignments">("sa-3"),
    taProfileRef: PRIYA.taProfileRef,
    date: "2026-09-14",
    hours: 2,
    status: "submitted",
  },
  {
    _id: fid<"hourLogs">("ta-hl-3"),
    _creationTime: T0,
    assignmentRef: fid<"assignments">("sa-5"),
    taProfileRef: PRIYA.taProfileRef,
    date: "2026-09-16",
    hours: 1.5,
    note: "Graded quiz 2",
    status: "draft",
  },
  // The flagged case: the TA has to be able to see why and fix it in place.
  {
    _id: fid<"hourLogs">("ta-hl-4"),
    _creationTime: T0,
    assignmentRef: fid<"assignments">("sa-5"),
    taProfileRef: PRIYA.taProfileRef,
    date: "2026-09-17",
    hours: 6,
    note: "Grading marathon",
    status: "flagged",
    flagNote: "6h on one day is over the daily cap — split this across two days.",
  },
];

export const pendingSwaps: ScheduleViewProps["pendingSwaps"] = [
  {
    id: "swap-1",
    label: "Discussion 0106 · Thu 10:00–10:50 AM",
    reason: "Conference travel that week",
    status: "pending",
    scope: "date",
    date: "2026-10-08",
  },
  {
    id: "swap-2",
    label: "Office Hours · Mon 2:00–4:00 PM",
    reason: "Recurring doctor appointment on Mondays",
    status: "approved",
    scope: "permanent",
    suggestedName: "Ravi Patel",
  },
];

export const coverageNotices: ScheduleViewProps["coverage"] = [
  {
    id: "cov-1",
    date: "2026-10-08",
    label: "Discussion 0106",
    role: "off",
    otherName: "Ravi Patel",
  },
  {
    id: "cov-2",
    date: "2026-10-15",
    label: "Office Hours",
    role: "covering",
    otherName: "Ana Cruz",
  },
];

export const TA_WEEK_START = "2026-09-14";

export type { TaHoursViewProps };

/* ------------------------------------------------------------------ */
/* Period setup                                                        */
/* ------------------------------------------------------------------ */

/* CMSC330's real shape: one section holds a Tu/Th lecture AND a Friday
   discussion, so "which meetings do TAs staff?" is not rhetorical — staffing
   the whole section used to put the lecture on the shift board too. */
function setupSection(
  id: string,
  number: string,
  instructor: string,
): SetupSection {
  return {
    _id: fid<"sections">(id),
    _creationTime: T0,
    courseRef: fid<"courses">("course-cmsc330"),
    sectionNumber: number,
    type: "discussion",
    instructors: [instructor],
    meetings: [
      { day: "Tu", startMin: 570, endMin: 645, room: "IRB 0324", kind: "lecture" },
      { day: "Th", startMin: 570, endMin: 645, room: "IRB 0324", kind: "lecture" },
      { day: "F", startMin: 540, endMin: 590, room: "IRB 1207", kind: "discussion" },
    ],
  };
}

type SetupSection = NonNullable<PeriodSetupViewProps["sections"]>[number];

export const setupSections: SetupSection[] = [
  setupSection("sec-p-0101", "0101", "Anwar Mamat"),
  setupSection("sec-p-0102", "0102", "Anwar Mamat"),
  setupSection("sec-p-0201", "0201", "Cliff Bakalian"),
];

export const setupImportResult: PeriodSetupViewProps["importResult"] = {
  courseRef: fid<"courses">("course-cmsc330"),
  courseName: "Organization of Programming Languages",
  sectionRefs: setupSections.map((s) => s._id),
  source: "umdio",
  sectionsImported: setupSections.length,
};

export const setupPeriods: PeriodSetupViewProps["periods"] = [
  {
    period: {
      _id: PERIOD_ID,
      _creationTime: T0,
      courseRef: fid<"courses">("course-cmsc132"),
      term: "202608",
      coordinatorRef: fid<"users">("user-coord"),
      collectionDeadline: "2026-09-14",
      status: "generated",
    },
    course: {
      _id: fid<"courses">("course-cmsc132"),
      _creationTime: T0,
      courseId: "CMSC132",
      term: "202608",
      name: "Object-Oriented Programming II",
    },
    taProfileId: null,
  },
];

/* ------------------------------------------------------------------ */
/* One-off coverage (Builder panel)                                    */
/* ------------------------------------------------------------------ */

export const coverageRows: CoveragePanelViewProps["rows"] = [
  {
    id: "cov-1",
    date: "2026-09-04",
    label: "Discussion 0101",
    startMin: 660,
    endMin: 710,
    absentName: "Shan Pothukuchi",
    coverTaRef: null,
    coverName: null,
    filledBy: null,
    reason: "Conference travel that week",
  },
  {
    id: "cov-2",
    date: "2026-09-11",
    label: "Office Hours",
    startMin: 780,
    endMin: 900,
    absentName: "Daniel Chen",
    coverTaRef: "ta-priya",
    coverName: "Priya Shah",
    filledBy: "auto",
    reason: null,
  },
  {
    id: "cov-3",
    date: "2026-09-18",
    label: "Exam Proctoring · Midterm 1",
    startMin: 1140,
    endMin: 1260,
    absentName: "Marcus Johnson",
    coverTaRef: null,
    coverName: null,
    filledBy: null,
    reason: "Family obligation, cleared with the coordinator in advance",
  },
];

export const coverageCandidates: NonNullable<CoveragePanelViewProps["candidates"]> = [
  { taProfileRef: "ta-priya", name: "Priya Shah", fit: "available", assignedCount: 2 },
  { taProfileRef: "ta-sarah", name: "Sarah Kim", fit: "prefer_not", assignedCount: 1 },
];

/* ------------------------------------------------------------------ */
/* One dated week of a TA schedule                                     */
/* ------------------------------------------------------------------ */

/* The week of Mon 2026-09-14, carrying every state the grid can show:
   a normal meeting, one handed off to somebody else, one this TA is
   covering, and one on a day they marked themselves away. */
export const TA_WEEK_START_DATED = "2026-09-14";

export const weekOccurrences: NonNullable<ScheduleViewProps["weekOccurrences"]> = [
  {
    key: "occ-1",
    date: "2026-09-14",
    day: "M",
    startMin: 600,
    endMin: 650,
    title: "Discussion 0101",
    color: "#E21833",
    state: "normal",
    otherName: null,
    note: null,
    swapTarget: { assignmentRef: "sa-1", label: "Discussion 0101", detail: "M 10:00a" },
  },
  {
    key: "occ-2",
    date: "2026-09-14",
    day: "M",
    startMin: 780,
    endMin: 900,
    title: "Office Hours",
    color: "#7D93B2",
    state: "off",
    otherName: "Ravi Patel",
    note: null,
    swapTarget: null,
  },
  {
    key: "occ-3",
    date: "2026-09-16",
    day: "W",
    startMin: 660,
    endMin: 710,
    title: "Discussion 0104",
    color: "#E21833",
    state: "covering",
    otherName: "Daniel Chen",
    note: null,
    swapTarget: null,
  },
  {
    key: "occ-4",
    date: "2026-09-17",
    day: "Th",
    startMin: 600,
    endMin: 650,
    title: "Discussion 0106",
    color: "#E21833",
    state: "excepted",
    otherName: null,
    note: "Conference travel",
    swapTarget: { assignmentRef: "sa-3", label: "Discussion 0106", detail: "Th 10:00a" },
  },
];

export const weekExceptions: NonNullable<ScheduleViewProps["weekExceptions"]> = [
  {
    id: "exc-1",
    startDate: "2026-09-17",
    endDate: "2026-09-17",
    reason: "Conference travel",
  },
];
