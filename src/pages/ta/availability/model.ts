import { DAY_CODES, type DayCode } from "../../../lib/format";

/** One cell's state. Unpainted time is unavailable. */
export type SlotState = "available" | "prefer_not" | "unavailable";

export const GRID_START_MIN = 8 * 60; // 8:00a
export const GRID_END_MIN = 20 * 60; // 8:00p
/**
 * Quarter hours.
 *
 * Half-hour cells could not say "12:15 to 1:45", which is a real answer real
 * TAs give: they rounded to something else, or wrote to the coordinator and
 * had it typed in by hand. Fifteen minutes is as fine as a university
 * timetable ever gets.
 */
export const SLOT_MIN = 15;
export const SLOTS_PER_HOUR = 60 / SLOT_MIN;
export const SLOT_COUNT = (GRID_END_MIN - GRID_START_MIN) / SLOT_MIN; // 48
/** Row height. Four to the hour at 12px keeps the grid a screenful. */
export const CELL_PX = 12;

export interface ManualBlock {
  day: DayCode;
  startMin: number;
  endMin: number;
  status: SlotState;
}

export interface ImportedBlock {
  day: DayCode;
  startMin: number;
  endMin: number;
  /** Course/section label, e.g. "CMSC330 · 0201". Falls back to "Class". */
  label?: string;
}

/** grid[dayIndex][slot] — dayIndex follows DAY_CODES order (M..F). */
export type Grid = SlotState[][];
export type LockedGrid = boolean[][];

export function dayIndex(day: DayCode): number {
  return DAY_CODES.indexOf(day);
}

/** Clamp a minute range to the visible grid, as [firstSlot, lastSlotExclusive]. */
export function slotRange(startMin: number, endMin: number): [number, number] {
  const s0 = Math.max(0, Math.floor((startMin - GRID_START_MIN) / SLOT_MIN));
  const s1 = Math.min(SLOT_COUNT, Math.ceil((endMin - GRID_START_MIN) / SLOT_MIN));
  return [s0, s1];
}

export function emptyGrid(): Grid {
  return DAY_CODES.map(() => Array<SlotState>(SLOT_COUNT).fill("unavailable"));
}

/** Expand saved manual blocks into the paint grid. Unpainted = unavailable. */
export function blocksToGrid(blocks: ManualBlock[]): Grid {
  const grid = emptyGrid();
  for (const b of blocks) {
    const d = dayIndex(b.day);
    if (d < 0) continue;
    const [s0, s1] = slotRange(b.startMin, b.endMin);
    for (let s = s0; s < s1; s++) grid[d][s] = b.status;
  }
  return grid;
}

/** Cells covered by imported class blocks — locked, never painted or saved. */
export function buildLockedGrid(imported: ImportedBlock[]): LockedGrid {
  const locked = DAY_CODES.map(() => Array<boolean>(SLOT_COUNT).fill(false));
  for (const b of imported) {
    const d = dayIndex(b.day);
    if (d < 0) continue;
    const [s0, s1] = slotRange(b.startMin, b.endMin);
    for (let s = s0; s < s1; s++) locked[d][s] = true;
  }
  return locked;
}

/**
 * Merge painted cells into the minimal set of manual blocks. Only
 * available / prefer_not runs are saved — unavailable is the implicit
 * default. Runs break at locked (imported class) cells so manual blocks
 * never overlap imported ones.
 */
export function gridToBlocks(grid: Grid, locked: LockedGrid): ManualBlock[] {
  const blocks: ManualBlock[] = [];
  for (let d = 0; d < DAY_CODES.length; d++) {
    let runStart = -1;
    let runStatus: SlotState | null = null;
    const flush = (end: number) => {
      if (runStart >= 0 && runStatus) {
        blocks.push({
          day: DAY_CODES[d],
          startMin: GRID_START_MIN + runStart * SLOT_MIN,
          endMin: GRID_START_MIN + end * SLOT_MIN,
          status: runStatus,
        });
      }
      runStart = -1;
      runStatus = null;
    };
    for (let s = 0; s < SLOT_COUNT; s++) {
      const state =
        locked[d][s] || grid[d][s] === "unavailable" ? null : grid[d][s];
      if (state !== runStatus) {
        flush(s);
        if (state) {
          runStart = s;
          runStatus = state;
        }
      }
    }
    flush(SLOT_COUNT);
  }
  return blocks;
}

/** Painted (unlocked) hours by state, for the header summary + day headers. */
export function countHours(
  grid: Grid,
  locked: LockedGrid,
): { available: number; preferNot: number; availableByDay: number[] } {
  let available = 0;
  let preferNot = 0;
  const availableByDay: number[] = [];
  for (let d = 0; d < DAY_CODES.length; d++) {
    let dayAvail = 0;
    for (let s = 0; s < SLOT_COUNT; s++) {
      if (locked[d][s]) continue;
      if (grid[d][s] === "available") dayAvail++;
      else if (grid[d][s] === "prefer_not") preferNot++;
    }
    available += dayAvail;
    availableByDay.push(dayAvail / SLOTS_PER_HOUR);
  }
  return {
    available: available / SLOTS_PER_HOUR,
    preferNot: preferNot / SLOTS_PER_HOUR,
    availableByDay,
  };
}

export interface ExceptionItem {
  id: string;
  startDate: string; // ISO YYYY-MM-DD
  endDate: string; // ISO YYYY-MM-DD
  reason: string;
}

export interface AvailabilityData {
  /** e.g. "Fall 2026" */
  term?: string;
  /** ISO date the coordinator collects availability until. */
  deadline?: string;
  manualBlocks: ManualBlock[];
  importedBlocks: ImportedBlock[];
  dateExceptions: ExceptionItem[];
  /** Server timestamp of last submit, or null. */
  submittedAt: number | null;
}

/** Fixture mirroring the design prototype — lets a DEV harness render the screen with no backend. */
export const availabilityFixture: AvailabilityData = {
  term: "Fall 2026",
  deadline: "2026-09-13",
  manualBlocks: [
    { day: "M", startMin: 540, endMin: 1020, status: "available" },
    { day: "M", startMin: 1020, endMin: 1200, status: "prefer_not" },
    { day: "Tu", startMin: 540, endMin: 900, status: "available" },
    { day: "W", startMin: 540, endMin: 1020, status: "available" },
    { day: "W", startMin: 1020, endMin: 1200, status: "prefer_not" },
    { day: "Th", startMin: 480, endMin: 1020, status: "available" },
    { day: "Th", startMin: 1020, endMin: 1200, status: "prefer_not" },
    { day: "F", startMin: 540, endMin: 900, status: "available" },
  ],
  importedBlocks: [
    { day: "M", startMin: 600, endMin: 660, label: "CMSC330" },
    { day: "W", startMin: 600, endMin: 660, label: "CMSC330" },
    { day: "F", startMin: 600, endMin: 660, label: "CMSC330" },
    { day: "Tu", startMin: 540, endMin: 590, label: "CMSC330 · 0201" },
    { day: "Tu", startMin: 750, endMin: 825, label: "MATH240" },
    { day: "Th", startMin: 750, endMin: 825, label: "MATH240" },
    { day: "M", startMin: 840, endMin: 915, label: "ENGL393" },
    { day: "W", startMin: 840, endMin: 915, label: "ENGL393" },
  ],
  dateExceptions: [
    { id: "fixture-1", startDate: "2026-10-14", endDate: "2026-10-16", reason: "Out of town" },
  ],
  submittedAt: null,
};
