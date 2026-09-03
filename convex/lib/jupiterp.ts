/**
 * Jupiterp adapter (https://api.jupiterp.com/v0).
 *
 * Replaces umd.io, which 502'd often enough that the app grew a fixture
 * fallback. Jupiterp is steadier but says less: a section's meetings come
 * back as bare strings — "TuTh-9:30am-10:45am-IRB-0324" — with no mark for
 * which of them is the lecture and which the discussion. That distinction is
 * the whole point of importing a course here, since only discussions and
 * labs get staffed, so it is inferred below from the one thing the data does
 * make plain: every section of a course sits in the same lecture, and each
 * has its own discussion.
 *
 * Pure module (no Convex imports) so the parsing and the inference can be
 * unit-tested without a network. Output is shaped like umd.io's records so
 * the normalizer downstream did not have to change.
 *
 * Jupiterp serves the current semester only. It accepts a `term` parameter
 * and ignores it; the adapter keeps the argument for interface parity and
 * so a future version that honours it needs no call-site changes.
 */
import type { UmdioCourse, UmdioMeeting, UmdioSection } from "./umdFixtures";

export const JUPITERP_BASE = "https://api.jupiterp.com/v0";

export interface JupiterpCourse {
  course_code: string;
  name: string;
  min_credits: number | null;
  max_credits: number | null;
  description: string | null;
}

export interface JupiterpSection {
  course_code: string;
  sec_code: string;
  instructors: string[];
  /** "Days-Start-End-Building-Room", "Days-Start-End-OnlineSync", "OnlineAsync", "Unspecified". */
  meetings: string[];
  open_seats: number;
  total_seats: number;
  waitlist: number;
}

export interface UmdScheduleSource {
  /** Throws on network/HTTP failure or if the course does not exist. */
  fetchCourse(courseId: string, term: string): Promise<UmdioCourse>;
  fetchSections(courseId: string, term: string): Promise<UmdioSection[]>;
  /** Every course in a department, for onboarding's course autocomplete. */
  fetchDepartmentCourses(
    deptId: string,
    term: string,
  ): Promise<Array<{ courseId: string; name: string }>>;
}

/** "cmsc1" -> "CMSC". Autocomplete needs the letters before the digits. */
export function departmentOf(query: string): string | null {
  const letters = query.trim().toUpperCase().match(/^[A-Z]+/);
  return letters && letters[0].length >= 2 ? letters[0].slice(0, 4) : null;
}

/**
 * One meeting string into its parts, or null for anything without a time and
 * place ("OnlineAsync", "Unspecified", online-synchronous). Building codes
 * never contain a hyphen, but a room can, so the tail is rejoined.
 */
export function parseJupiterpMeeting(
  meeting: string,
): Pick<UmdioMeeting, "days" | "start_time" | "end_time" | "building" | "room"> | null {
  const parts = meeting.split("-");
  if (parts.length < 5) return null;
  const [days, start_time, end_time, building, ...rest] = parts;
  if (!/^[MTuWThF]+$/.test(days)) return null;
  if (!/^\d{1,2}:\d{2}[ap]m$/i.test(start_time) || !/^\d{1,2}:\d{2}[ap]m$/i.test(end_time)) {
    return null;
  }
  return { days, start_time, end_time, building, room: rest.join("-") };
}

/**
 * Which meetings are the lecture and which the discussion, across all the
 * sections of one course.
 *
 * A meeting held in common by two or more sections is the lecture — CMSC330
 * sections 0101 through 0105 all sit in the same TuTh 9:30. A meeting that is
 * a section's own, beside a shared one, is its discussion. A section whose
 * meetings are all its own is a standalone lecture section and has nothing
 * to staff; that is what a seminar or a single-section course looks like.
 *
 * Labs cannot be told from discussions this way, so both come out as
 * "Discussion". The staffing question treats them the same.
 */
export function inferMeetingKinds(sections: JupiterpSection[]): UmdioSection[] {
  const parsed = sections.map((s) => ({
    section: s,
    meetings: s.meetings
      .map((m) => ({ raw: m, parts: parseJupiterpMeeting(m) }))
      .filter((m): m is { raw: string; parts: NonNullable<typeof m.parts> } => m.parts !== null),
  }));

  const key = (p: NonNullable<ReturnType<typeof parseJupiterpMeeting>>) =>
    `${p.days}|${p.start_time}|${p.end_time}|${p.building}|${p.room}`;
  const sectionsPerMeeting = new Map<string, number>();
  for (const { meetings } of parsed) {
    for (const k of new Set(meetings.map((m) => key(m.parts)))) {
      sectionsPerMeeting.set(k, (sectionsPerMeeting.get(k) ?? 0) + 1);
    }
  }

  return parsed.map(({ section, meetings }) => {
    const shared = meetings.map((m) => (sectionsPerMeeting.get(key(m.parts)) ?? 0) >= 2);
    const hasSharedLecture = shared.some(Boolean);
    return {
      course: section.course_code,
      section_id: `${section.course_code}-${section.sec_code}`,
      semester: "",
      number: section.sec_code,
      seats: String(section.total_seats),
      open_seats: String(section.open_seats),
      waitlist: String(section.waitlist),
      instructors: section.instructors ?? [],
      meetings: meetings.map((m, i) => ({
        ...m.parts,
        classtype: shared[i] || !hasSharedLecture ? "" : "Discussion",
      })),
    };
  });
}

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`Jupiterp responded ${res.status} for ${url}`);
  return await res.json();
}

export const jupiterpSource: UmdScheduleSource = {
  async fetchCourse(courseId, term) {
    const code = courseId.trim().toUpperCase();
    const data = await getJson(
      `${JUPITERP_BASE}/courses?courseCodes=${encodeURIComponent(code)}&limit=1`,
    );
    const course = Array.isArray(data)
      ? (data as JupiterpCourse[]).find((c) => c.course_code === code)
      : undefined;
    if (!course) throw new Error(`Course ${code} not found`);
    return {
      course_id: course.course_code,
      semester: term,
      name: course.name,
      dept_id: course.course_code.slice(0, 4),
      department: "",
      credits: course.min_credits === null ? "" : String(course.min_credits),
      description: course.description ?? "",
      sections: [],
    };
  },

  async fetchSections(courseId, _term) {
    const code = courseId.trim().toUpperCase();
    const data = await getJson(
      `${JUPITERP_BASE}/sections?courseCodes=${encodeURIComponent(code)}&limit=500`,
    );
    if (!Array.isArray(data)) {
      throw new Error(`Jupiterp returned an unexpected sections payload for ${code}`);
    }
    // courseCodes is a prefix match on the server side, so CMSC330 can bring
    // CMSC330H along with it; keep exactly the course asked for.
    const own = (data as JupiterpSection[]).filter((s) => s.course_code === code);
    return inferMeetingKinds(own);
  },

  async fetchDepartmentCourses(deptId, _term) {
    const out: Array<{ courseId: string; name: string }> = [];
    for (let offset = 0; offset < 2000; offset += 500) {
      const data = await getJson(
        `${JUPITERP_BASE}/courses/minified?prefix=${encodeURIComponent(deptId)}` +
          `&limit=500&offset=${offset}&sortBy=course_code.asc`,
      );
      if (!Array.isArray(data) || data.length === 0) break;
      for (const c of data as Array<{ course_code: string; name: string }>) {
        if (c.course_code) out.push({ courseId: c.course_code, name: c.name });
      }
      if (data.length < 500) break;
    }
    return out;
  },
};
