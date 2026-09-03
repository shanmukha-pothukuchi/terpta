import { describe, expect, it } from "vitest";
import {
  departmentOf,
  inferMeetingKinds,
  parseJupiterpMeeting,
  type JupiterpSection,
} from "./jupiterp";
import { normalizeUmdioMeetings } from "./umdFixtures";

describe("parseJupiterpMeeting", () => {
  it("splits an in-person meeting into its parts", () => {
    expect(parseJupiterpMeeting("TuTh-9:30am-10:45am-IRB-0324")).toEqual({
      days: "TuTh",
      start_time: "9:30am",
      end_time: "10:45am",
      building: "IRB",
      room: "0324",
    });
  });

  it("keeps a hyphenated room intact", () => {
    expect(parseJupiterpMeeting("MWF-1:00pm-1:50pm-ESJ-B0320-A")?.room).toBe("B0320-A");
  });

  it("returns null for meetings with no time and place", () => {
    expect(parseJupiterpMeeting("OnlineAsync")).toBeNull();
    expect(parseJupiterpMeeting("Unspecified")).toBeNull();
    // Online-synchronous has a time but nowhere to be; nothing to staff.
    expect(parseJupiterpMeeting("MW-2:00pm-2:50pm-OnlineSync")).toBeNull();
  });
});

const section = (sec_code: string, meetings: string[]): JupiterpSection => ({
  course_code: "CMSC330",
  sec_code,
  instructors: ["Anwar Mamat"],
  meetings,
  open_seats: 0,
  total_seats: 35,
  waitlist: 0,
});

describe("inferMeetingKinds", () => {
  // The real CMSC330 shape: five sections in one TuTh lecture, each with
  // its own Friday discussion.
  const cmsc330 = [
    section("0101", ["TuTh-9:30am-10:45am-IRB-0324", "F-9:00am-9:50am-IRB-1207"]),
    section("0102", ["TuTh-9:30am-10:45am-IRB-0324", "F-10:00am-10:50am-IRB-2107"]),
    section("0103", ["TuTh-9:30am-10:45am-IRB-0324", "F-11:00am-11:50am-CSI-1121"]),
  ];

  it("marks the meeting every section shares as the lecture", () => {
    const out = inferMeetingKinds(cmsc330);
    for (const s of out) {
      expect(s.meetings[0].classtype).toBe("");
      expect(s.meetings[1].classtype).toBe("Discussion");
    }
  });

  it("feeds the existing normalizer so only discussions get staffed", () => {
    const [first] = inferMeetingKinds(cmsc330);
    const kinds = normalizeUmdioMeetings(first.meetings).map((m) => `${m.day}:${m.kind}`);
    expect(kinds).toEqual(["Tu:lecture", "Th:lecture", "F:discussion"]);
  });

  it("treats a section whose meetings are all its own as a plain lecture", () => {
    // One seminar section: nothing here is a discussion to staff.
    const [only] = inferMeetingKinds([section("0101", ["W-4:00pm-6:45pm-TWS-1101"])]);
    expect(only.meetings[0].classtype).toBe("");
  });

  it("does not let an unrelated section alias a lecture", () => {
    // Two sections that happen to share nothing: each is its own lecture.
    const out = inferMeetingKinds([
      section("0101", ["MW-2:00pm-3:15pm-CSI-1115"]),
      section("0201", ["TuTh-2:00pm-3:15pm-CSI-1115"]),
    ]);
    expect(out.map((s) => s.meetings[0].classtype)).toEqual(["", ""]);
  });

  it("carries the section identity umd.io used to supply", () => {
    const [s] = inferMeetingKinds(cmsc330);
    expect(s.number).toBe("0101");
    expect(s.section_id).toBe("CMSC330-0101");
    expect(s.instructors).toEqual(["Anwar Mamat"]);
  });

  it("drops meetings that have nowhere to be", () => {
    const [s] = inferMeetingKinds([
      section("0101", ["OnlineAsync", "F-9:00am-9:50am-IRB-1207"]),
    ]);
    expect(s.meetings).toHaveLength(1);
  });
});

describe("departmentOf", () => {
  it("takes the leading letters as the department", () => {
    expect(departmentOf("cmsc1")).toBe("CMSC");
    expect(departmentOf("MATH141")).toBe("MATH");
  });

  it("needs at least two letters to guess", () => {
    expect(departmentOf("c")).toBeNull();
    expect(departmentOf("330")).toBeNull();
  });
});
