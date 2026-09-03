/* "Pulled from Schedule of Classes" — the one card on the Courses step.

   The card used to repeat every meeting as a text row above the grid, which
   said nothing the grid did not already show. Only the week grid remains: the
   search input names the course and section, the grid shows when they meet.

   Committed meetings are filled; the meetings of the currently highlighted
   search result are ghosted so the TA sees the consequence of a pick before
   committing it. */
import { MiniWeekGrid, type MiniBlock } from "./MiniWeekGrid";
import { previewSummary, type PreviewMeeting } from "./model";

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

/** Ghost blocks sit at .6, matching the dashed treatment in the grid. */
const GHOST_OPACITY = 0.6;

export interface ImportPreviewCardProps {
  /** previewMeetings(value, ghost) — committed rows first, ghosts last. */
  rows: PreviewMeeting[];
  className?: string;
}

export function ImportPreviewCard({ rows, className }: ImportPreviewCardProps) {
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
        <span className="shrink-0 font-mono text-[12px] text-faint">
          {previewSummary(rows)}
        </span>
      </div>

      {rows.length === 0 ? (
        <p className="text-[12.5px] text-faint">
          Add a course and its lecture and discussion times land here.
        </p>
      ) : (
        <MiniWeekGrid blocks={blocks} />
      )}
    </div>
  );
}
