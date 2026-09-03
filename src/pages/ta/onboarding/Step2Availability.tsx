/**
 * Step 2 — Availability.
 *
 * Follows the Claude Design reference (design/terpta-onboarding-ref/
 * onboarding-spec.md §4) in structure and copy, but stays on this project's
 * dark tokens. Three things changed versus the old `Step3Availability`:
 *
 *  1. A real step header whose single sub-line carries **both** the deadline and
 *     the autosave receipt, replacing the dismissible first-visit hint card.
 *  2. The week readout is a two-number hour tally under the grid, not a
 *     percentage progress bar.
 *  3. Hand-typed class times live here now instead of on step 1.
 *
 * The grid, the three-state brush, the red `Submit availability` action and the
 * date exceptions are all still the shared <AvailabilityEditor
          hideHeader>; nothing is
 * reimplemented.
 */
import { useMemo, type CSSProperties } from "react";
import { AvailabilityEditor } from "../availability/AvailabilityEditor";
import type { AvailabilityEditorProps } from "../availability/AvailabilityEditor";
import {
  blocksToGrid,
  buildLockedGrid,
  countHours,
  type AvailabilityData,
} from "../availability/model";
import { formatDate } from "../../../lib/format";
import { ManualClassEntry } from "./ManualClassEntry";
import type { ClassesValue } from "./model";

export interface Step2AvailabilityProps {
  data: AvailabilityData;
  onSave: AvailabilityEditorProps["onSave"];
  onAddException: AvailabilityEditorProps["onAddException"];
  onRemoveException: AvailabilityEditorProps["onRemoveException"];
  /** Hand-typed class times, edited here now rather than on step 1. */
  classes: ClassesValue;
  onClassesChange: (next: ClassesValue) => void;
  savedAgoLabel?: string;
}

/** Striped, to read as "locked" rather than as a paintable state. */
const CLASS_SWATCH: CSSProperties = {
  background:
    "repeating-linear-gradient(135deg,rgba(125,147,178,0.72) 0 2px,rgba(125,147,178,0.14) 2px 5px)",
  boxShadow: "inset 0 0 0 1px rgba(125,147,178,0.55)",
};

/** "21.5 h" — the reference spaces the unit; formatHourCount() does not. */
function hoursLabel(hours: number): string {
  const n = Number.isInteger(hours) ? String(hours) : String(Math.round(hours * 10) / 10);
  return `${n} h`;
}

export function Step2Availability({
  data,
  onSave,
  onAddException,
  onRemoveException,
  classes,
  onClassesChange,
  savedAgoLabel,
}: Step2AvailabilityProps) {
  /* The editor keeps its own working copy of the grid, but it autosaves, so
     counting the saved blocks here stays in step with what the TA sees. */
  const { available, preferNot } = useMemo(
    () =>
      countHours(
        blocksToGrid(data.manualBlocks),
        buildLockedGrid(data.importedBlocks),
      ),
    [data.manualBlocks, data.importedBlocks],
  );

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <header className="flex min-w-0 flex-col gap-[3px]">
        <h2 className="text-[20px] leading-[1.2] font-semibold tracking-[-0.02em] text-ink">
          Weekly availability
        </h2>
        <p className="min-w-0 text-[13px] text-muted [text-wrap:pretty]">
          Click or drag to paint.
          {data.deadline ? (
            <>
              {" "}
              Due{" "}
              <span className="font-mono text-[#C9C9CF]">
                {formatDate(data.deadline)}
              </span>
            </>
          ) : null}
          {savedAgoLabel ? (
            <>
              {data.deadline ? " · " : " "}
              {savedAgoLabel}
            </>
          ) : null}
        </p>
      </header>

      {/* The editor renders its own <h1>Availability</h1> plus a term/deadline/
          hours meta line. Both are suppressed here so the step header above is
          the only title and the tally below the grid is the only readout — the
          save indicator, status badge and red Submit button all stay. */}
      <div className="w-full min-w-0 overflow-x-auto">
        <AvailabilityEditor
          data={data}
          onSave={onSave}
          onAddException={onAddException}
          onRemoveException={onRemoveException}
        />
      </div>

      {/* Two-number tally, not a percentage. */}
      <div className="flex min-w-0 flex-wrap items-center gap-x-[18px] gap-y-1.5 px-1 text-[12px] text-muted">
        <span className="flex min-w-0 items-center gap-2">
          <span
            aria-hidden
            className="size-3 shrink-0 rounded-[3px]"
            style={CLASS_SWATCH}
          />
          <span className="min-w-0 truncate">
            In class · imported from Testudo, locked
          </span>
        </span>
        <span aria-hidden className="hidden shrink-0 text-faint sm:inline">
          ·
        </span>
        <span className="shrink-0 whitespace-nowrap">
          <span className="font-mono text-ink">{hoursLabel(available)}</span>{" "}
          available ·{" "}
          <span className="font-mono text-ink">{hoursLabel(preferNot)}</span>{" "}
          prefer not
        </span>
      </div>

      <ManualClassEntry
        value={classes.manual}
        onChange={(manual) => onClassesChange({ ...classes, manual })}
      />
    </div>
  );
}
