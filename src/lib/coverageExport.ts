/**
 * The staffed week as a block of text, for pasting where students read.
 *
 * The board is a picture of who is on; a syllabus or a Piazza post wants the
 * opposite — when somebody is on, whoever it is. Blocks that run into each
 * other, and blocks two TAs hold at the same hour, become one line.
 */
import { DAY_CODES, type DayCode } from "./format";

export interface CoverageBlock {
  day: DayCode;
  startMin: number;
  endMin: number;
}

export interface CoverageGroup {
  /** Duty type name, e.g. "Office Hours". */
  name: string;
  blocks: CoverageBlock[];
}

/** "TH" — the shorthand people write on a syllabus. */
const DAY_LABEL: Record<DayCode, string> = {
  M: "M",
  Tu: "TU",
  W: "W",
  Th: "TH",
  F: "F",
};

/**
 * Union of overlapping and touching ranges, per day, earliest first.
 *
 * Touching counts: 2-3 and 3-4 is one stretch with somebody there the whole
 * time, and printing it as two lines invites the reader to think there is a
 * gap between them.
 */
export function mergeContinuous(blocks: CoverageBlock[]): CoverageBlock[] {
  const out: CoverageBlock[] = [];
  for (const day of DAY_CODES) {
    const sorted = blocks
      .filter((b) => b.day === day && b.endMin > b.startMin)
      .sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);
    let run: CoverageBlock | null = null;
    for (const b of sorted) {
      if (run && b.startMin <= run.endMin) {
        run.endMin = Math.max(run.endMin, b.endMin);
        continue;
      }
      run = { day, startMin: b.startMin, endMin: b.endMin };
      out.push(run);
    }
  }
  return out;
}

/** "2:00", "12:15" — the clock face, without the meridiem. */
function clock(minutes: number): string {
  const total = ((Math.round(minutes) % 1440) + 1440) % 1440;
  const h24 = Math.floor(total / 60);
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(total % 60).padStart(2, "0")}`;
}

const meridiem = (minutes: number) => (Math.floor(minutes / 60) % 24 < 12 ? "am" : "pm");

/**
 * "2:00-3:00pm", and "11:00am-1:00pm" when the range crosses noon.
 *
 * One meridiem where one will do: "2:00pm-3:00pm" is the kind of line people
 * quietly rewrite before pasting it anywhere.
 */
export function formatRange(startMin: number, endMin: number): string {
  const from = meridiem(startMin);
  const to = meridiem(endMin);
  return from === to
    ? `${clock(startMin)}-${clock(endMin)}${to}`
    : `${clock(startMin)}${from}-${clock(endMin)}${to}`;
}

/** One line per continuous stretch: "TH 2:00-3:00pm". */
export function formatCoverage(groups: CoverageGroup[]): string {
  const sections: string[] = [];
  for (const group of groups) {
    const merged = mergeContinuous(group.blocks);
    if (merged.length === 0) continue;
    sections.push(
      [
        `${group.name}:`,
        ...merged.map((b) => `${DAY_LABEL[b.day]} ${formatRange(b.startMin, b.endMin)}`),
      ].join("\n"),
    );
  }
  return sections.join("\n\n");
}
