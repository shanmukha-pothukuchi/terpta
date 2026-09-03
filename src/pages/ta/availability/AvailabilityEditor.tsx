import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { Check, LoaderCircle } from "lucide-react";
import { Button, StatusBadge, useToast } from "../../../components/ui";
import { formatDate, formatHourCount, termName } from "../../../lib/format";
import { AvailabilityGrid } from "./AvailabilityGrid";
import { DateExceptions } from "./DateExceptions";
import {
  blocksToGrid,
  buildLockedGrid,
  countHours,
  emptyGrid,
  gridToBlocks,
  type AvailabilityData,
  type Grid,
  type ManualBlock,
  type SlotState,
} from "./model";

const AUTOSAVE_MS = 800;

type SaveState = "idle" | "pending" | "saving" | "error";

const BRUSHES: { state: SlotState; label: string; swatch: CSSProperties }[] = [
  {
    state: "available",
    label: "Available",
    swatch: {
      background: "rgba(61,214,140,0.35)",
      boxShadow: "inset 0 0 0 1px rgba(61,214,140,0.7)",
    },
  },
  {
    state: "prefer_not",
    label: "Prefer not",
    swatch: {
      background: "rgba(245,165,36,0.35)",
      boxShadow: "inset 0 0 0 1px rgba(245,165,36,0.7)",
    },
  },
  {
    state: "unavailable",
    label: "Unavailable",
    swatch: {
      background:
        "repeating-linear-gradient(135deg,rgba(255,255,255,0.35) 0 1px,transparent 1px 3px)",
      boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.35)",
    },
  },
];

const classSwatch: CSSProperties = {
  background: "rgba(125,147,178,0.35)",
  boxShadow: "inset 0 0 0 1px rgba(125,147,178,0.8)",
};

function Swatch({ style }: { style: CSSProperties }) {
  return <span className="h-[9px] w-[9px] flex-none rounded-[3px]" style={style} />;
}

function SaveIndicator({
  state,
  onRetry,
}: {
  state: SaveState;
  onRetry: () => void;
}) {
  if (state === "pending" || state === "saving") {
    return (
      <div className="flex items-center gap-[6px] text-[12px] text-muted">
        <LoaderCircle size={13} strokeWidth={1.5} className="animate-spin" />
        Saving…
      </div>
    );
  }
  if (state === "error") {
    return (
      <button
        type="button"
        onClick={onRetry}
        className="flex items-center gap-[6px] text-[12px] text-[#F4A3AE] hover:text-[#FBC2CA]"
      >
        Save failed · Retry
      </button>
    );
  }
  return (
    <div className="flex items-center gap-[6px] text-[12px] text-faint">
      <Check size={13} strokeWidth={1.5} className="text-ok" />
      Saved
    </div>
  );
}

export interface AvailabilityEditorProps {
  data: AvailabilityData;
  /** Replace all manual blocks (atomic); submitted stamps availabilitySubmittedAt. */
  onSave?: (blocks: ManualBlock[], submitted: boolean) => Promise<void>;
  onAddException?: (x: {
    startDate: string;
    endDate: string;
    reason: string;
  }) => Promise<void>;
  onRemoveException?: (id: string) => Promise<void>;
  /**
   * Drop the editor's own title and meta line. The onboarding wizard supplies
   * its own header, and two stacked titles read as a mistake.
   */
  hideHeader?: boolean;
}

/**
 * The full TA Availability screen (desktop + phone, breakpoint-driven).
 * Pure props in / callbacks out, so a DEV preview harness can render it
 * with `availabilityFixture` and no backend.
 */
export function AvailabilityEditor({
  data,
  onSave,
  onAddException,
  onRemoveException,
  hideHeader,
}: AvailabilityEditorProps) {
  const toast = useToast();

  // Local grid is authoritative after mount (optimistic edits; saves replace
  // all manual blocks atomically, so the server echoes what we sent).
  const [grid, setGridState] = useState<Grid>(() => blocksToGrid(data.manualBlocks));
  const gridRef = useRef(grid);
  const setGrid = (g: Grid) => {
    gridRef.current = g;
    setGridState(g);
  };

  const locked = useMemo(
    () => buildLockedGrid(data.importedBlocks),
    [data.importedBlocks],
  );
  const lockedRef = useRef(locked);
  lockedRef.current = locked;

  const [brush, setBrush] = useState<SlotState>("available");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [submitting, setSubmitting] = useState(false);
  const [localSubmitted, setLocalSubmitted] = useState(false);
  const [editedSinceSubmit, setEditedSinceSubmit] = useState(false);

  const submitted = data.submittedAt != null || localSubmitted;
  const status: "unsubmitted" | "submitted" | "edited" = !submitted
    ? "unsubmitted"
    : editedSinceSubmit
      ? "edited"
      : "submitted";

  const saveSeq = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const doSave = useCallback(
    async (submit: boolean): Promise<boolean> => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      if (!onSave) {
        setSaveState("idle");
        return true;
      }
      const seq = ++saveSeq.current;
      setSaveState("saving");
      try {
        await onSave(gridToBlocks(gridRef.current, lockedRef.current), submit);
        if (seq === saveSeq.current) setSaveState("idle");
        return true;
      } catch (err) {
        if (seq === saveSeq.current) setSaveState("error");
        toast(err instanceof Error ? err.message : "Couldn't save availability", {
          tone: "error",
        });
        return false;
      }
    },
    [onSave, toast],
  );

  const scheduleSave = useCallback(() => {
    setSaveState("pending");
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      void doSave(false);
    }, AUTOSAVE_MS);
  }, [doSave]);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  const markEdited = useCallback(() => {
    if (submitted) setEditedSinceSubmit(true);
  }, [submitted]);

  const handlePaint = useCallback(
    (d: number, s: number) => {
      if (lockedRef.current[d]?.[s]) return;
      const cur = gridRef.current;
      if (!cur[d] || cur[d][s] === undefined || cur[d][s] === brush) return;
      const next = cur.map((col) => col.slice());
      next[d][s] = brush;
      setGrid(next);
      markEdited();
      scheduleSave();
    },
    [brush, markEdited, scheduleSave],
  );

  const handleClearWeek = () => {
    setGrid(emptyGrid());
    markEdited();
    scheduleSave();
  };

  const handleSubmit = async () => {
    if (status === "submitted" || submitting) return;
    setSubmitting(true);
    const ok = await doSave(true);
    if (ok) {
      setLocalSubmitted(true);
      setEditedSinceSubmit(false);
      toast(
        data.deadline
          ? `Availability submitted · you can edit until ${formatDate(data.deadline)}`
          : "Availability submitted",
        { tone: "success" },
      );
    }
    setSubmitting(false);
  };

  const { available, preferNot, availableByDay } = countHours(grid, locked);

  const submitLabel =
    status === "edited"
      ? "Resubmit"
      : status === "submitted"
        ? "Submitted"
        : "Submit availability";

  const retry = () => void doSave(false);

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-end gap-3 sm:items-center sm:gap-[14px]">
        <div className={"flex flex-col gap-[3px]" + (hideHeader ? " sr-only" : "")}>
          <h1 className="text-[24px] font-semibold leading-[1.15] tracking-[-0.02em] sm:text-[20px] sm:leading-[1.2]">
            Availability
          </h1>
          <div className="text-[12.5px] text-muted">
            {data.term && <span className="hidden sm:inline">{termName(data.term)} · </span>}
            {data.deadline && (
              <>
                due{" "}
                <span className="font-mono text-[#C9C9CF]">
                  {formatDate(data.deadline)}
                </span>{" "}
                ·{" "}
              </>
            )}
            {formatHourCount(available)} available
            <span className="hidden sm:inline">
              {" "}
              · {formatHourCount(preferNot)} prefer not
            </span>
          </div>
        </div>
        <div className="flex-1" />
        <div className="hidden items-center gap-3 sm:flex">
          <SaveIndicator state={saveState} onRetry={retry} />
          <StatusBadge submitted={status === "submitted"} />
          <Button
            variant="primary"
            loading={submitting}
            disabled={status === "submitted"}
            onClick={() => void handleSubmit()}
          >
            {submitLabel}
          </Button>
        </div>
        <div className="sm:hidden">
          <StatusBadge submitted={status === "submitted"} />
        </div>
      </div>

      {/* Brush picker + legend + actions */}
      <div className="flex flex-wrap items-center gap-[10px]">
        <div className="grid w-full grid-cols-3 gap-[2px] rounded-[10px] border border-line bg-white/[0.04] p-[3px] sm:flex sm:w-auto sm:items-center sm:rounded-[9px] sm:bg-white/[0.03]">
          {BRUSHES.map((b) => (
            <button
              key={b.state}
              type="button"
              onClick={() => setBrush(b.state)}
              className={`flex h-8 items-center justify-center gap-[6px] rounded-lg text-[12px] transition-colors sm:h-[26px] sm:justify-start sm:gap-[7px] sm:rounded-[7px] sm:px-[10px] sm:text-[12.5px] ${
                brush === b.state
                  ? "bg-white/[0.08] text-[#F4F4F5]"
                  : "text-muted hover:text-ink"
              }`}
            >
              <Swatch style={b.swatch} />
              {b.label}
            </button>
          ))}
        </div>
        <div className="ml-[6px] hidden items-center gap-[7px] text-[12px] text-muted sm:flex">
          <Swatch style={classSwatch} />
          Imported class · locked
        </div>
        <div className="ml-1 hidden text-[12px] text-faint sm:block">
          Click and drag to paint
        </div>
        <div className="hidden flex-1 sm:block" />
        <button
          type="button"
          onClick={handleClearWeek}
          className="hidden h-[30px] items-center rounded-[9px] border border-line bg-white/[0.04] px-[10px] text-[12.5px] transition-colors hover:bg-white/[0.08] sm:flex"
        >
          Clear week
        </button>
      </div>

      {/* The grid */}
      <AvailabilityGrid
        grid={grid}
        locked={locked}
        importedBlocks={data.importedBlocks}
        availableByDay={availableByDay}
        onPaint={handlePaint}
      />

      {/* Phone legend */}
      <div className="flex items-center gap-2 text-[11.5px] text-muted sm:hidden">
        <Swatch style={classSwatch} />
        Imported class · locked
        <div className="flex-1" />
        <span className="text-faint">Drag to paint</span>
      </div>

      {/* Date exceptions */}
      <DateExceptions
        exceptions={data.dateExceptions}
        onAdd={onAddException}
        onRemove={onRemoveException}
      />

      {/* Phone: pinned submit bar */}
      <div className="sticky bottom-0 flex items-center gap-[10px] pb-4 pt-3 [background:linear-gradient(180deg,rgba(11,11,14,0),#0B0B0E_30%)] sm:hidden">
        <SaveIndicator state={saveState} onRetry={retry} />
        <div className="flex-1" />
        <button
          type="button"
          disabled={status === "submitted" || submitting}
          onClick={() => void handleSubmit()}
          className="flex h-11 items-center justify-center rounded-[12px] border border-white/10 bg-umd px-5 text-[14px] font-medium text-white transition-transform active:scale-[0.98] disabled:opacity-60"
        >
          {status === "edited"
            ? "Resubmit"
            : status === "submitted"
              ? "Submitted"
              : "Submit"}
        </button>
      </div>
    </div>
  );
}
