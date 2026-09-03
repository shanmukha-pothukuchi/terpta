import { useEffect, useRef, type CSSProperties } from "react";
import { Lock } from "lucide-react";
import {
  DAY_CODES,
  DAY_SHORT,
  formatTimeRange,
} from "../../../lib/format";
import { assignLanes, laneStyle } from "../../../lib/lanes";
import {
  CELL_PX,
  SLOT_COUNT,
  dayIndex,
  slotRange,
  type Grid,
  type ImportedBlock,
  type LockedGrid,
  type SlotState,
} from "./model";

const FILL: Record<SlotState, { bg: string; edge: string }> = {
  available: { bg: "rgba(61,214,140,0.17)", edge: "rgba(61,214,140,0.42)" },
  prefer_not: { bg: "rgba(245,165,36,0.15)", edge: "rgba(245,165,36,0.42)" },
  unavailable: {
    bg: "repeating-linear-gradient(135deg,rgba(255,255,255,0.055) 0 1px,transparent 1px 7px) rgba(255,255,255,0.015)",
    edge: "rgba(255,255,255,0.09)",
  },
};

const HOUR_LABELS = Array.from({ length: SLOT_COUNT / 2 }, (_, i) => {
  const h = 8 + i;
  const twelve = h > 12 ? h - 12 : h;
  return {
    long: h === 8 ? "8 AM" : h === 12 ? "12 PM" : String(twelve),
    short: h === 8 ? "8a" : h === 12 ? "12p" : String(twelve),
  };
});

interface Run {
  s0: number;
  s1: number; // inclusive
  state: SlotState;
}

/** Contiguous same-state runs per day (skipping locked cells) render as single blocks. */
function dayRuns(grid: Grid, locked: LockedGrid, d: number): Run[] {
  const runs: Run[] = [];
  for (let s = 0; s < SLOT_COUNT; s++) {
    if (locked[d][s]) continue;
    const state = grid[d][s];
    const last = runs[runs.length - 1];
    if (last && last.state === state && last.s1 === s - 1) last.s1 = s;
    else runs.push({ s0: s, s1: s, state });
  }
  return runs;
}

function cellAt(x: number, y: number): { d: number; s: number } | null {
  const el = document.elementFromPoint(x, y);
  const cell =
    el instanceof Element ? el.closest<HTMLElement>("[data-cell]") : null;
  if (!cell) return null;
  return { d: Number(cell.dataset.d), s: Number(cell.dataset.s) };
}

export interface AvailabilityGridProps {
  grid: Grid;
  locked: LockedGrid;
  importedBlocks: ImportedBlock[];
  /** Available hours per day, shown in the day header (desktop). */
  availableByDay: number[];
  onPaint: (d: number, s: number) => void;
}

/**
 * The Mon–Fri 8a–8p paint grid. Pointer events give one code path for
 * mouse drag and touch drag (touch-action: none on the body).
 */
export function AvailabilityGrid({
  grid,
  locked,
  importedBlocks,
  availableByDay,
  onPaint,
}: AvailabilityGridProps) {
  const painting = useRef(false);

  useEffect(() => {
    const end = () => {
      painting.current = false;
    };
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    return () => {
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
    };
  }, []);

  const cols =
    "grid grid-cols-[38px_repeat(5,minmax(0,1fr))] sm:grid-cols-[56px_repeat(5,minmax(0,1fr))]";

  return (
    <div className="overflow-hidden rounded-[12px] border border-line bg-surface">
      {/* Day header */}
      <div className={`${cols} h-[30px] items-center border-b border-line sm:h-[34px]`}>
        <div />
        {DAY_CODES.map((day, d) => (
          <div
            key={day}
            className="border-l border-white/[0.06] text-center text-[12px] font-medium text-[#C9C9CF] sm:pl-[10px] sm:text-left sm:text-[12.5px]"
          >
            {DAY_SHORT[day]}
            <span className="ml-[6px] hidden font-mono font-normal text-faint sm:inline">
              {availableByDay[d]}h
            </span>
          </div>
        ))}
      </div>
      {/* Paint area */}
      <div
        className={`${cols} cursor-crosshair touch-none select-none`}
        onPointerDown={(e) => {
          if (e.pointerType === "mouse" && e.button !== 0) return;
          const c = cellAt(e.clientX, e.clientY);
          if (!c) return;
          e.preventDefault();
          painting.current = true;
          onPaint(c.d, c.s);
        }}
        onPointerMove={(e) => {
          if (!painting.current) return;
          const c = cellAt(e.clientX, e.clientY);
          if (c) onPaint(c.d, c.s);
        }}
        onPointerUp={() => {
          painting.current = false;
        }}
      >
        {/* Time gutter */}
        <div>
          {HOUR_LABELS.map((h) => (
            <div
              key={h.long}
              className="box-border h-[44px] pr-[5px] pt-[3px] text-right font-mono text-[9.5px] text-faint sm:pr-2 sm:text-[10.5px]"
            >
              <span className="sm:hidden">{h.short}</span>
              <span className="hidden sm:inline">{h.long}</span>
            </div>
          ))}
        </div>
        {/* Day columns */}
        {DAY_CODES.map((day, d) => (
          <div key={day} className="relative border-l border-white/[0.06]">
            {grid[d].map((_, s) => (
              <div
                key={s}
                data-cell=""
                data-d={d}
                data-s={s}
                className="box-border h-[22px] border-b transition-colors duration-100 hover:bg-white/[0.04]"
                style={{
                  borderBottomColor:
                    s % 2 ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.035)",
                }}
              />
            ))}
            {/* State runs — one block per contiguous run, gridlines show through */}
            {dayRuns(grid, locked, d).map((r) => (
              <div
                key={`${r.s0}-${r.state}`}
                className="pointer-events-none absolute left-[3px] right-[3px] rounded-[5px] sm:left-1 sm:right-1 sm:rounded-[6px]"
                style={{
                  top: r.s0 * CELL_PX + 1,
                  height: (r.s1 - r.s0 + 1) * CELL_PX - 2,
                  background: FILL[r.state].bg,
                  boxShadow: `inset 0 0 0 1px ${FILL[r.state].edge}`,
                }}
              />
            ))}
            {/* Imported class blocks — locked. Two classes at the same hour
                would otherwise stack and double their labels, so they split
                into side-by-side lanes the way the week grids do. */}
            {(() => {
              const dayBlocks = importedBlocks.filter((b) => dayIndex(b.day) === d);
              const spans = assignLanes(
                dayBlocks.map((b, i) => ({
                  id: String(i),
                  start: b.startMin,
                  end: b.endMin,
                })),
              );
              return dayBlocks.map((b, i) => {
                const [s0, s1] = slotRange(b.startMin, b.endMin);
                if (s1 <= s0) return null;
                const { left, width } = laneStyle(spans.get(String(i)), {
                  inset: 3,
                  gutter: 2,
                });
                const style: CSSProperties = {
                  top: s0 * CELL_PX + 1,
                  height: (s1 - s0) * CELL_PX - 3,
                  left,
                  width,
                };
                return (
                  <div
                    key={i}
                    title={`${b.label ?? "Class"} · ${formatTimeRange(b.startMin, b.endMin)}`}
                    className="absolute flex cursor-not-allowed flex-col gap-[1px] overflow-hidden rounded-[5px] bg-[rgba(125,147,178,0.16)] p-[4px_5px] shadow-[inset_0_0_0_1px_rgba(125,147,178,0.35)] sm:flex-row sm:items-start sm:justify-between sm:rounded-[6px] sm:p-[5px_8px]"
                    style={style}
                  >
                    <div className="flex min-w-0 flex-col gap-[1px]">
                      <span className="truncate font-mono text-[9.5px] font-medium text-[#B7C6DC] sm:text-[11px]">
                        {b.label ?? "Class"}
                      </span>
                      <span className="hidden truncate text-[10.5px] text-classblue sm:block">
                        {formatTimeRange(b.startMin, b.endMin)}
                      </span>
                    </div>
                    <Lock
                      strokeWidth={1.5}
                      className="h-2.5 w-2.5 flex-none text-classblue sm:h-3 sm:w-3"
                    />
                  </div>
                );
              });
            })()}
          </div>
        ))}
      </div>
    </div>
  );
}
