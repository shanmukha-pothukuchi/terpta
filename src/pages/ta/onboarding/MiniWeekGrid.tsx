/* Mini week grid — the read-only week at the foot of the import preview card.
   Mon–Fri only, 8a–8p, one 24px band per hour (288px body) over a mono hour
   rail. Blocks carry a per-block opacity so a ghosted (highlighted but not yet
   committed) course reads as a ghost here too, the same way it does in the
   dashed rows above it.

   It draws no card chrome of its own — ImportPreviewCard owns that. */
import { DAY_CODES, DAY_SHORT, formatTime, formatTimeRange } from "../../../lib/format";
import { GRID_END_MIN, GRID_START_MIN, dayIndex } from "../availability/model";
import type { DayCode } from "../../../lib/format";

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

/** One hour band, matching the reference's 36px-over-8h proportion at 12h. */
export const MINI_HOUR_PX = 24;

const SPAN_MIN = GRID_END_MIN - GRID_START_MIN;
const BODY_PX = (SPAN_MIN / 60) * MINI_HOUR_PX; // 288

/** 8a … 7p — one label per hour boundary down the left rail. */
const HOUR_STARTS = Array.from(
  { length: Math.floor(SPAN_MIN / 60) },
  (_, i) => GRID_START_MIN + i * 60,
);

const COLS = "grid grid-cols-[34px_repeat(5,minmax(0,1fr))]";

/** A block on the mini grid. `opacity` ghosts un-committed previews. */
export interface MiniBlock {
  day: DayCode;
  startMin: number;
  endMin: number;
  /** Course code — mono, truncated to the column. */
  label: string;
  room?: string;
  /** 1 (or omitted) for committed; ~0.55 for a ghosted preview. */
  opacity?: number;
  /** Draws the dashed, unfilled treatment used by preview rows. */
  preview?: boolean;
}

export interface MiniWeekGridProps {
  blocks: MiniBlock[];
  className?: string;
}

export function MiniWeekGrid({ blocks, className }: MiniWeekGridProps) {
  const empty = blocks.length === 0;

  return (
    <div className={cx("select-none", className)}>
      {/* Day header */}
      <div className={cx(COLS, "mb-1.5")}>
        <div />
        {DAY_CODES.map((day) => (
          <div key={day} className="truncate pl-[5px] text-[11px] font-medium text-faint">
            {DAY_SHORT[day]}
          </div>
        ))}
      </div>

      {/* Week body */}
      <div className={cx(COLS, "relative gap-x-[3px]")} style={{ height: BODY_PX }}>
        {/* Hour rail */}
        <div className="relative">
          {HOUR_STARTS.map((min) => (
            <div
              key={min}
              className="absolute right-[6px] font-mono text-[10px] leading-none text-faint"
              style={{ top: ((min - GRID_START_MIN) / 60) * MINI_HOUR_PX + 1 }}
            >
              {formatTime(min, { compact: true })}
            </div>
          ))}
        </div>

        {/* Day columns */}
        {DAY_CODES.map((day, d) => (
          <div
            key={day}
            className="relative overflow-hidden rounded-[3px]"
            style={{
              backgroundImage: `repeating-linear-gradient(to bottom, transparent 0 ${
                MINI_HOUR_PX - 1
              }px, rgba(255,255,255,0.06) ${MINI_HOUR_PX - 1}px ${MINI_HOUR_PX}px)`,
            }}
          >
            {blocks
              .filter((b) => dayIndex(b.day) === d)
              .map((b, i) => {
                const start = Math.max(GRID_START_MIN, b.startMin);
                const end = Math.min(GRID_END_MIN, b.endMin);
                if (end <= start) return null;
                const top = ((start - GRID_START_MIN) / 60) * MINI_HOUR_PX;
                const height = ((end - start) / 60) * MINI_HOUR_PX;
                return (
                  <div
                    key={`${b.label}-${b.startMin}-${i}`}
                    title={`${b.label} · ${formatTimeRange(b.startMin, b.endMin)}${
                      b.room ? ` · ${b.room}` : ""
                    }`}
                    className={cx(
                      "absolute left-0 right-0 overflow-hidden rounded-[4px] px-[4px]",
                      b.preview
                        ? "border border-dashed border-[rgba(125,147,178,0.55)]"
                        : "bg-[rgba(125,147,178,0.16)] shadow-[inset_0_0_0_1px_rgba(125,147,178,0.35)]",
                    )}
                    style={{
                      top,
                      height: Math.max(height - 1, 10),
                      opacity: b.opacity ?? 1,
                    }}
                  >
                    <span className="block truncate font-mono text-[10px] font-medium leading-[13px] text-[#B7C6DC]">
                      {b.label}
                    </span>
                  </div>
                );
              })}
          </div>
        ))}

        {empty ? (
          <div className="pointer-events-none absolute inset-0 grid place-items-center">
            <span className="rounded-[7px] border border-line bg-page/85 px-2.5 py-1.5 text-center text-[12px] text-faint">
              Your class times will appear here.
            </span>
          </div>
        ) : null}
      </div>
    </div>
  );
}
