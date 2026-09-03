/**
 * Live umd.io adapter. Pure module (no Convex imports) so the response-shape
 * handling can be unit-tested against a stubbed fetch.
 *
 * api.umd.io is flaky and its two course endpoints disagree on shape:
 *   GET /courses/{id}?semester=   -> a single object
 *   GET /courses?course_id=&semester= -> an array
 * Sections must come from the per-course path; the flat
 * /courses/sections?course_id= endpoint 502s.
 */
import type { UmdioCourse, UmdioSection } from "./umdFixtures";

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

export const UMDIO_BASE = "https://api.umd.io/v0";

async function umdioGet(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    throw new Error(`umd.io responded ${res.status} for ${url}`);
  }
  return await res.json();
}

/** Both endpoint shapes collapse to the first course, or null. */
function firstCourse(data: unknown): UmdioCourse | null {
  const candidate = Array.isArray(data) ? data[0] : data;
  if (!candidate || typeof candidate !== "object") return null;
  const course = candidate as UmdioCourse;
  return course.course_id ? course : null;
}

export const umdioSource: UmdScheduleSource = {
  async fetchCourse(courseId, term) {
    const course = firstCourse(
      await umdioGet(
        `${UMDIO_BASE}/courses/${encodeURIComponent(courseId)}?semester=${encodeURIComponent(term)}`,
      ),
    );
    if (!course) {
      throw new Error(`Course ${courseId} not found for term ${term}`);
    }
    return course;
  },

  async fetchSections(courseId, term) {
    const data = await umdioGet(
      `${UMDIO_BASE}/courses/${encodeURIComponent(courseId)}/sections?semester=${encodeURIComponent(term)}&per_page=100`,
    );
    if (!Array.isArray(data)) {
      throw new Error(`umd.io returned unexpected sections payload for ${courseId}`);
    }
    return data as UmdioSection[];
  },

  async fetchDepartmentCourses(deptId, term) {
    // 100 per page is umd.io's maximum; departments run to a few hundred.
    const out: Array<{ courseId: string; name: string }> = [];
    for (let page = 1; page <= 5; page++) {
      const data = await umdioGet(
        `${UMDIO_BASE}/courses?dept_id=${encodeURIComponent(deptId)}` +
          `&semester=${encodeURIComponent(term)}&per_page=100&page=${page}`,
      );
      if (!Array.isArray(data) || data.length === 0) break;
      for (const raw of data as UmdioCourse[]) {
        if (raw.course_id) out.push({ courseId: raw.course_id, name: raw.name });
      }
      if (data.length < 100) break;
    }
    return out;
  },
};
