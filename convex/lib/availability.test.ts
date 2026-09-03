import { describe, expect, it } from "vitest";
import { fitWindow, hasPaintedAvailability, preferNotMinutes, type BlockLike } from "./availability";

const b = (day: BlockLike["day"], s: number, e: number, status: BlockLike["status"]): BlockLike => ({
  day,
  startMin: s,
  endMin: e,
  status,
});

describe("fitWindow", () => {
  it("assumes a TA who painted nothing is available", () => {
    expect(fitWindow([], "M", 600, 660)).toBe("available");
  });

  it("still honours imported class times for a TA who painted nothing", () => {
    // A class block is a fact about their week, not a submission.
    const blocks = [b("M", 600, 650, "unavailable")];
    expect(fitWindow(blocks, "M", 600, 660)).toBe("unavailable");
    expect(fitWindow(blocks, "M", 660, 720)).toBe("available");
    expect(fitWindow(blocks, "Tu", 600, 660)).toBe("available");
  });

  it("requires full coverage once the TA has painted", () => {
    const blocks = [b("M", 600, 720, "available")];
    expect(fitWindow(blocks, "M", 600, 720)).toBe("available");
    expect(fitWindow(blocks, "M", 660, 750)).toBe("unavailable"); // runs past
    expect(fitWindow(blocks, "Tu", 600, 660)).toBe("unavailable"); // other day, unpainted
  });

  it("joins adjacent painted blocks into one covered span", () => {
    const blocks = [b("W", 540, 600, "available"), b("W", 600, 660, "prefer_not")];
    expect(fitWindow(blocks, "W", 540, 660)).toBe("prefer_not");
    expect(fitWindow(blocks, "W", 540, 600)).toBe("available");
  });

  it("treats any unavailable overlap as disqualifying", () => {
    const blocks = [b("F", 480, 1020, "available"), b("F", 600, 650, "unavailable")];
    expect(fitWindow(blocks, "F", 590, 620)).toBe("unavailable");
    expect(fitWindow(blocks, "F", 660, 720)).toBe("available");
  });
});

describe("hasPaintedAvailability", () => {
  it("ignores unavailable-only blocks", () => {
    expect(hasPaintedAvailability([b("M", 600, 650, "unavailable")])).toBe(false);
    expect(hasPaintedAvailability([b("M", 600, 650, "prefer_not")])).toBe(true);
  });
});

describe("preferNotMinutes", () => {
  it("sums only the overlapping prefer_not minutes", () => {
    const blocks = [b("M", 600, 660, "prefer_not"), b("M", 660, 720, "available")];
    expect(preferNotMinutes(blocks, "M", 630, 690)).toBe(30);
    expect(preferNotMinutes(blocks, "Tu", 630, 690)).toBe(0);
  });
});
