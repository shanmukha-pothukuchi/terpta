import type { ReactNode } from "react";
import { useDroppable } from "@dnd-kit/core";
import { CalendarOff, UserRoundCheck } from "lucide-react";
import { Tooltip } from "../../../components/ui";
import { coverageFor, type WeekOverlay } from "./weekOverlay";
import type { Id } from "../../../../convex/_generated/dataModel";
import { DAY_CODES, DAY_SHORT, formatTimeRange } from "../../../lib/format";
import type { DayCode } from "../../../lib/format";
import { laneStyle, type LaneSpan } from "../../../lib/lanes";
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

function Slot({
  model,
  shift,
  span,
  highlight,
  week,
  onOpenTa,
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
  onToggleLock: (assignmentRef: Id<"assignments">) => void;
  onRemoveAssignment: (assignmentRef: Id<"assignments">) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `shift:${shift._id}` });
  // A shift whose term does not reach this week is shown, but greyed:
  // hiding it would make the board look wrong rather than empty.
  const dormant = week?.dormantShiftIds.has(shift._id as string) ?? false;
  const coverage = coverageFor(week ?? null, shift._id, shift.day);
  const assigned = model.assignmentsByShift.get(shift._id as string) ?? [];
  const missing = Math.max(0, shift.requiredCount - assigned.length);
  const unfilled = missing > 0;
  const isSection = shift.sectionRef !== undefined;
  const section = isSection
    ? model.sectionById.get(shift.sectionRef as string)
    : undefined;
  const duty = model.dutyById.get(shift.dutyTypeRef as string);

  const coverNote = coverage
    ? coverage.coverName
      ? `${coverage.coverName} covers for ${coverage.absentName}`
      : `${coverage.absentName} out — nobody covering yet`
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
  if (isOver) ring = "0 0 0 2px rgba(255,255,255,0.35)";

  return (
    <div
      ref={setNodeRef}
      title={[label, timeText, hint.text, coverNote, dormant ? "Not running this week" : null]
        .filter(Boolean)
        .join(" · ")}
      className="absolute box-border flex flex-col gap-1 overflow-hidden rounded-[8px] px-[7px] py-[5px] transition-[box-shadow,background] duration-150"
      style={{
        top,
        height,
        left,
        width,
        background: unfilled
          ? "rgba(226,24,51,0.05)"
          : isSection
            ? "rgba(255,255,255,0.035)"
            : "rgba(125,147,178,0.10)",
        border: unfilled
          ? "1px dashed rgba(226,24,51,0.5)"
          : isSection
            ? "1px solid rgba(255,255,255,0.08)"
            : "1px solid rgba(125,147,178,0.25)",
        boxShadow: ring,
        // Out of term this week: still on the board, visibly not in play.
        opacity: dormant ? 0.4 : 1,
      }}
    >
      <div className="flex min-w-0 items-center gap-x-[6px] whitespace-nowrap text-[10.5px] leading-3">
        <span
          className="shrink-0 truncate font-mono font-medium"
          style={{ color: isSection ? "#C9C9CF" : "#B7C6DC" }}
        >
          {label}
        </span>
        <span className="truncate text-faint">{timeText}</span>
        {dormant ? (
          <CalendarOff
            size={11}
            strokeWidth={1.5}
            className="ml-auto shrink-0 text-faint"
            aria-hidden
          />
        ) : coverNote ? (
          <Tooltip label={coverNote}>
            <UserRoundCheck
              size={11}
              strokeWidth={1.5}
              className={
                "ml-auto shrink-0 " +
                (coverage?.coverName ? "text-ok" : "text-warn")
              }
              aria-label={coverNote}
            />
          </Tooltip>
        ) : narrow ? null : (
          <span className="ml-auto truncate" style={{ color: hint.color }}>
            {hint.text}
          </span>
        )}
      </div>
      <div className="flex min-w-0 flex-wrap gap-1">
        {assigned.map((a) => {
          const conflicts = model.conflictsByAssignment.get(a._id as string) ?? [];
          const conflict = conflicts.length > 0;
          const over = model.overTaIds.has(a.taProfileRef as string);
          const under = model.underTaIds.has(a.taProfileRef as string);
          const load = model.loadByTa.get(a.taProfileRef as string);
          const name = firstName(model.taName(a.taProfileRef));
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
              locked={a.locked}
              tooltip={
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
