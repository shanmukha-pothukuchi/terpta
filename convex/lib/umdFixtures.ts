/**
 * umd.io response-shaped fixture data + pure normalization helpers.
 *
 * Shapes verified against https://beta.umd.io (v0/v1 docs, 2026-09-02):
 *   course:  { course_id, semester, name, dept_id, department, credits, description, sections: string[] }
 *   section: { course, section_id, semester, number, seats, open_seats, waitlist,
 *              instructors: string[], meetings: [{ days, room, building, classtype, start_time, end_time }] }
 *   days is a concatenated string like "MWF" or "TuTh"; start_time/end_time like "10:00am";
 *   classtype is "" for lecture meetings, "Discussion" / "Lab" otherwise.
 *
 * Fixtures are used as a fallback when api.umd.io is down (it 502s often) and as
 * the deterministic data source for convex/seed.ts.
 */

export type UmdDay = "M" | "Tu" | "W" | "Th" | "F";

export type UmdioMeeting = {
  days: string; // e.g. "MWF", "TuTh"; "" for online-async
  room: string;
  building: string;
  classtype: string; // "" = lecture, "Discussion", "Lab"
  start_time: string; // e.g. "10:00am"
  end_time: string; // e.g. "10:50am"
};

export type UmdioSection = {
  course: string;
  section_id: string; // e.g. "CMSC132-0101"
  semester: string;
  number: string; // e.g. "0101"
  seats: string;
  meetings: UmdioMeeting[];
  open_seats: string;
  waitlist: string;
  instructors: string[];
};

export type UmdioCourse = {
  course_id: string;
  semester: string;
  name: string;
  dept_id: string;
  department: string;
  credits: string;
  description: string;
  sections: string[]; // section_ids
};

export type NormalizedMeeting = {
  day: UmdDay;
  startMin: number;
  endMin: number;
  room: string;
};

export type SectionType = "lecture" | "discussion" | "lab";

/** "10:00am" -> 600, "1:50pm" -> 830, "12:00pm" -> 720. Returns null if unparseable. */
export function parseUmdTime(time: string): number | null {
  const m = /^(\d{1,2}):(\d{2})\s*(am|pm)$/i.exec(time.trim());
  if (!m) return null;
  let hours = parseInt(m[1], 10);
  const minutes = parseInt(m[2], 10);
  if (hours < 1 || hours > 12 || minutes > 59) return null;
  if (hours === 12) hours = 0;
  if (m[3].toLowerCase() === "pm") hours += 12;
  return hours * 60 + minutes;
}

/**
 * "MWF" -> ["M","W","F"], "TuTh" -> ["Tu","Th"].
 * Tu/Th are two-char tokens and must be matched before single chars.
 * Weekend tokens (Sa/Su) are dropped — not representable in our week model.
 */
export function splitDays(days: string): UmdDay[] {
  const out: UmdDay[] = [];
  const s = days.trim();
  let i = 0;
  while (i < s.length) {
    if (s.startsWith("Tu", i)) {
      out.push("Tu");
      i += 2;
    } else if (s.startsWith("Th", i)) {
      out.push("Th");
      i += 2;
    } else if (s.startsWith("Sa", i) || s.startsWith("Su", i)) {
      i += 2; // weekend meeting — skip
    } else if (s[i] === "M" || s[i] === "W" || s[i] === "F") {
      out.push(s[i] as UmdDay);
      i += 1;
    } else {
      i += 1; // separator or unknown char — skip
    }
  }
  return out;
}

/**
 * Flattens umd.io meetings into one normalized meeting per (meeting, day) pair.
 * "MWF 10:00am-10:50am IRB 0324" -> 3 entries. Meetings with unparseable
 * times or no days (e.g. online async) are skipped.
 */
export function normalizeUmdioMeetings(
  meetings: UmdioMeeting[],
): NormalizedMeeting[] {
  const out: NormalizedMeeting[] = [];
  for (const m of meetings) {
    const startMin = parseUmdTime(m.start_time);
    const endMin = parseUmdTime(m.end_time);
    if (startMin === null || endMin === null || endMin <= startMin) continue;
    const room = `${m.building ?? ""} ${m.room ?? ""}`.trim();
    for (const day of splitDays(m.days)) {
      out.push({ day, startMin, endMin, room });
    }
  }
  return out;
}

/** Discussion if any meeting is a Discussion, else lab, else lecture. */
export function classifyUmdioSection(section: UmdioSection): SectionType {
  const types = section.meetings.map((m) => m.classtype.toLowerCase());
  if (types.some((t) => t.includes("discussion"))) return "discussion";
  if (types.some((t) => t.includes("lab"))) return "lab";
  return "lecture";
}

// ---------------------------------------------------------------------------
// CMSC132 Fall 2026 fixture
// ---------------------------------------------------------------------------

const TERM = "202608";
const COURSE_ID = "CMSC132";

export const CMSC132_FALL2026_COURSE: UmdioCourse = {
  course_id: COURSE_ID,
  semester: TERM,
  name: "Object-Oriented Programming II",
  dept_id: "CMSC",
  department: "Computer Science",
  credits: "4",
  description:
    "Introduction to use of computers to solve problems using software engineering principles. Design, build, test, and debug medium-size software systems and learn to use relevant tools. Use object-oriented methods to create effective and efficient problem solutions.",
  sections: [
    "CMSC132-0101",
    "CMSC132-0102",
    "CMSC132-0103",
    "CMSC132-0104",
    "CMSC132-0105",
    "CMSC132-0106",
    "CMSC132-0107",
    "CMSC132-0108",
  ],
};

// Two lecture blocks (classtype "" = lecture, exactly as umd.io emits):
//   Lecture A (sections 0101-0104): MWF 9:00am-9:50am, IRB 0324
//   Lecture B (sections 0105-0108): MWF 1:00pm-1:50pm, IRB 0324
const LECTURE_A: UmdioMeeting = {
  days: "MWF",
  room: "0324",
  building: "IRB",
  classtype: "",
  start_time: "9:00am",
  end_time: "9:50am",
};

const LECTURE_B: UmdioMeeting = {
  days: "MWF",
  room: "0324",
  building: "IRB",
  classtype: "",
  start_time: "1:00pm",
  end_time: "1:50pm",
};

function discussion(
  days: string,
  start: string,
  end: string,
  building: string,
  room: string,
): UmdioMeeting {
  return {
    days,
    room,
    building,
    classtype: "Discussion",
    start_time: start,
    end_time: end,
  };
}

function section(
  number: string,
  lecture: UmdioMeeting,
  disc: UmdioMeeting,
  instructor: string,
): UmdioSection {
  return {
    course: COURSE_ID,
    section_id: `${COURSE_ID}-${number}`,
    semester: TERM,
    number,
    seats: "33",
    meetings: [lecture, disc],
    open_seats: "0",
    waitlist: "05",
    instructors: [instructor],
  };
}

/**
 * 8 discussion sections, each with a shared lecture meeting plus one 50-minute
 * discussion spread across M/W/F mornings-afternoons in IRB/CSI rooms.
 */
export const CMSC132_FALL2026_SECTIONS: UmdioSection[] = [
  section("0101", LECTURE_A, discussion("M", "10:00am", "10:50am", "IRB", "1207"), "Nelson Padua-Perez"),
  section("0102", LECTURE_A, discussion("M", "11:00am", "11:50am", "IRB", "1207"), "Nelson Padua-Perez"),
  section("0103", LECTURE_A, discussion("W", "10:00am", "10:50am", "CSI", "2118"), "Nelson Padua-Perez"),
  section("0104", LECTURE_A, discussion("W", "11:00am", "11:50am", "CSI", "2118"), "Nelson Padua-Perez"),
  section("0105", LECTURE_B, discussion("W", "2:00pm", "2:50pm", "IRB", "0318"), "Nelson Padua-Perez"),
  section("0106", LECTURE_B, discussion("F", "10:00am", "10:50am", "CSI", "1121"), "Nelson Padua-Perez"),
  section("0107", LECTURE_B, discussion("F", "12:00pm", "12:50pm", "CSI", "1121"), "Nelson Padua-Perez"),
  section("0108", LECTURE_B, discussion("F", "2:00pm", "2:50pm", "IRB", "0318"), "Nelson Padua-Perez"),
];

export type UmdFixture = {
  course: UmdioCourse;
  sections: UmdioSection[];
};

const FIXTURES: Record<string, UmdFixture> = {
  [`${COURSE_ID}:${TERM}`]: {
    course: CMSC132_FALL2026_COURSE,
    sections: CMSC132_FALL2026_SECTIONS,
  },
};

/** Fixture lookup used as fallback when api.umd.io is unavailable. */
export function getFixture(courseId: string, term: string): UmdFixture | null {
  return FIXTURES[`${courseId.toUpperCase()}:${term}`] ?? null;
}
