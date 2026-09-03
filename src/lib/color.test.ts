import { describe, expect, it } from "vitest";
import { lighten, parseHex, withAlpha } from "./color";

describe("duty colors", () => {
  it("parses both hex lengths, with or without the hash", () => {
    expect(parseHex("#E21833")).toEqual([226, 24, 51]);
    expect(parseHex("e21833")).toEqual([226, 24, 51]);
    expect(parseHex("#0f8")).toEqual([0, 255, 136]);
  });

  it("falls back to the neutral rather than painting nothing", () => {
    // A duty type saved before colors existed, or a hand-edited row.
    expect(parseHex("rebeccapurple")).toBeNull();
    expect(withAlpha(undefined, 0.1)).toBe("rgba(125,147,178,0.1)");
    expect(withAlpha("not a color", 0.1)).toBe("rgba(125,147,178,0.1)");
  });

  it("keeps the alpha it is given", () => {
    expect(withAlpha("#E21833", 0.12)).toBe("rgba(226,24,51,0.12)");
  });

  it("lifts a color toward white for small text", () => {
    expect(lighten("#E21833", 0)).toBe("rgb(226,24,51)");
    expect(lighten("#E21833", 1)).toBe("rgb(255,255,255)");
    expect(lighten("#000000", 0.5)).toBe("rgb(128,128,128)");
  });
});
