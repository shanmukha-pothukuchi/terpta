import { useDroppable } from "@dnd-kit/core";
import type { Id } from "../../../../convex/_generated/dataModel";
import {
  DAY_SHORT,
  formatDate,
  formatTimeRange,
  type DayCode,
} from "../../../lib/format";
import { EmptyState } from "../../../components/ui";
import { CalendarX2 } from "lucide-react";
import { AssignChip } from "./AssignChip";
import { lighten, withAlpha } from "../../../lib/color";
import { firstName, type BuilderModel, type Highlight, type ShiftRow } from "./model";

export interface EventsStripProps {
  model: BuilderModel;
  highlight: Highlight;
  onOpenTa: (taProfileRef: Id<"taProfiles">) => void;
  /** Open the shift side panel. */
  onOpenShift: (shift: ShiftRow) => void;
  onToggleLock: (assignmentRef: Id<"assignments">) => void;
  onRemoveAssignment: (assignmentRef: Id<"assignments">) => void;
}

function EventCard({
  model,
  shift,
  highlight,
  onOpenTa,
  onOpenShift,
  onToggleLock,
  onRemoveAssignment,
}: {
  model: BuilderModel;
  shift: ShiftRow;
  highlight: Highlight;
  onOpenTa: (taProfileRef: Id<"taProfiles">) => void;
  onOpenShift: (shift: ShiftRow) => void;
  onToggleLock: (assignmentRef: Id<"assignments">) => void;
  onRemoveAssignment: (assignmentRef: Id<"assignments">) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `shift:${shift._id}` });
  const assigned = model.assignmentsByShift.get(shift._id as string) ?? [];
  const missing = Math.max(0, shift.requiredCount - assigned.length);
  const unfilled = missing > 0;
  const duty = model.dutyById.get(shift.dutyTypeRef as string);
  const hoursEach =
    shift.startMin !== undefined && shift.endMin !== undefined
      ? (shift.endMin - shift.startMin) / 60
      : (duty?.defaultHoursCredit ?? 0);

  let ring = "none";
  if (highlight === "unfilled" && unfilled) ring = "0 0 0 2px rgba(255,255,255,0.55)";
  if (isOver) ring = "0 0 0 2px rgba(255,255,255,0.35)";

  return (
    <div
      ref={setNodeRef}
      role="button"
      tabIndex={0}
      onClick={() => onOpenShift(shift)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpenShift(shift);
        }
      }}
      className="flex cursor-pointer flex-col gap-2 rounded-[10px] px-3 py-[10px] transition-[box-shadow] duration-150"
      style={{
        border: unfilled
          ? "1px dashed rgba(226,24,51,0.5)"
          : `1px solid ${withAlpha(duty?.color, 0.32)}`,
        background: unfilled ? "rgba(226,24,51,0.05)" : withAlpha(duty?.color, 0.09),
        boxShadow: ring,
      }}
    >
      <div className="flex items-center gap-2">
        <div className="text-[13px] font-medium" style={{ color: lighten(duty?.color, 0.7) }}>
          {shift.description ?? duty?.name ?? "Event"}
        </div>
        <div className="flex-1" />
        <div
          className="text-[11.5px]"
          style={{ color: unfilled ? "#7FE3B1" : "#6B6B75" }}
        >
          {unfilled ? `${shift.availableTaCount} TAs free that day` : "Staffed"}
        </div>
      </div>
      <div className="flex items-center gap-[10px] font-mono text-[11.5px] text-muted">
        <span className="text-[#C9C9CF]">
          {shift.day !== undefined ? `${DAY_SHORT[shift.day as DayCode]} ` : ""}
          {shift.date !== undefined ? formatDate(shift.date) : ""}
        </span>
        {shift.startMin !== undefined && shift.endMin !== undefined && (
          <span>{formatTimeRange(shift.startMin, shift.endMin)}</span>
        )}
        <span>
          {shift.requiredCount} TAs · {hoursEach}h each
        </span>
      </div>
      <div className="flex flex-wrap gap-[5px]">
        {assigned.map((a) => {
          const conflicts = model.conflictsByAssignment.get(a._id as string) ?? [];
          const conflict = conflicts.length > 0;
          const over = model.overTaIds.has(a.taProfileRef as string);
          const name = firstName(model.taName(a.taProfileRef));
          const lit =
            (highlight === "conflict" && conflict) ||
            (highlight === "over" && over) ||
            (highlight === "under" &&
              model.underTaIds.has(a.taProfileRef as string)) ||
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
              conflict={conflict}
              overCap={over}
              highlighted={lit}
              locked={a.locked}
              tooltip={conflicts.map((c) => c.detail).join(" · ") || undefined}
              onOpen={() => onOpenTa(a.taProfileRef)}
              onToggleLock={() => onToggleLock(a._id)}
              onRemove={() => onRemoveAssignment(a._id)}
            />
          );
        })}
        {Array.from({ length: missing }, (_, i) => (
          <span
            key={`empty-${i}`}
            className="flex h-[22px] items-center rounded-[6px] border border-dashed border-[rgba(226,24,51,0.55)] px-2 text-[11px] text-[#F4A3AE]"
          >
            Drop a TA
          </span>
        ))}
      </div>
    </div>
  );
}

/** One-off events strip (exam proctoring etc.) with the same chip slots. */
export function EventsStrip({
  model,
  highlight,
  onOpenTa,
  onOpenShift,
  onToggleLock,
  onRemoveAssignment,
}: EventsStripProps) {
  const staffed = model.events.reduce(
    (n, e) => n + (model.assignmentsByShift.get(e._id as string)?.length ?? 0),
    0,
  );
  const needed = model.events.reduce((n, e) => n + e.requiredCount, 0);

  return (
    <div className="overflow-hidden rounded-[12px] border border-line bg-surface">
      <div className="flex h-10 items-center gap-[10px] border-b border-line px-[14px]">
        <div className="text-[13px] font-medium">One-off events</div>
        <div className="text-xs text-faint">
          {model.events.length === 0
            ? "None scheduled"
            : `${staffed} of ${needed} TA seats filled`}
        </div>
      </div>
      {model.events.length === 0 ? (
        <div className="p-3">
          <EmptyState
            icon={CalendarX2}
            title="No one-off events"
            hint="Add exam proctoring or review sessions from the Shifts page."
          />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-[10px] px-[14px] py-3">
          {model.events.map((shift) => (
            <EventCard
              key={shift._id as string}
              model={model}
              shift={shift}
              highlight={highlight}
              onOpenTa={onOpenTa}
              onOpenShift={onOpenShift}
              onToggleLock={onToggleLock}
              onRemoveAssignment={onRemoveAssignment}
            />
          ))}
        </div>
      )}
    </div>
  );
}
