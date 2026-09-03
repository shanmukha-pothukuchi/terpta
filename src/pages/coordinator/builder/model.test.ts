import { describe, expect, it } from "vitest";
import { shortNameMap } from "./model";

const shortsOf = (names: string[]) => names.map((n) => shortNameMap(names).get(n));

describe("shortNameMap", () => {
  it("leaves unambiguous names as first names", () => {
    expect(shortsOf(["Priya Shah", "Daniel Chen"])).toEqual(["Priya", "Daniel"]);
  });

  it("adds a last initial only to the names that collide", () => {
    expect(
      shortsOf(["Sreeram Pothukuchi", "Sreeram Vaidyanathan", "Daniel Chen"]),
    ).toEqual(["Sreeram P.", "Sreeram V.", "Daniel"]);
  });

  it("falls back to the whole name when an initial is not enough", () => {
    expect(shortsOf(["Sreeram Patel", "Sreeram Pothukuchi"])).toEqual([
      "Sreeram Patel",
      "Sreeram Pothukuchi",
    ]);
  });

  it("uses the last word, not the second, for a middle name", () => {
    expect(shortsOf(["Ana Maria Ruiz", "Ana Silva"])).toEqual(["Ana R.", "Ana S."]);
  });

  it("handles a TA with no surname to take an initial from", () => {
    // Two people answering to one word cannot be told apart by name at all;
    // saying so plainly beats printing "Sreeram" twice as if it were fine.
    expect(shortsOf(["Sreeram", "Sreeram Pothukuchi"])).toEqual([
      "Sreeram",
      "Sreeram P.",
    ]);
    expect(shortsOf(["Sreeram", "Sreeram"])).toEqual(["Sreeram", "Sreeram"]);
  });

  it("treats case and spacing as noise", () => {
    expect(shortsOf(["priya shah", "Priya Kumar"])).toEqual(["priya S.", "Priya K."]);
    expect(shortNameMap(["  Daniel   Chen  "]).get("  Daniel   Chen  ")).toBe("Daniel");
  });
});
