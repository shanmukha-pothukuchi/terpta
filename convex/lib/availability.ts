/**
 * One answer to "can this TA be here at this time", shared by the solver,
 * the shift screen's availability counts, the Builder's conflict check and
 * the one-off cover picker. Four copies of this rule had already drifted.
 *
 * Painted time is the TA's word: "available", "prefer_not", "unavailable".
 * Unpainted time means one of two things, and the difference matters:
 *
 * - The TA has painted something. Then unpainted time is time they did not
 *   offer, and a window that is not fully covered is out.
 * - The TA has painted nothing at all (never submitted). Then the app has no
 *   information, and it assumes they are free rather than leaving them out
 *   of every shift — a TA who ignored the form still has to be scheduled,
 *   and the coordinator would rather move one person than staff around a
 *   phantom. Their imported class times still count as unavailable; those
 *   are facts, not a submission.
 */
export type Day = "M" | "Tu" | "W" | "Th" | "F";
export type BlockStatus = "available" | "prefer_not" | "unavailable";

export interface BlockLike {
  day: Day;
  startMin: number;
  endMin: number;
  status: BlockStatus;
}

export type WindowFit = "available" | "prefer_not" | "unavailable";

function overlaps(aS: number, aE: number, bS: number, bE: number): boolean {
  return aS < bE && bS < aE;
}

/** True once the TA has painted any time as available or prefer_not. */
export function hasPaintedAvailability(blocks: readonly BlockLike[]): boolean {
  return blocks.some((b) => b.status !== "unavailable");
}

/**
 * How a TA fits a [startMin, endMin) window on a weekday.
 *
 * "unavailable" if any unavailable block touches it, or — for a TA who has
 * painted — if the window is not fully covered by what they painted.
 * "prefer_not" if it fits but crosses a prefer_not block. Otherwise
 * "available", which is also the answer for a TA who has painted nothing.
 */
export function fitWindow(
  blocks: readonly BlockLike[],
  day: Day,
  startMin: number,
  endMin: number,
): WindowFit {
  const onDay = blocks.filter((b) => b.day === day);
  if (onDay.some((b) => b.status === "unavailable" && overlaps(b.startMin, b.endMin, startMin, endMin))) {
    return "unavailable";
  }
  if (!hasPaintedAvailability(blocks)) return "available";

  const painted = onDay
    .filter((b) => b.status !== "unavailable")
    .sort((a, b) => a.startMin - b.startMin);
  let cur = startMin;
  for (const b of painted) {
    if (b.startMin > cur) break; // gap before cur: window not covered
    if (b.endMin > cur) cur = b.endMin;
    if (cur >= endMin) break;
  }
  if (cur < endMin) return "unavailable";

  return painted.some(
    (b) => b.status === "prefer_not" && overlaps(b.startMin, b.endMin, startMin, endMin),
  )
    ? "prefer_not"
    : "available";
}

/** Minutes of the window that cross prefer_not blocks; the solver's soft cost. */
export function preferNotMinutes(
  blocks: readonly BlockLike[],
  day: Day,
  startMin: number,
  endMin: number,
): number {
  let total = 0;
  for (const b of blocks) {
    if (b.day !== day || b.status !== "prefer_not") continue;
    const s = Math.max(b.startMin, startMin);
    const e = Math.min(b.endMin, endMin);
    if (e > s) total += e - s;
  }
  return total;
}
