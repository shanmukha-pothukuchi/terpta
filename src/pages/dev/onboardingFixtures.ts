/**
 * Fixture data for the TA setup wizard previews (/dev/preview/onboarding-*).
 *
 * Mirrors the shape of the real CMSC132 Fall 2026 seed so the preview screens
 * exercise the same code paths as production, without auth or a backend.
 */
import type { Id } from "../../../convex/_generated/dataModel";
import type {
  ClassesValue,
  EnrollableSection,
  PreferencesValue,
} from "../ta/onboarding/model";

const sid = (n: string) => n as unknown as Id<"sections">;
const did = (n: string) => n as unknown as Id<"dutyTypes">;

const CMSC131_SECTIONS: EnrollableSection[] = [
  {
    _id: sid("sec-131-0101"),
    sectionNumber: "0101",
    type: "discussion",
    meetings: [
      { day: "M", startMin: 600, endMin: 650, room: "IRB 0324" },
      { day: "W", startMin: 600, endMin: 650, room: "IRB 0324" },
      { day: "F", startMin: 540, endMin: 590, room: "IRB 1207" },
    ],
    instructors: ["Nelson Padua-Perez"],
  },
  {
    _id: sid("sec-131-0201"),
    sectionNumber: "0201",
    type: "discussion",
    meetings: [
      { day: "Tu", startMin: 780, endMin: 830, room: "CSI 2117" },
      { day: "Th", startMin: 780, endMin: 830, room: "CSI 2117" },
    ],
    instructors: ["Fawzi Emad"],
  },
];

export const searchResults = [
  { courseId: "CMSC131", name: "Object-Oriented Programming I" },
  { courseId: "CMSC132", name: "Object-Oriented Programming II" },
  { courseId: "CMSC133", name: "Object Oriented Programming Laboratory" },
];

export async function previewSearch(query: string) {
  const q = query.trim().toUpperCase();
  if (q.length < 2) return [];
  return searchResults.filter((c) => c.courseId.startsWith(q));
}

export async function previewImport(courseId: string) {
  return {
    courseName:
      searchResults.find((c) => c.courseId === courseId)?.name ?? "Course",
    sections: CMSC131_SECTIONS,
  };
}

export async function previewImportFailure(): Promise<never> {
  throw new Error("Jupiterp unavailable");
}

export const classesValue: ClassesValue = {
  courses: [
    {
      courseId: "CMSC131",
      courseName: "Object-Oriented Programming I",
      sections: CMSC131_SECTIONS,
      selectedSectionIds: [sid("sec-131-0101")],
    },
  ],
  manual: [
    { key: "m1", label: "MATH241 lecture", day: "Tu", startMin: 660, endMin: 710 },
  ],
};

export const emptyClassesValue: ClassesValue = {
  courses: [],
  manual: [],
};

export const dutyTypes = [
  { _id: did("dt-disc"), name: "Discussion", mode: "sync" as const, color: "#e21833" },
  { _id: did("dt-oh"), name: "Office Hours", mode: "sync" as const, color: "#2f6fed" },
  { _id: did("dt-exam"), name: "Exam Proctoring", mode: "sync" as const, color: "#7c3aed" },
  { _id: did("dt-grade"), name: "Grading", mode: "async" as const, color: "#0d9488" },
];

export const staffedSections = [
  {
    _id: sid("sec-132-0101"),
    sectionNumber: "0101",
    meetings: [{ day: "M" as const, startMin: 540, endMin: 590 }],
    instructors: ["Anwar Mamat"],
  },
  {
    _id: sid("sec-132-0102"),
    sectionNumber: "0102",
    meetings: [{ day: "W" as const, startMin: 600, endMin: 650 }],
    instructors: ["Anwar Mamat"],
  },
  {
    _id: sid("sec-132-0201"),
    sectionNumber: "0201",
    meetings: [{ day: "Th" as const, startMin: 780, endMin: 830 }],
    instructors: ["Cliff Bakalian"],
  },
  // Clashes with the CMSC131 Friday discussion *and* is ranked below, so the
  // preview exercises both new states: a blocked picker row and a ranked row
  // that has since gone red.
  {
    _id: sid("sec-132-0301"),
    sectionNumber: "0301",
    meetings: [{ day: "F" as const, startMin: 540, endMin: 590 }],
    instructors: ["Fawzi Emad"],
  },
];

export const preferencesValue: PreferencesValue = {
  maxHoursPerWeek: 10,
  dutyTypePrefs: [did("dt-disc"), did("dt-oh")],
  sectionPrefs: [sid("sec-132-0101"), sid("sec-132-0301")],
};

/**
 * Seeds the "About you" block on the step-1 preview. The name is deliberately
 * blank so the preview shows the first-name placeholder doing its job.
 */
export const contactDetails = { preferredName: "", phone: "301-555-0147" };

export const firstName = "Priya";
