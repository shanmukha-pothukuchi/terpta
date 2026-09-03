/* Mini week grid — read-only preview of the class times step 2 has locked in.
   Shares GRID_START_MIN / GRID_END_MIN / SLOT_MIN with the full availability
   grid so the two line up column-for-column; rows are half CELL_PX so the
   whole week fits the 360px sidebar. */
import { DAY_CODES, DAY_SHORT, formatTime, formatTimeRange } from "../../../lib/format";
import {
  CELL_PX,
  GRID_END_MIN,
  GRID_START_MIN,
  SLOT_COUNT,
  SLOT_MIN,
  dayIndex,
  slotRange,
} from "../availability/model";
import type { ClassMeeting } from "./model";

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

/** Half the paint grid's row height — this preview is compact by design. */
export const MINI_CELL_PX = CELL_PX / 2;

const SLOTS_PER_HOUR = 60 / SLOT_MIN;

/** 8a … 7p — one label per hour boundary down the left gutter. */
const HOUR_STARTS = Array.from(
  { length: Math.floor((GRID_END_MIN - GRID_START_MIN) / 60) },
  (_, i) => GRID_START_MIN + i * 60,
);

const COLS = "grid grid-cols-[30px_repeat(5,minmax(0,1fr))]";

export interface MiniWeekGridProps {
  /** Flattened meetings, as returned by lockedMeetings(value). */
  meetings: Array<ClassMeeting & { label: string }>;
  className?: string;
}

/**
 * Mon–Fri × 8a–8p preview. Every meeting renders as an absolutely positioned
 * block in the imported-class tint, matching AvailabilityGrid's locked cells.
 */
export function MiniWeekGrid({ meetings, className }: MiniWeekGridProps) {
  const empty = meetings.length === 0;

  return (
    <div className={cx("overflow-hidden rounded-[12px] border border-line bg-surface", className)}>
      {/* Day header */}
      <div className={cx(COLS, "h-[26px] items-center border-b border-line")}>
        <div />
        {DAY_CODES.map((day) => (
          <div
            key={day}
            className="truncate border-l border-white/[0.06] pl-[6px] text-[11.5px] font-medium text-[#C9C9CF]"
          >
            {DAY_SHORT[day]}
          </div>
        ))}
      </div>

      {/* Week body */}
      <div className={cx(COLS, "relative select-none")}>
        {/* Hour gutter */}
        <div>
          {HOUR_STARTS.map((min) => (
            <div
              key={min}
              className="box-border pr-[4px] pt-px text-right font-mono text-[9.5px] leading-none text-faint"
              style={{ height: SLOTS_PER_HOUR * MINI_CELL_PX }}
            >
              {formatTime(min, { compact: true })}
            </div>
          ))}
        </div>

        {/* Day columns */}
        {DAY_CODES.map((day, d) => (
          <div key={day} className="relative border-l border-white/[0.06]">
            {Array.from({ length: SLOT_COUNT }, (_, s) => (
              <div
                key={s}
                className="box-border border-b"
                style={{
                  height: MINI_CELL_PX,
                  borderBottomColor: s % 2 ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.035)",
                }}
              />
            ))}

            {/* Imported + manual class blocks — classblue tint, same as the full grid */}
            {meetings
              .filter((m) => dayIndex(m.day) === d)
              .map((m, i) => {
                const [s0, s1] = slotRange(m.startMin, m.endMin);
                if (s1 <= s0) return null;
                return (
                  <div
                    key={`${m.label}-${m.startMin}-${i}`}
                    title={`${m.label} · ${formatTimeRange(m.startMin, m.endMin)}${
                      m.room ? ` · ${m.room}` : ""
                    }`}
                    className="absolute left-[2px] right-[2px] overflow-hidden rounded-[4px] bg-[rgba(125,147,178,0.16)] px-[3px] shadow-[inset_0_0_0_1px_rgba(125,147,178,0.35)]"
                    style={{
                      top: s0 * MINI_CELL_PX + 1,
                      height: (s1 - s0) * MINI_CELL_PX - 2,
                    }}
                  >
                    <span className="block truncate font-mono text-[10.5px] font-medium leading-[13px] text-[#B7C6DC]">
                      {m.label}
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
