/* "Pulled from Schedule of Classes" — the one card on the Courses step.

   Committed meetings get a raised fill; the meetings of the currently
   highlighted search result are ghosted in as dashed, unfilled rows so the TA
   sees the consequence of a pick before committing it. The same rows feed the
   mini week grid underneath, carrying their opacity with them.

   Each committed course's row group keeps a quiet Pencil toggle: the reference
   silently defaults the section, which would otherwise lock the wrong times
   with no way to correct them from this screen. */
import { useState } from "react";
import { Pencil } from "lucide-react";
import type { Id } from "../../../../convex/_generated/dataModel";
import { Select, Tooltip } from "../../../components/ui";
import { formatMeeting, formatTime } from "../../../lib/format";
import { MiniWeekGrid, type MiniBlock } from "./MiniWeekGrid";
import {
  previewSummary,
  type EnrollableSection,
  type EnrolledCourse,
  type PreviewMeeting,
} from "./model";

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

/** Ghost rows sit at .6 in the list; the grid blocks match. */
const GHOST_OPACITY = 0.6;

const SECTION_TYPES = ["lecture", "discussion", "lab"] as const;
type SectionType = (typeof SECTION_TYPES)[number];

const TYPE_LABEL: Record<SectionType, string> = {
  lecture: "Lecture",
  discussion: "Discussion",
  lab: "Lab",
};

/** "MWF 11:00a" — the days a section meets plus its start time. */
function sectionTimes(section: EnrollableSection): string {
  if (section.meetings.length === 0) return "TBA";
  const days = [...new Set(section.meetings.map((m) => m.day))].join("");
  return `${days} ${formatTime(section.meetings[0]!.startMin)}`;
}

interface Group {
  courseId: string;
  rows: PreviewMeeting[];
}

/** Consecutive rows share a course, so grouping never reorders the list. */
function groupRows(rows: PreviewMeeting[]): Group[] {
  const out: Group[] = [];
  for (const row of rows) {
    const last = out[out.length - 1];
    if (last && last.courseId === row.courseId) last.rows.push(row);
    else out.push({ courseId: row.courseId, rows: [row] });
  }
  return out;
}

export interface ImportPreviewCardProps {
  /** previewMeetings(value, ghost) — committed rows first, ghosts last. */
  rows: PreviewMeeting[];
  /** Committed courses, so a group can offer alternative sections. */
  courses?: EnrolledCourse[];
  onChangeSections?: (courseId: string, selectedSectionIds: Id<"sections">[]) => void;
  className?: string;
}

export function ImportPreviewCard({
  rows,
  courses = [],
  onChangeSections,
  className,
}: ImportPreviewCardProps) {
  const [editing, setEditing] = useState<string | null>(null);

  const groups = groupRows(rows);
  const blocks: MiniBlock[] = rows.map((r) => ({
    day: r.day,
    startMin: r.startMin,
    endMin: r.endMin,
    label: r.courseId,
    room: r.room,
    preview: r.preview,
    opacity: r.preview ? GHOST_OPACITY : 1,
  }));

  return (
    <div
      className={cx(
        "flex flex-col gap-3.5 rounded-[12px] border border-line bg-surface p-5",
        className,
      )}
    >
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="min-w-0 truncate text-[13px] font-semibold text-ink">
          Pulled from Schedule of Classes
        </h3>
        <span className="shrink-0 font-mono text-[12px] text-faint">{previewSummary(rows)}</span>
      </div>

      {groups.length === 0 ? (
        <p className="text-[12.5px] text-faint">
          Add a course and its lecture and discussion times land here.
        </p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {groups.map((group, gi) => {
            const course = courses.find((c) => c.courseId === group.courseId);
            const alternatives = course
              ? SECTION_TYPES.filter(
                  (t) => course.sections.filter((s) => s.type === t).length > 1,
                )
              : [];
            const open = editing === group.courseId;

            return (
              <div key={`${group.courseId}-${gi}`} className="flex flex-col gap-1">
                {group.rows.map((row, i) => (
                  <div
                    key={`${row.courseId}-${row.day}-${row.startMin}-${i}`}
                    className={cx(
                      "grid grid-cols-[90px_minmax(0,1fr)_auto] items-center gap-3 rounded-[8px] px-3 py-2.5",
                      row.preview
                        ? "border border-dashed border-line opacity-60"
                        : "bg-raised",
                    )}
                  >
                    <span className="truncate font-mono text-[13px] font-medium text-ink">
                      {row.courseId}
                    </span>
                    <span className="min-w-0 truncate text-[13px] text-muted">
                      {row.description}
                    </span>
                    <span className="shrink-0 whitespace-nowrap font-mono text-[12px] text-ink">
                      {formatMeeting(row.day, row.startMin, row.endMin)}
                    </span>
                  </div>
                ))}

                {alternatives.length > 0 && course && onChangeSections ? (
                  <>
                    <div className="flex justify-end">
                      <Tooltip label="Change section">
                        <button
                          type="button"
                          aria-label={`Change ${group.courseId} section`}
                          aria-expanded={open}
                          onClick={() => setEditing(open ? null : group.courseId)}
                          className={cx(
                            "grid size-6 cursor-pointer place-items-center rounded-[6px] hover:bg-[rgba(255,255,255,0.05)] hover:text-ink",
                            open ? "bg-[rgba(255,255,255,0.05)] text-ink" : "text-faint",
                          )}
                        >
                          <Pencil size={14} strokeWidth={1.5} aria-hidden />
                        </button>
                      </Tooltip>
                    </div>

                    {open ? (
                      <div className="flex flex-col gap-2 rounded-[8px] border border-line px-3 py-2.5">
                        {alternatives.map((type) => {
                          const options = course.sections.filter((s) => s.type === type);
                          const current =
                            options.find((s) => course.selectedSectionIds.includes(s._id))?._id ??
                            "";
                          return (
                            <label
                              key={type}
                              className="grid grid-cols-[76px_minmax(0,1fr)] items-center gap-2"
                            >
                              <span className="text-[12px] text-faint">{TYPE_LABEL[type]}</span>
                              <Select
                                value={current}
                                className="h-7 text-[12px]"
                                onChange={(e) => {
                                  const next = e.target.value as Id<"sections">;
                                  const others = course.selectedSectionIds.filter(
                                    (id) => !options.some((s) => s._id === id),
                                  );
                                  onChangeSections(course.courseId, [...others, next]);
                                }}
                              >
                                {options.map((s) => (
                                  <option key={s._id} value={s._id}>
                                    {`${s.sectionNumber} · ${sectionTimes(s)}`}
                                  </option>
                                ))}
                              </Select>
                            </label>
                          );
                        })}
                      </div>
                    ) : null}
                  </>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      <div className="border-t border-line pt-3">
        <MiniWeekGrid blocks={blocks} />
      </div>
    </div>
  );
}
