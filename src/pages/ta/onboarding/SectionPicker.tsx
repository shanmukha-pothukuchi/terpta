/* Section picker — one radio group per section type the course actually has.
   Most UMD courses come back with lectures only, so a single group is the
   common case, not an edge case. Row rhythm matches PeriodSetup's section list. */
import { useId, useState } from "react";
import type { Id } from "../../../../convex/_generated/dataModel";
import { Button } from "../../../components/ui";
import { formatMeeting } from "../../../lib/format";
import type { EnrollableSection } from "./model";

const TYPE_ORDER = ["lecture", "discussion", "lab"] as const;
type SectionType = (typeof TYPE_ORDER)[number];

const TYPE_LABELS: Record<SectionType, string> = {
  lecture: "Lecture",
  discussion: "Discussion",
  lab: "Lab",
};

/** "M 10:00a–10:50a · W 10:00a–10:50a", or a note when umd.io gave no times. */
export function meetingsText(section: EnrollableSection): string {
  if (section.meetings.length === 0) return "No meeting times";
  return section.meetings
    .map((m) => formatMeeting(m.day, m.startMin, m.endMin))
    .join(" · ");
}

/** Distinct room numbers across a section's meetings. */
export function roomsText(section: EnrollableSection): string {
  const rooms = Array.from(new Set(section.meetings.map((m) => m.room.trim()).filter(Boolean)));
  return rooms.join(" · ");
}

export interface SectionPickerProps {
  courseId: string;
  courseName: string;
  sections: EnrollableSection[];
  /** Pre-checks rows when re-opening the picker for an added course. */
  initialSelectedIds?: Id<"sections">[];
  onCommit: (selectedSectionIds: Id<"sections">[]) => void;
  onCancel: () => void;
  /** Defaults to "Add course"; the edit flow passes "Save changes". */
  submitLabel?: string;
}

export function SectionPicker({
  courseId,
  courseName,
  sections,
  initialSelectedIds,
  onCommit,
  onCancel,
  submitLabel,
}: SectionPickerProps) {
  const groupId = useId();

  const groups = TYPE_ORDER.map((type) => ({
    type,
    rows: sections.filter((s) => s.type === type),
  })).filter((g) => g.rows.length > 0);

  const [picked, setPicked] = useState<Partial<Record<SectionType, Id<"sections">>>>(() => {
    const seed: Partial<Record<SectionType, Id<"sections">>> = {};
    for (const type of TYPE_ORDER) {
      const rows = sections.filter((s) => s.type === type);
      if (rows.length === 0) continue;
      const chosen = initialSelectedIds
        ? rows.find((s) => initialSelectedIds.includes(s._id))
        : undefined;
      // A single-section group has nothing to decide — pre-select it.
      seed[type] = chosen?._id ?? (rows.length === 1 ? rows[0]._id : undefined);
    }
    return seed;
  });

  const complete = groups.length > 0 && groups.every((g) => picked[g.type] !== undefined);

  function commit() {
    const ids: Id<"sections">[] = [];
    for (const g of groups) {
      const id = picked[g.type];
      if (id) ids.push(id);
    }
    onCommit(ids);
  }

  return (
    <div className="overflow-hidden rounded-[12px] border border-line-strong bg-raised">
      <div className="flex h-10 items-center gap-2.5 border-b border-line px-3.5">
        <span className="shrink-0 font-mono text-[12.5px] font-medium text-ink">{courseId}</span>
        <span className="min-w-0 flex-1 truncate text-[12.5px] text-muted">{courseName}</span>
      </div>

      <div className="px-3.5 py-3">
        {groups.length === 0 ? (
          <p className="py-2 text-[12.5px] text-muted">
            {"No sections came back for this course — add its times manually below."}
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {groups.map((g) => (
              <fieldset
                key={g.type}
                className="overflow-hidden rounded-[10px] border border-line"
              >
                <legend className="sr-only">{TYPE_LABELS[g.type]}</legend>
                <div className="flex h-8 items-center gap-2 border-b border-[rgba(255,255,255,0.04)] bg-[rgba(255,255,255,0.02)] px-3">
                  <span className="text-[11px] font-medium uppercase tracking-[0.06em] text-faint">
                    {TYPE_LABELS[g.type]}
                  </span>
                  <span className="font-mono text-[11px] text-faint">{g.rows.length}</span>
                </div>
                {g.rows.map((s) => {
                  const checked = picked[g.type] === s._id;
                  return (
                    <label
                      key={s._id}
                      className="flex h-9 cursor-pointer items-center gap-3 border-b border-[rgba(255,255,255,0.04)] px-3 text-[12.5px] last:border-b-0 hover:bg-[rgba(255,255,255,0.03)]"
                    >
                      <input
                        type="radio"
                        name={`${groupId}-${g.type}`}
                        checked={checked}
                        onChange={() => setPicked((p) => ({ ...p, [g.type]: s._id }))}
                        className="size-3.5 shrink-0 cursor-pointer accent-umd"
                      />
                      <span className="w-12 shrink-0 font-mono font-medium">{s.sectionNumber}</span>
                      <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-muted">
                        {meetingsText(s)}
                      </span>
                      <span className="shrink-0 font-mono text-[11.5px] text-faint">
                        {roomsText(s)}
                      </span>
                    </label>
                  );
                })}
              </fieldset>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-line px-3.5 py-2.5">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" disabled={!complete} onClick={commit}>
          {submitLabel ?? "Add course"}
        </Button>
      </div>
    </div>
  );
}
