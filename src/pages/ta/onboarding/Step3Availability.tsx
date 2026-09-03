/* Step 3 — availability. Thin wrapper around the existing
   <AvailabilityEditor>: the grid, brush picker and date-exceptions list all
   live there already, so this step only adds the wizard-only affordances
   (first-visit hint + week completion readout). */
import { useState } from "react";
import { Info, X } from "lucide-react";
import { ProgressBar } from "../../../components/ui";
import { AvailabilityEditor } from "../availability/AvailabilityEditor";
import type { AvailabilityEditorProps } from "../availability/AvailabilityEditor";
import type { AvailabilityData } from "../availability/model";

export interface Step3AvailabilityProps {
  data: AvailabilityData;
  onSave: AvailabilityEditorProps["onSave"];
  onAddException: AvailabilityEditorProps["onAddException"];
  onRemoveException: AvailabilityEditorProps["onRemoveException"];
  /** Percent of the paintable week marked, 0-100. */
  markedPercent: number;
  showFirstVisitHint?: boolean;
}

export function Step3Availability({
  data,
  onSave,
  onAddException,
  onRemoveException,
  markedPercent,
  showFirstVisitHint,
}: Step3AvailabilityProps): JSX.Element {
  const [hintDismissed, setHintDismissed] = useState(false);
  const pct = Math.round(Math.min(100, Math.max(0, markedPercent)));

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {/* Step header — the editor renders its own "Availability" title, so
          this row carries only the week completion readout. */}
      <div className="flex items-center gap-3">
        <h2 className="sr-only">Your availability</h2>
        <div className="flex-1" />
        <div className="flex w-[168px] shrink-0 items-center gap-2.5">
          <ProgressBar
            value={pct}
            max={100}
            tone={pct > 0 ? "ok" : "neutral"}
            className="min-w-0 flex-1"
          />
          <span className="shrink-0 whitespace-nowrap font-mono text-[11.5px] text-faint">
            Week {pct}% marked
          </span>
        </div>
      </div>

      {showFirstVisitHint && !hintDismissed ? (
        <div className="flex items-start gap-2.5 rounded-[10px] border border-line bg-[rgba(255,255,255,0.03)] px-3 py-2.5">
          <Info size={14} strokeWidth={1.5} className="mt-px shrink-0 text-faint" aria-hidden />
          <p className="min-w-0 flex-1 text-[12.5px] text-muted [text-wrap:pretty]">
            Click and drag to paint. Everything unmarked counts as unavailable.
          </p>
          <button
            type="button"
            onClick={() => setHintDismissed(true)}
            aria-label="Dismiss hint"
            className="-mr-1 grid size-5 shrink-0 cursor-pointer place-items-center rounded-[5px] text-faint transition-colors hover:bg-[rgba(255,255,255,0.06)] hover:text-ink"
          >
            <X size={12} strokeWidth={1.5} aria-hidden />
          </button>
        </div>
      ) : null}

      <div className="w-full min-w-0 overflow-x-auto">
        <AvailabilityEditor
          data={data}
          onSave={onSave}
          onAddException={onAddException}
          onRemoveException={onRemoveException}
        />
      </div>
    </div>
  );
}
