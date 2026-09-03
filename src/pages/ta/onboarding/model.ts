/**
 * Shared contract for the TA setup wizard.
 *
 * Structure follows the Claude Design reference
 * (design/terpta-onboarding-ref/onboarding-spec.md): three steps, no welcome
 * screen, no completion screen, no Back and no gating. Finishing lands the TA
 * in the live app, where "Submit availability" is the real terminal action.
 * The visual language stays this project's dark system.
 *
 * Every step is a pure component over its slice of {@link WizardState}, so the
 * same components are reused as editable sections on the Preferences page.
 */
import type { Id } from "../../../../convex/_generated/dataModel";
import type { DayCode } from "../../../lib/format";

export const WIZARD_STEPS = [
  { key: "courses", title: "Courses", continueLabel: "Continue to availability" },
  {
    key: "availability",
    title: "Availability",
    continueLabel: "Continue to preferences",
  },
  { key: "preferences", title: "Preferences", continueLabel: "Finish setup" },
] as const;

export type StepKey = (typeof WIZARD_STEPS)[number]["key"];

/* ------------------------------------------------------------------ */
/* Step 1 — courses                                                    */
/* ------------------------------------------------------------------ */

export interface ClassMeeting {
  day: DayCode;
  startMin: number;
  endMin: number;
  room: string;
}

/** A section of a course the TA is enrolled in, as umd.io describes it. */
export interface EnrollableSection {
  _id: Id<"sections">;
  sectionNumber: string;
  type: "lecture" | "discussion" | "lab";
  meetings: ClassMeeting[];
  instructors?: string[];
}

/**
 * A course the TA has added. The reference commits a course straight from the
 * search result with a default section per type, so there is no separate
 * picking step; `selectedSectionIds` stays editable from the preview card.
 */
export interface EnrolledCourse {
  courseId: string;
  courseName: string;
  sections: EnrollableSection[];
  selectedSectionIds: Id<"sections">[];
}

/** A class time typed by hand. Offered on step 2, not step 1. */
export interface ManualClass {
  key: string;
  label: string;
  day: DayCode;
  startMin: number;
  endMin: number;
}

export interface ClassesValue {
  courses: EnrolledCourse[];
  manual: ManualClass[];
}

/** One row of the "Pulled from Schedule of Classes" card. */
export interface PreviewMeeting extends ClassMeeting {
  courseId: string;
  /** e.g. "Discussion 0201 · IRB 1207" */
  description: string;
  /** Ghosted dashed row: a highlighted search result, not yet committed. */
  preview: boolean;
}

/**
 * Split "CMSC330 0201" into its course and section parts.
 *
 * The search box takes both, so a TA adds the exact section they are in rather
 * than accepting whatever default a course happens to list first. Returns a
 * null courseId while the code is still incomplete ("CMSC3"), which is the
 * signal to keep suggesting courses instead of sections.
 */
export function parseCourseQuery(raw: string): {
  courseId: string | null;
  sectionPrefix: string;
} {
  const q = raw.trim().toUpperCase().replace(/\s+/g, " ");
  const m = q.match(/^([A-Z]{2,4}\d{3}[A-Z]?)[\s-]*(\d*)$/);
  return m ? { courseId: m[1], sectionPrefix: m[2] } : { courseId: null, sectionPrefix: "" };
}

/** "CMSC330 0201" — what a committed course reads as in the input. */
export function chipLabel(course: EnrolledCourse): string {
  const numbers = course.sections
    .filter((s) => course.selectedSectionIds.includes(s._id))
    .map((s) => s.sectionNumber);
  return numbers.length > 0
    ? `${course.courseId} ${numbers.join("/")}`
    : course.courseId;
}

/** Default section per type — the first of each, matching the reference. */
export function defaultSectionIds(sections: EnrollableSection[]): Id<"sections">[] {
  const byType = new Map<string, EnrollableSection>();
  for (const s of sections) {
    if (!byType.has(s.type)) byType.set(s.type, s);
  }
  return [...byType.values()].map((s) => s._id);
}

function sectionLabel(section: EnrollableSection, meeting: ClassMeeting): string {
  const kind =
    section.type === "discussion"
      ? "Discussion"
      : section.type === "lab"
        ? "Lab"
        : "Lecture";
  return meeting.room
    ? `${kind} ${section.sectionNumber} · ${meeting.room}`
    : `${kind} ${section.sectionNumber}`;
}

/** Rows for the import preview card, committed first then any ghosted ones. */
export function previewMeetings(
  value: ClassesValue,
  ghost?: { courseId: string; sections: EnrollableSection[] } | null,
): PreviewMeeting[] {
  const out: PreviewMeeting[] = [];
  for (const course of value.courses) {
    for (const section of course.sections) {
      if (!course.selectedSectionIds.includes(section._id)) continue;
      for (const meeting of section.meetings) {
        out.push({
          ...meeting,
          courseId: course.courseId,
          description: sectionLabel(section, meeting),
          preview: false,
        });
      }
    }
  }
  for (const m of value.manual) {
    out.push({
      day: m.day,
      startMin: m.startMin,
      endMin: m.endMin,
      room: "",
      courseId: m.label || "Class",
      description: "Added by hand",
      preview: false,
    });
  }
  if (ghost && !value.courses.some((c) => c.courseId === ghost.courseId)) {
    for (const id of defaultSectionIds(ghost.sections)) {
      const section = ghost.sections.find((s) => s._id === id);
      if (!section) continue;
      for (const meeting of section.meetings) {
        out.push({
          ...meeting,
          courseId: ghost.courseId,
          description: sectionLabel(section, meeting),
          preview: true,
        });
      }
    }
  }
  return out;
}

/** "5 meetings · 2 courses", counting the ghosted rows too. */
export function previewSummary(rows: PreviewMeeting[]): string {
  const courses = new Set(rows.map((r) => r.courseId)).size;
  const m = rows.length;
  return `${m} meeting${m === 1 ? "" : "s"} · ${courses} course${courses === 1 ? "" : "s"}`;
}

/* ------------------------------------------------------------------ */
/* Step 3 — preferences                                                */
/* ------------------------------------------------------------------ */

export interface PreferencesValue {
  maxHoursPerWeek: number;
  /** Multi-select, in click order; the backend reads it as a ranking. */
  dutyTypePrefs: Id<"dutyTypes">[];
  /** Ranked, best first. Empty means no preference. */
  sectionPrefs: Id<"sections">[];
}

export const MIN_HOURS = 4;
export const MAX_HOURS = 20;
export const DEFAULT_HOURS = 10;

/**
 * The reference drops the sync/async slider for flat duty pills, but the
 * solver still needs the axis — so derive it from what they picked: all-sync
 * duties give 0, all-async 1, a mix lands in between.
 */
export function syncAsyncFromDuties(
  selected: Id<"dutyTypes">[],
  dutyTypes: Array<{ _id: Id<"dutyTypes">; mode: "sync" | "async" }>,
): number {
  const modes = selected
    .map((id) => dutyTypes.find((d) => d._id === id)?.mode)
    .filter((m): m is "sync" | "async" => m !== undefined);
  if (modes.length === 0) return 0.5;
  return modes.filter((m) => m === "async").length / modes.length;
}

/* ------------------------------------------------------------------ */
/* Cross-step validation                                               */
/* ------------------------------------------------------------------ */

export interface SchedulableSection {
  _id: Id<"sections">;
  sectionNumber: string;
  meetings: Array<{ day: DayCode; startMin: number; endMin: number }>;
  /** Instructor of record, when umd.io supplied one. */
  instructors?: string[];
}

/**
 * Advisory only, never blocking: a staffed section whose meeting collides with
 * an imported class time, flagged with whether the TA has ranked it.
 */
export interface SectionConflict {
  sectionId: Id<"sections">;
  sectionNumber: string;
  day: DayCode;
  startMin: number;
  courseId: string;
  ranked: boolean;
}

export function findConflicts(
  classes: ClassesValue,
  sections: SchedulableSection[],
  sectionPrefs: Id<"sections">[],
): SectionConflict[] {
  const blocks = previewMeetings(classes).filter((m) => !m.preview);
  const out: SectionConflict[] = [];
  for (const section of sections) {
    for (const meeting of section.meetings) {
      const hit = blocks.find(
        (b) =>
          b.day === meeting.day &&
          b.startMin < meeting.endMin &&
          meeting.startMin < b.endMin,
      );
      if (!hit) continue;
      out.push({
        sectionId: section._id,
        sectionNumber: section.sectionNumber,
        day: meeting.day,
        startMin: meeting.startMin,
        courseId: hit.courseId,
        ranked: sectionPrefs.includes(section._id),
      });
      break;
    }
  }
  return out;
}

/**
 * Conflicts keyed by section id, so a section row can ask "can this TA
 * actually be here?" in one lookup instead of re-scanning the list.
 */
export function conflictBySectionId(
  conflicts: SectionConflict[],
): Map<string, SectionConflict> {
  return new Map(conflicts.map((c) => [String(c.sectionId), c]));
}

/* ------------------------------------------------------------------ */
/* Whole-wizard state                                                  */
/* ------------------------------------------------------------------ */

export interface WizardState {
  classes: ClassesValue;
  preferences: PreferencesValue;
}

export function emptyWizardState(): WizardState {
  return {
    classes: { courses: [], manual: [] },
    preferences: {
      maxHoursPerWeek: DEFAULT_HOURS,
      dutyTypePrefs: [],
      sectionPrefs: [],
    },
  };
}
