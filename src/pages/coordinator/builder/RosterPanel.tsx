import { useDraggable, useDroppable } from "@dnd-kit/core";
import { CalendarOff, GripVertical, TriangleAlert } from "lucide-react";
import type { Id } from "../../../../convex/_generated/dataModel";
import { firstName, type BuilderModel, type Highlight, type RosterRow } from "./model";

export interface RosterPanelProps {
  model: BuilderModel;
  highlight: Highlight;
  /** TAs away for part of the selected week. */
  awayTaIds?: ReadonlySet<string>;
  onOpenTa: (taProfileRef: Id<"taProfiles">) => void;
}

function RosterRowView({
  row,
  model,
  highlight,
  away,
  onOpenTa,
}: {
  row: RosterRow;
  model: BuilderModel;
  highlight: Highlight;
  away?: boolean;
  onOpenTa: (taProfileRef: Id<"taProfiles">) => void;
}) {
  const id = row.taProfileRef as string;
  const name = firstName(row.name);
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `roster:${id}`,
    data: { taProfileRef: row.taProfileRef, name },
  });

  const load = model.loadByTa.get(id);
  const hours = load?.weeklyHours ?? 0;
  const cap = load?.maxHoursPerWeek ?? row.maxHoursPerWeek;
  const isOver = model.overTaIds.has(id);
  const pct = cap > 0 ? Math.min(100, Math.round((hours / cap) * 100)) : 0;
  const lit =
    (highlight === "over" && isOver) ||
    (highlight === "under" && model.underTaIds.has(id)) ||
    (highlight === "zero" && model.zeroTaIds.has(id)) ||
    highlight === `ta:${id}`;

  return (
    <div
      className="flex h-8 items-center gap-[10px] rounded-[8px] py-0 pl-1 pr-[6px] transition-colors duration-150 hover:bg-[rgba(255,255,255,0.04)]"
      style={{ background: lit ? "rgba(255,255,255,0.06)" : "transparent" }}
    >
      <span
        ref={setNodeRef}
        {...listeners}
        {...attributes}
        className="box-border flex h-[22px] min-w-[82px] cursor-grab select-none items-center gap-[6px] whitespace-nowrap rounded-[6px] bg-[rgba(255,255,255,0.07)] py-0 pl-[5px] pr-2 text-xs shadow-[inset_0_0_0_1px_rgba(255,255,255,0.10)] hover:bg-[rgba(255,255,255,0.11)]"
        style={{ opacity: isDragging ? 0.35 : 1 }}
      >
        <GripVertical size={10} strokeWidth={1.5} className="text-faint" />
        <button
          type="button"
          className="cursor-pointer"
          onClick={() => onOpenTa(row.taProfileRef)}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {name}
        </button>
      </span>
      {/* The track carries its own ring so an empty bar reads as a real zero
          rather than a bar that failed to render. A non-zero load never
          rounds away to nothing either — it keeps a visible sliver. */}
      <span className="relative h-1 min-w-0 flex-1 overflow-hidden rounded-[2px] bg-[rgba(255,255,255,0.05)] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.10)]">
        <span
          className="absolute top-0 bottom-0 left-0 rounded-[2px] transition-[width] duration-200"
          style={{
            width: hours > 0 ? `${Math.max(pct, 4)}%` : 0,
            background: isOver ? "#F5A524" : "#3DD68C",
          }}
        />
      </span>
      <span
        className="flex shrink-0 items-center justify-end gap-[4px] text-right font-mono text-[11px]"
        style={{ color: isOver ? "#F7C566" : "#9A9AA3" }}
      >
        {/* "No availability" is a separate signal — it must not replace the
            numbers, or an assigned TA's real load disappears behind a word. */}
        {/* Native `title` rather than the styled tooltip: the panel clips its
            overflow, so an absolutely-positioned tooltip on a row near the
            edge renders as a clipped dark sliver instead of readable text. */}
        {row.status === "missing" ? (
          <span
            title="No availability submitted"
            aria-label="No availability submitted"
            className="flex shrink-0 items-center"
          >
            <TriangleAlert size={11} strokeWidth={1.5} className="text-warn" aria-hidden />
          </span>
        ) : null}
        {away ? (
          <span
            title="Away for part of this week"
            aria-label="Away for part of this week"
            className="flex shrink-0 items-center"
          >
            <CalendarOff size={11} strokeWidth={1.5} className="text-warn" aria-hidden />
          </span>
        ) : null}
        <span className="min-w-12 truncate">{`${hours} / ${cap}h`}</span>
      </span>
    </div>
  );
}

/** Draggable roster with per-TA load bars (amber when over cap). */
export function RosterPanel({
  model,
  highlight,
  awayTaIds,
  onOpenTa,
}: RosterPanelProps) {
  const rows = [...model.rosterByTa.values()].sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  // Dropping an assigned chip back here unassigns it. Shifts used to be the
  // only droppables, so a drag meant to remove someone hit nothing at all.
  const { setNodeRef, isOver } = useDroppable({ id: "unassign" });

  return (
    <div
      ref={setNodeRef}
      className={
        "overflow-hidden rounded-[12px] border bg-surface transition-colors duration-150 " +
        (isOver ? "border-[rgba(226,24,51,0.7)]" : "border-line")
      }
    >
      <div className="flex h-10 items-center gap-[10px] border-b border-line px-[14px]">
        <div className="shrink-0 text-[13px] font-medium">Roster</div>
        <div className="min-w-0 truncate text-xs text-faint">
          {isOver ? "Drop to unassign" : "Drag a name into any slot"}
        </div>
      </div>
      <div className="flex flex-col gap-px p-[6px]">
        {rows.length === 0 ? (
          <div className="px-2 py-3 text-[12.5px] text-faint">
            No TAs on the roster yet.
          </div>
        ) : (
          rows.map((row) => (
            <RosterRowView
              key={row.taProfileRef as string}
              row={row}
              model={model}
              highlight={highlight}
              away={awayTaIds?.has(row.taProfileRef as string)}
              onOpenTa={onOpenTa}
            />
          ))
        )}
      </div>
    </div>
  );
}
