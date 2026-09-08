import { describe, expect, it } from "vitest";
import { displayName } from "./names";

describe("displayName", () => {
  it("swaps the first name and keeps the surname", () => {
    expect(displayName("Priyadarshan Kabra", "Priyam")).toBe("Priyam Kabra");
  });

  it("leaves a TA who asked for nothing alone", () => {
    expect(displayName("Anirudh Chandra", undefined)).toBe("Anirudh Chandra");
    expect(displayName("Anirudh Sharma", "  ")).toBe("Anirudh Sharma");
  });

  it("keeps enough of two Anirudhs to tell them apart", () => {
    // Both answer to "Anirudh", so the surname is the whole disambiguator.
    expect(displayName("Anirudh Chandra", "Anirudh")).toBe("Anirudh Chandra");
    expect(displayName("Anirudh Sharma", "Anirudh")).toBe("Anirudh Sharma");
  });

  it("does not say the surname twice", () => {
    expect(displayName("Priyadarshan Kabra", "Priyam Kabra")).toBe("Priyam Kabra");
  });

  it("keeps a middle name, which is somebody's surname somewhere", () => {
    expect(displayName("Maria de la Cruz", "Mia")).toBe("Mia de la Cruz");
  });

  it("has something to say when one half is missing", () => {
    expect(displayName("Pierce", "Percy")).toBe("Percy");
    expect(displayName(undefined, "Percy")).toBe("Percy");
    expect(displayName("Pierce", undefined)).toBe("Pierce");
    expect(displayName(undefined, undefined)).toBe("");
  });
});
