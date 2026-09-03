import { afterEach, describe, expect, it, vi } from "vitest";
import { umdioSource } from "./umdio";
import { parseUmdTime, splitDays } from "./umdFixtures";

function stubFetch(handler: (url: string) => { ok?: boolean; status?: number; body: unknown }) {
  vi.stubGlobal("fetch", async (url: string) => {
    const { ok = true, status = 200, body } = handler(String(url));
    return { ok, status, json: async () => body } as unknown as Response;
  });
}

const COURSE = { course_id: "CMSC330", name: "Organization of Programming Languages" };
const SECTION = { course: "CMSC330", number: "0101", meetings: [] };

afterEach(() => vi.unstubAllGlobals());

describe("umdioSource.fetchCourse", () => {
  it("accepts the single-object shape /courses/{id} returns", async () => {
    stubFetch(() => ({ body: COURSE }));
    expect((await umdioSource.fetchCourse("CMSC330", "202608")).course_id).toBe("CMSC330");
  });

  it("accepts the array shape the query-param endpoint returns", async () => {
    stubFetch(() => ({ body: [COURSE] }));
    expect((await umdioSource.fetchCourse("CMSC330", "202608")).course_id).toBe("CMSC330");
  });

  it("throws when the course is missing", async () => {
    stubFetch(() => ({ body: [] }));
    await expect(umdioSource.fetchCourse("CMSC999", "202608")).rejects.toThrow(
      "Course CMSC999 not found for term 202608",
    );
  });

  it("throws on an error response so the caller can fall back", async () => {
    stubFetch(() => ({ ok: false, status: 502, body: null }));
    await expect(umdioSource.fetchCourse("CMSC330", "202608")).rejects.toThrow("502");
  });
});

describe("umdioSource.fetchSections", () => {
  it("reads sections from the per-course path, not the flat one", async () => {
    let seen = "";
    stubFetch((url) => { seen = url; return { body: [SECTION] }; });
    const sections = await umdioSource.fetchSections("CMSC330", "202608");
    expect(sections).toHaveLength(1);
    expect(seen).toContain("/courses/CMSC330/sections?semester=202608");
    expect(seen).not.toContain("/courses/sections");
  });

  it("throws when the payload is not a list", async () => {
    stubFetch(() => ({ body: { error: "nope" } }));
    await expect(umdioSource.fetchSections("CMSC330", "202608")).rejects.toThrow(
      "unexpected sections payload",
    );
  });
});

/* umd.io meeting strings, parsed by the shared fixture helpers. */
describe("umd.io time and day parsing", () => {
  it("reads 12-hour times as minutes from midnight", () => {
    expect(parseUmdTime("9:30am")).toBe(570);
    expect(parseUmdTime("10:45am")).toBe(645);
    expect(parseUmdTime("2:00pm")).toBe(840);
    expect(parseUmdTime("3:15pm")).toBe(915);
    expect(parseUmdTime("12:00pm")).toBe(720);
    expect(parseUmdTime("12:30am")).toBe(30);
  });

  it("splits the packed day strings umd.io returns", () => {
    expect(splitDays("TuTh")).toEqual(["Tu", "Th"]);
    expect(splitDays("MWF")).toEqual(["M", "W", "F"]);
    expect(splitDays("F")).toEqual(["F"]);
    expect(splitDays("MTuWThF")).toEqual(["M", "Tu", "W", "Th", "F"]);
  });
});
