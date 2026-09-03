import { describe, expect, it } from "vitest";
import { ConvexError } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import {
  assertNoClaimedHours,
  shiftLabel,
  totalCounts,
  type ShiftCascade,
} from "./cascade";

const empty: ShiftCascade = {
  assignments: [],
  coverages: [],
  pendingSwaps: [],
  draftLogs: [],
  claimedLogs: [],
};

const log = (status: Doc<"hourLogs">["status"]) =>
  ({ status }) as unknown as Doc<"hourLogs">;

describe("assertNoClaimedHours", () => {
  it("lets a shift with nothing logged through", () => {
    expect(() => assertNoClaimedHours("Discussion 0101", empty)).not.toThrow();
  });

  it("lets a shift with only draft hours through", () => {
    // Drafts are claimed by nobody, so they cascade with the rest.
    expect(() =>
      assertNoClaimedHours("Discussion 0101", { ...empty, draftLogs: [log("draft")] }),
    ).not.toThrow();
  });

  it.each(["submitted", "approved", "flagged"] as const)(
    "refuses when hours are %s",
    (status) => {
      expect(() =>
        assertNoClaimedHours("Discussion 0101", { ...empty, claimedLogs: [log(status)] }),
      ).toThrow(ConvexError);
    },
  );

  it("names the shift and counts the entries", () => {
    try {
      assertNoClaimedHours("Midterm 1 proctoring", {
        ...empty,
        claimedLogs: [log("approved"), log("submitted")],
      });
      throw new Error("should have thrown");
    } catch (e) {
      const message = e instanceof ConvexError ? String(e.data) : String(e);
      expect(message).toContain("Midterm 1 proctoring");
      expect(message).toContain("2 logged hour entries");
    }
  });

  it("says entry, not entries, for one", () => {
    try {
      assertNoClaimedHours("Discussion 0101", { ...empty, claimedLogs: [log("approved")] });
      throw new Error("should have thrown");
    } catch (e) {
      expect(String((e as ConvexError<string>).data)).toContain("1 logged hour entry");
    }
  });
});

describe("totalCounts", () => {
  it("sums every cascade of a duty type's shifts", () => {
    expect(
      totalCounts([
        { assignments: 2, coverages: 1, pendingSwaps: 0, draftLogs: 3 },
        { assignments: 1, coverages: 0, pendingSwaps: 4, draftLogs: 0 },
      ]),
    ).toEqual({ assignments: 3, coverages: 1, pendingSwaps: 4, draftLogs: 3 });
  });

  it("is zero for a duty type with no shifts", () => {
    expect(totalCounts([])).toEqual({
      assignments: 0,
      coverages: 0,
      pendingSwaps: 0,
      draftLogs: 0,
    });
  });
});

describe("shiftLabel", () => {
  const shift = (fields: Partial<Doc<"shifts">>) =>
    fields as unknown as Doc<"shifts">;

  it("prefers the shift's own description", () => {
    expect(shiftLabel(shift({ description: "Discussion 0101" }))).toBe("Discussion 0101");
  });

  it("falls back to the date for an undescribed one-off", () => {
    expect(shiftLabel(shift({ recurrence: "once", date: "2026-10-14" }))).toBe(
      "The event on 2026-10-14",
    );
  });

  it("has a last resort", () => {
    expect(shiftLabel(shift({ recurrence: "weekly" }))).toBe("That shift");
  });
});
