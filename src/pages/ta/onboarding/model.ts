/**
 * Shared contract for the TA setup wizard.
 *
 * The wizard is four steps plus a done screen. Every step is a pure component
 * taking `value` + `onChange` over its slice of {@link WizardState}; the
 * container in Wizard.tsx owns persistence, so the same step components are
 * reused as editable sections on the Preferences page.
 */
import type { Id } from "../../../../convex/_generated/dataModel";
import type { DayCode } from "../../../lib/format";

export const WIZARD_STEPS = [
  { key: "basics", title: "Welcome" },
  { key: "classes", title: "Your classes" },
  { key: "availability", title: "Your availability" },
  { key: "preferences", title: "Preferences" },
] as const;

export type StepKey = (typeof WIZARD_STEPS)[number]["key"];

/** "Step 2 of 4 · Your classes" */
export function stepLabel(index: number): string {
  const step = WIZARD_STEPS[index];
  return `Step ${index + 1} of ${WIZARD_STEPS.length} · ${step.title}`;
}

/* ------------------------------------------------------------------ */
/* Step 1 — basics                                                     */
/* ------------------------------------------------------------------ */

export interface BasicsValue {
  preferredName: string;
  phone: string;
}

/* ------------------------------------------------------------------ */
/* Step 2 — classes                                                    */
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

/** A course the TA has added, with the section they picked per type. */
export interface EnrolledCourse {
  courseId: string;
  courseName: string;
  /** All sections offered, so the card's Edit action can re-open the picker. */
  sections: EnrollableSection[];
  /** Chosen section id per section type. At most one of each. */
  selectedSectionIds: Id<"sections">[];
}

/** A class time typed by hand when umd.io is unreachable. */
export interface ManualClass {
  /** Local-only key; manual classes are stored as bare meetings. */
  key: string;
  label: string;
  day: DayCode;
  startMin: number;
  endMin: number;
}

export interface ClassesValue {
  courses: EnrolledCourse[];
  manual: ManualClass[];
  /** "This is all my classes" — gates Continue on step 2. */
  confirmedComplete: boolean;
}

/** Every meeting the grid should lock, across picked sections and manual rows. */
export function lockedMeetings(value: ClassesValue): Array<ClassMeeting & { label: string }> {
  const out: Array<ClassMeeting & { label: string }> = [];
  for (const course of value.courses) {
    for (const section of course.sections) {
      if (!course.selectedSectionIds.includes(section._id)) continue;
      for (const meeting of section.meetings) {
        out.push({ ...meeting, label: course.courseId });
      }
    }
  }
  for (const m of value.manual) {
    out.push({
      day: m.day,
      startMin: m.startMin,
      endMin: m.endMin,
      room: "",
      label: m.label || "Class",
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Step 4 — preferences                                                */
/* ------------------------------------------------------------------ */

export interface PreferencesValue {
  maxHoursPerWeek: number;
  /** 0 = all synchronous, 1 = all asynchronous. */
  syncAsyncPreference: number;
  dutyTypePrefs: Id<"dutyTypes">[];
  sectionPrefs: Id<"sections">[];
  /** "No preference" for staffed sections. */
  noSectionPreference: boolean;
}

export const MIN_HOURS = 2;
export const MAX_HOURS = 20;
export const DEFAULT_HOURS = 10;

/* ------------------------------------------------------------------ */
/* Whole-wizard state                                                  */
/* ------------------------------------------------------------------ */

export interface WizardState {
  basics: BasicsValue;
  classes: ClassesValue;
  preferences: PreferencesValue;
}

export function emptyWizardState(): WizardState {
  return {
    basics: { preferredName: "", phone: "" },
    classes: { courses: [], manual: [], confirmedComplete: false },
    preferences: {
      maxHoursPerWeek: DEFAULT_HOURS,
      syncAsyncPreference: 0.5,
      dutyTypePrefs: [],
      sectionPrefs: [],
      noSectionPreference: false,
    },
  };
}
