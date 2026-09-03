import type { ReactNode } from "react";
import { useDroppable } from "@dnd-kit/core";
import { CalendarOff, UserRoundCheck, UserRoundX } from "lucide-react";
import {
  coverageFor,
  isAwayOnDay,
  weekSeats,
  type WeekOverlay,
} from "./weekOverlay";
import type { Id } from "../../../../convex/_generated/dataModel";
import { DAY_CODES, DAY_SHORT, formatTimeRange } from "../../../lib/format";
import type { DayCode } from "../../../lib/format";
import { dateOfDayInWeek } from "../../../lib/week";
import { laneStyle, type LaneSpan } from "../../../lib/lanes";
import { lighten, withAlpha } from "../../../lib/color";
import { AssignChip } from "./AssignChip";
import {
  availabilityHint,
  firstName,
  roomOf,
  weeklyLaneSpans,
  type BuilderModel,
  type Highlight,
  type ShiftRow,
} from "./model";

const PX_PER_HOUR = 52;

export interface WeekGridProps {
  model: BuilderModel;
  highlight: Highlight;
  /** What is different about the selected week; null = the template. */
  week?: WeekOverlay | null;
  onOpenTa: (taProfileRef: Id<"taProfiles">) => void;
  /** Open the shift side panel. */
  onOpenShift: (shift: ShiftRow) => void;
  onToggleLock: (assignmentRef: Id<"assignments">) => void;
  onRemoveAssignment: (assignmentRef: Id<"assignments">) => void;
}

function Legend({ swatch, label }: { swatch: ReactNode; label: string }) {
  return (
    <div className="flex shrink-0 items-center gap-[6px] whitespace-nowrap text-[11.5px] text-muted">
      {swatch}
      {label}
    </div>
  );
}

function hourLabel(min: number, first: boolean): string {
  const h24 = Math.floor(min / 60);
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  if (first || h24 === 12) return `${h12} ${h24 < 12 ? "AM" : "PM"}`;
  return String(h12);
}

/**
 * Why this slot differs from the template this week, said in words.
 *
 * An icon on its own cannot tell "somebody is standing in" apart from "nobody
 * is" — which is the entire point of the marker — so the sub's name, or the
 * fact that there isn't one, goes on the board. The hover text is a native
 * `title`: the slot clips its overflow, and the styled tooltip is positioned
 * inside it, so it rendered as a clipped dark sliver above the block.
 */
function CoverBadge({
  label,
  note,
  resolved,
}: {
  label: string | null;
  note: string;
  /**
   * Green is a claim that this slot is fine, so it is withheld while the slot
   * is still short. A stand-in named for one date does not staff the seat the
   * other weeks, and a green tick over an empty roster reads as "handled".
   */
  resolved: boolean;
}) {
  const covered = label !== null && resolved;
  const Icon = covered ? UserRoundCheck : UserRoundX;
  return (
    <span
      title={note}
      aria-label={note}
      className={
        "ml-auto flex min-w-0 shrink-0 items-center gap-[3px] rounded-[4px] px-[3px] " +
        (covered ? "text-ok" : "text-warn")
      }
      style={{
        background: covered ? "rgba(61,214,140,0.12)" : "rgba(245,165,36,0.14)",
      }}
    >
      <Icon size={11} strokeWidth={1.5} className="shrink-0" aria-hidden />
      {/* Never dropped in a narrow lane: the icon alone is the ambiguity this
          badge exists to remove. The time beside it truncates first instead. */}
      <span className="max-w-[72px] truncate">{label ?? "No sub"}</span>
    </span>
  );
}

function Slot({
  model,
  shift,
  span,
  highlight,
  week,
  onOpenTa,
  onOpenShift,
  onToggleLock,
  onRemoveAssignment,
}: {
  model: BuilderModel;
  shift: ShiftRow;
  /** Column within the day's overlap cluster; undefined means "alone". */
  span: LaneSpan | undefined;
  highlight: Highlight;
  week?: WeekOverlay | null;
  onOpenTa: (taProfileRef: Id<"taProfiles">) => void;
  onOpenShift: (shift: ShiftRow) => void;
  onToggleLock: (assignmentRef: Id<"assignments">) => void;
  onRemoveAssignment: (assignmentRef: Id<"assignments">) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `shift:${shift._id}` });
  // A shift whose term does not reach this week is shown, but greyed:
  // hiding it would make the board look wrong rather than empty.
  const dormant = week?.dormantShiftIds.has(shift._id as string) ?? false;
  const coverage = coverageFor(week ?? null, shift._id, shift.day);
  const assigned = model.assignmentsByShift.get(shift._id as string) ?? [];
  // Empty seats on the standing roster. Drives the "Drop a TA" ghosts, so it
  // counts assignments — a one-date stand-in does not fill a seat every week.
  const missing = Math.max(0, shift.requiredCount - assigned.length);
  const isSection = shift.sectionRef !== undefined;
  const section = isSection
    ? model.sectionById.get(shift.sectionRef as string)
    : undefined;
  const duty = model.dutyById.get(shift.dutyTypeRef as string);

  // Who is actually in the room that day. A TA who is away does not count,
  // and a TA the coordinator dropped in by editing the roster counts every
  // bit as much as one recorded as a formal substitute: the badge answers
  // "is somebody there", not "does a shiftCoverages row say so". Without
  // this, filling the hole by drag left the slot reading "No sub" forever.
  const roster = assigned.map((a) => {
    const absence = week
      ? isAwayOnDay(week, a.taProfileRef, shift.day, (d) =>
          dateOfDayInWeek(week.weekStart, d),
        )
      : undefined;
    const away =
      absence !== undefined ||
      String(coverage?.absentTaRef ?? "") === String(a.taProfileRef);
    return { assignment: a, absence, away };
  });
  const present = roster.filter((r) => !r.away);

  // A recorded substitute is not on the board — a date-scoped swap leaves the
  // assignment with the absent TA — so the badge has to name them. Someone
  // swapped in on the roster is already on a chip below it, so naming them
  // again would just print the same word twice.
  const recordedCover = coverage?.coverName ? firstName(coverage.coverName) : null;
  const rosterCovered =
    recordedCover === null &&
    coverage !== undefined &&
    present.length >= shift.requiredCount;
  const standIn =
    recordedCover ??
    (rosterCovered ? firstName(model.taName(present[0].assignment.taProfileRef)) : null);
  const coverLabel = recordedCover ?? (rosterCovered ? "Covered" : null);

  // Short on the day itself: nobody assigned is coming and no stand-in was
  // recorded. An assigned TA who is away used to keep the seat looking taken,
  // so a meeting with literally nobody in the room read as fully staffed.
  // Same rule as the "Short this week" diagnostic: somebody assigned is away
  // and the seat is not filled. A slot nobody was ever assigned to is
  // "unfilled", not short, and is counted there instead.
  const seats = weekSeats(week ?? null, shift, assigned);
  const shortThisWeek = seats.short > 0 && seats.away.length > 0;
  const unfilled = missing > 0 || shortThisWeek;

  const coverNote = coverage
    ? coverage.coverName
      ? `${coverage.coverName} covers for ${coverage.absentName}`
      : standIn
        ? `${coverage.absentName} is away — ${standIn} is assigned instead`
        : `${coverage.absentName} out — nobody covering yet`
    : null;

  // Short with no coverage row to hang the marker on: a TA simply put a date
  // exception over the day and nothing was ever raised against it.
  const awayNames = roster
    .filter((r) => r.away)
    .map((r) => firstName(model.taName(r.assignment.taProfileRef)));
  // Only when somebody is actually away. A slot nobody was ever assigned to
  // is plainly unstaffed, not missing a sub, and the dashed seat says that
  // better than a badge would.
  const shortNote =
    shortThisWeek && !coverage && awayNames.length > 0
      ? `${awayNames.join(", ")} away — nobody covering this week`
      : null;

  const startMin = shift.startMin ?? model.gridStartMin;
  const endMin = shift.endMin ?? startMin + 60;
  const top = ((startMin - model.gridStartMin) / 60) * PX_PER_HOUR + 2;
  const height = ((endMin - startMin) / 60) * PX_PER_HOUR - 4;
  const { left, width } = laneStyle(span);
  // Split lanes are far too narrow for label + time + hint on one line, so the
  // hint drops out there and lives on the block's tooltip instead.
  const narrow = (span?.lanes ?? 1) > 1;
  const label = section ? section.sectionNumber : (duty?.name ?? "Shift");
  const timeText = formatTimeRange(startMin, endMin, { compact: true });

  const hint = unfilled
    ? availabilityHint(shift.availableTaCount, !isSection)
    : { text: roomOf(model, shift) || (duty?.name ?? ""), color: "#6B6B75" };

  let ring = "none";
  if (highlight === "unfilled" && unfilled) ring = "0 0 0 2px rgba(255,255,255,0.55)";
  if (highlight === "short" && shortThisWeek) ring = "0 0 0 2px rgba(255,255,255,0.55)";
  if (isOver) ring = "0 0 0 2px rgba(255,255,255,0.35)";

  return (
    <div
      ref={setNodeRef}
      // A block is a few hundred pixels wide at most; the panel is where the
      // room, the term and the whole roster actually fit.
      role="button"
      tabIndex={0}
      onClick={() => onOpenShift(shift)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpenShift(shift);
        }
      }}
      title={[label, timeText, hint.text, coverNote, dormant ? "Not running this week" : null]
        .filter(Boolean)
        .join(" · ")}
      className="absolute box-border flex cursor-pointer flex-col gap-1 overflow-hidden rounded-[8px] px-[7px] py-[5px] transition-[box-shadow,background] duration-150"
      style={{
        top,
        height,
        left,
        width,
        // The duty type's own color, so a board of discussions, office hours
        // and proctoring can be read at a glance. Unfilled keeps the red
        // dashed alarm: "nobody is on this" outranks "this is a discussion".
        background: unfilled ? "rgba(226,24,51,0.05)" : withAlpha(duty?.color, 0.1),
        border: unfilled
          ? "1px dashed rgba(226,24,51,0.5)"
          : `1px solid ${withAlpha(duty?.color, 0.32)}`,
        boxShadow: ring,
        // Out of term this week: still on the board, visibly not in play.
        opacity: dormant ? 0.4 : 1,
      }}
    >
      <div className="flex min-w-0 items-center gap-x-[6px] whitespace-nowrap text-[10.5px] leading-3">
        <span
          className="shrink-0 truncate font-mono font-medium"
          // Lifted toward white: UMD red at 10.5px on near-black is harsh.
          style={{ color: lighten(duty?.color, 0.62) }}
        >
          {label}
        </span>
        {/* A split lane cannot hold time and badge both; truncation turns the
            time into "1..", which says less than the row's own position does. */}
        {narrow && coverage ? null : (
          <span className="truncate text-faint">{timeText}</span>
        )}
        {dormant ? (
          <span
            title="Not running this week"
            className="ml-auto flex shrink-0 items-center gap-[3px] text-faint"
          >
            <CalendarOff size={11} strokeWidth={1.5} aria-hidden />
            {narrow ? null : <span>Off</span>}
          </span>
        ) : coverage && coverNote ? (
          <CoverBadge label={coverLabel} note={coverNote} resolved={!unfilled} />
        ) : shortNote ? (
          <CoverBadge label={null} note={shortNote} resolved={false} />
        ) : narrow ? null : (
          <span className="ml-auto truncate" style={{ color: hint.color }}>
            {hint.text}
          </span>
        )}
      </div>
      <div className="flex min-w-0 flex-wrap gap-1">
        {roster.map(({ assignment: a, absence, away }) => {
          const conflicts = model.conflictsByAssignment.get(a._id as string) ?? [];
          const conflict = conflicts.length > 0;
          const over = model.overTaIds.has(a.taProfileRef as string);
          const under = model.underTaIds.has(a.taProfileRef as string);
          const load = model.loadByTa.get(a.taProfileRef as string);
          const name = firstName(model.taName(a.taProfileRef));
          const awayNote = away
            ? standIn
              ? `${name} is away — ${standIn} takes it`
              : `${name} is away${absence?.reason ? ` — ${absence.reason}` : ""} · no sub yet`
            : null;
          const lit =
            (highlight === "conflict" && conflict) ||
            (highlight === "over" && over) ||
            (highlight === "under" && under) ||
            highlight === `ta:${a.taProfileRef as string}`;
          return (
            <AssignChip
              key={a._id as string}
              dragId={`assignment:${a._id}`}
              payload={{
                taProfileRef: a.taProfileRef,
                fromShiftRef: a.shiftRef,
                fromAssignmentRef: a._id,
                name,
              }}
              name={name}
              size="sm"
              conflict={conflict}
              overCap={over}
              highlighted={lit}
              away={away}
              locked={a.locked}
              tooltip={
                awayNote ||
                conflicts.map((c) => c.detail).join(" · ") ||
                (over && load
                  ? `${name} is over cap (${load.weeklyHours}/${load.maxHoursPerWeek}h)`
                  : load
                    ? `${name} · ${load.weeklyHours}/${load.maxHoursPerWeek}h · drag to move`
                    : name)
              }
              onOpen={() => onOpenTa(a.taProfileRef)}
              onToggleLock={() => onToggleLock(a._id)}
              onRemove={() => onRemoveAssignment(a._id)}
            />
          );
        })}
        {Array.from({ length: missing }, (_, i) => (
          <span
            key={`empty-${i}`}
            className="flex h-5 min-w-0 items-center gap-[5px] overflow-hidden rounded-[6px] border border-dashed border-[rgba(226,24,51,0.55)] px-[7px] text-[10.5px] whitespace-nowrap text-[#F4A3AE]"
          >
            {narrow
              ? `TA ${assigned.length + i + 1}`
              : missing > 1
                ? `Drop TA ${assigned.length + i + 1}`
                : "Drop a TA"}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Recurring weekly grid: time gutter + Mon–Fri columns with slot cards. */
export function WeekGrid({
  model,
  highlight,
  week = null,
  onOpenTa,
  onOpenShift,
  onToggleLock,
  onRemoveAssignment,
}: WeekGridProps) {
  const hours: number[] = [];
  for (let m = model.gridStartMin; m < model.gridEndMin; m += 60) hours.push(m);
  const columnHeight = hours.length * PX_PER_HOUR;
  const laneSpans = weeklyLaneSpans(model);

  const sectionCount = model.weekly.filter((s) => s.sectionRef !== undefined).length;
  const otherCount = model.weekly.length - sectionCount;
  const filled = model.weekly.filter(
    (s) =>
      (model.assignmentsByShift.get(s._id as string)?.length ?? 0) >=
      s.requiredCount,
  ).length;

  return (
    <div className="overflow-hidden rounded-[12px] border border-line bg-surface">
      <div className="flex h-10 items-center gap-[10px] border-b border-line px-[14px]">
        <div className="shrink-0 text-[13px] font-medium">Recurring</div>
        <div className="min-w-0 flex-1 truncate text-[12px] text-faint">
          {sectionCount} discussion sections · {otherCount} office-hour blocks ·{" "}
          {filled} of {model.weekly.length} filled
        </div>
        <Legend
          swatch={<div className="h-2 w-2 rounded-[2px] bg-[rgba(226,24,51,0.5)]" />}
          label="Conflict"
        />
        <Legend
          swatch={<div className="h-2 w-2 rounded-[2px] bg-[rgba(245,165,36,0.6)]" />}
          label="Over cap"
        />
        <Legend
          swatch={
            <div className="box-border h-2 w-2 rounded-[2px] border border-dashed border-[rgba(226,24,51,0.7)]" />
          }
          label="Unfilled"
        />
        {week ? (
          <>
            <Legend
              swatch={<UserRoundCheck size={11} strokeWidth={1.5} className="text-ok" />}
              label="Sub covering"
            />
            <Legend
              swatch={<UserRoundX size={11} strokeWidth={1.5} className="text-warn" />}
              label="Away, no sub"
            />
          </>
        ) : null}
      </div>
      <div className="grid h-[30px] items-center border-b border-[rgba(255,255,255,0.06)] [grid-template-columns:44px_repeat(5,1fr)]">
        <div />
        {DAY_CODES.map((d) => (
          <div
            key={d}
            className="border-l border-[rgba(255,255,255,0.06)] pl-2 text-xs font-medium text-[#C9C9CF]"
          >
            {DAY_SHORT[d]}
          </div>
        ))}
      </div>
      <div className="grid [grid-template-columns:44px_repeat(5,1fr)]">
        <div>
          {hours.map((m, i) => (
            <div
              key={m}
              className="box-border border-b border-[rgba(255,255,255,0.04)] pr-[6px] pt-[3px] text-right font-mono text-[10px] text-faint"
              style={{ height: PX_PER_HOUR }}
            >
              {hourLabel(m, i === 0)}
            </div>
          ))}
        </div>
        {DAY_CODES.map((day: DayCode) => (
          <div
            key={day}
            className="relative border-l border-[rgba(255,255,255,0.06)]"
            style={{
              height: columnHeight,
              background: `repeating-linear-gradient(180deg,transparent 0 ${PX_PER_HOUR - 1}px,rgba(255,255,255,0.04) ${PX_PER_HOUR - 1}px ${PX_PER_HOUR}px)`,
            }}
          >
            {model.weekly
              .filter((s) => s.day === day)
              .map((shift) => (
                <Slot
                  key={shift._id as string}
                  model={model}
                  shift={shift}
                  span={laneSpans.get(shift._id as string)}
                  highlight={highlight}
                  week={week}
                  onOpenTa={onOpenTa}
                  onOpenShift={onOpenShift}
                  onToggleLock={onToggleLock}
                  onRemoveAssignment={onRemoveAssignment}
                />
              ))}
          </div>
        ))}
      </div>
    </div>
  );
}
