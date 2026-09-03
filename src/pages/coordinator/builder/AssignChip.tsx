import { useDraggable } from "@dnd-kit/core";
import { Lock, LockOpen, TriangleAlert, X } from "lucide-react";
import type { Id } from "../../../../convex/_generated/dataModel";

/** Payload carried by every drag source (chips and roster names). */
export interface DragPayload {
  taProfileRef: Id<"taProfiles">;
  /** Set when dragging an existing assignment (moves instead of copies). */
  fromShiftRef?: Id<"shifts">;
  fromAssignmentRef?: Id<"assignments">;
  name: string;
}

export interface AssignChipProps {
  dragId: string;
  payload: DragPayload;
  name: string;
  size?: "sm" | "md"; // 20px grid chips vs 22px event chips
  conflict?: boolean;
  overCap?: boolean;
  highlighted?: boolean;
  /** Away on this shift's day in the selected week — struck through, dimmed. */
  away?: boolean;
  locked: boolean;
  tooltip?: string;
  onOpen?: () => void;
  onToggleLock?: () => void;
  /**
   * Unassign this TA. Dragging a chip off its slot used to be the only way,
   * and it silently did nothing — dropping outside a shift hit no droppable —
   * so removal needs a plain button that works on a trackpad too.
   */
  onRemove?: () => void;
}

/**
 * TA assignment chip per the board: 6px radius, inset ring, red glow on
 * conflict, amber ring when the TA is over cap, tiny lock toggle on the right.
 */
export function AssignChip({
  dragId,
  payload,
  name,
  size = "md",
  conflict = false,
  overCap = false,
  highlighted = false,
  away = false,
  locked,
  tooltip,
  onOpen,
  onToggleLock,
  onRemove,
}: AssignChipProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: dragId,
    data: payload,
  });

  let bg = "rgba(255,255,255,0.07)";
  let ring = "inset 0 0 0 1px rgba(255,255,255,0.10)";
  if (overCap) {
    bg = "rgba(245,165,36,0.10)";
    ring = "inset 0 0 0 1px rgba(245,165,36,0.6)";
  }
  if (conflict) {
    bg = "rgba(226,24,51,0.14)";
    ring = "inset 0 0 0 1px rgba(226,24,51,0.7), 0 0 10px rgba(226,24,51,0.25)";
  }
  if (away) {
    bg = "rgba(255,255,255,0.04)";
    ring = "inset 0 0 0 1px rgba(245,165,36,0.45)";
  }
  if (highlighted) ring += ", 0 0 0 2px rgba(255,255,255,0.55)";

  return (
    <span
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      title={tooltip}
      onClick={onOpen}
      className="group inline-flex cursor-grab select-none items-center gap-[5px] whitespace-nowrap rounded-[6px] text-ink transition-shadow duration-150"
      style={{
        height: size === "sm" ? 20 : 22,
        padding: "0 3px 0 7px",
        fontSize: size === "sm" ? 11.5 : 12,
        background: bg,
        boxShadow: ring,
        opacity: isDragging ? 0.35 : 1,
      }}
    >
      <span className={away ? "text-muted line-through" : undefined}>{name}</span>
      {conflict && (
        <TriangleAlert size={11} strokeWidth={1.5} className="shrink-0 text-[#F4A3AE]" />
      )}
      <button
        type="button"
        title={locked ? "Unlock assignment" : "Lock assignment"}
        onClick={(e) => {
          e.stopPropagation();
          onToggleLock?.();
        }}
        onPointerDown={(e) => e.stopPropagation()}
        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] transition-opacity duration-150 hover:bg-[rgba(255,255,255,0.10)] hover:opacity-100 ${
          locked ? "opacity-100" : "opacity-30"
        }`}
      >
        {locked ? (
          <Lock size={10} strokeWidth={1.5} className="text-ink" />
        ) : (
          <LockOpen size={10} strokeWidth={1.5} className="text-muted" />
        )}
      </button>
      {onRemove && !locked && (
        <button
          type="button"
          title={`Remove ${name}`}
          aria-label={`Remove ${name}`}
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          onPointerDown={(e) => e.stopPropagation()}
          className="flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] opacity-0 transition-opacity duration-150 group-hover:opacity-60 hover:bg-[rgba(226,24,51,0.22)] hover:opacity-100 focus-visible:opacity-100"
        >
          <X size={10} strokeWidth={1.5} className="text-[#F4A3AE]" />
        </button>
      )}
    </span>
  );
}

/** Plain visual chip used inside the DragOverlay while dragging. */
export function ChipGhost({ name }: { name: string }) {
  return (
    <span
      className="inline-flex items-center whitespace-nowrap rounded-[6px] px-2 text-[12px] text-ink"
      style={{
        height: 22,
        background: "rgba(255,255,255,0.12)",
        boxShadow:
          "inset 0 0 0 1px rgba(255,255,255,0.22), 0 8px 24px rgba(0,0,0,0.5)",
      }}
    >
      {name}
    </span>
  );
}
