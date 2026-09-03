/* Manual class times — the fallback when umd.io is unreachable (or the course
   simply is not in the schedule of classes). Writes bare meetings into
   value.manual; lockedMeetings() folds them into the grid alongside imports. */
import { useEffect, useId, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button, Input, Label, Select } from "../../../components/ui";
import { DAY_CODES, DAY_SHORT, formatMeeting, formatTime, type DayCode } from "../../../lib/format";
import { GRID_END_MIN, GRID_START_MIN, SLOT_MIN } from "../availability/model";
import type { ManualClass } from "./model";

/** 8:00a … 8:00p in 30-minute steps, matching the availability grid. */
const TIME_OPTIONS: number[] = Array.from(
  { length: (GRID_END_MIN - GRID_START_MIN) / SLOT_MIN + 1 },
  (_, i) => GRID_START_MIN + i * SLOT_MIN,
);

const DEFAULT_START = 10 * 60;
const DEFAULT_END = 11 * 60;

export interface ManualClassEntryProps {
  value: ManualClass[];
  onChange: (next: ManualClass[]) => void;
  /** Flips the form open — set when an import fails. */
  forceOpen?: boolean;
}

export function ManualClassEntry({ value, onChange, forceOpen }: ManualClassEntryProps) {
  const [expanded, setExpanded] = useState(Boolean(forceOpen));
  const [label, setLabel] = useState("");
  const [day, setDay] = useState<DayCode>("M");
  const [startMin, setStartMin] = useState(DEFAULT_START);
  const [endMin, setEndMin] = useState(DEFAULT_END);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (forceOpen) setExpanded(true);
  }, [forceOpen]);

  const ids = useId();
  const labelId = `${ids}-label`;
  const dayId = `${ids}-day`;
  const startId = `${ids}-start`;
  const endId = `${ids}-end`;
  const errorId = `${ids}-error`;

  function add() {
    if (endMin <= startMin) {
      setError("End time must be after the start time.");
      return;
    }
    setError(null);
    onChange([
      ...value,
      {
        key: crypto.randomUUID(),
        label: label.trim(),
        day,
        startMin,
        endMin,
      },
    ]);
    setLabel("");
  }

  function remove(key: string) {
    onChange(value.filter((m) => m.key !== key));
  }

  return (
    <div className="flex flex-col gap-2">
      {value.length > 0 ? (
        <div className="overflow-hidden rounded-[10px] border border-line bg-surface">
          <div className="flex h-8 items-center gap-2 border-b border-[rgba(255,255,255,0.04)] bg-[rgba(255,255,255,0.02)] px-3">
            <span className="text-[11px] font-medium uppercase tracking-[0.06em] text-faint">
              Added by hand
            </span>
            <span className="font-mono text-[11px] text-faint">{value.length}</span>
          </div>
          {value.map((m) => (
            <div
              key={m.key}
              className="flex h-9 items-center gap-3 border-b border-[rgba(255,255,255,0.04)] px-3 text-[12.5px] last:border-b-0 hover:bg-[rgba(255,255,255,0.02)]"
            >
              <span className="min-w-0 flex-1 truncate">
                {m.label || <span className="text-faint">Class</span>}
              </span>
              <span className="shrink-0 font-mono text-[11.5px] text-muted">
                {formatMeeting(m.day, m.startMin, m.endMin)}
              </span>
              <button
                type="button"
                onClick={() => remove(m.key)}
                aria-label={`Remove ${m.label || "class"}`}
                className="grid size-6 shrink-0 cursor-pointer place-items-center rounded-[6px] text-faint hover:bg-[rgba(255,255,255,0.06)] hover:text-ink"
              >
                <Trash2 size={14} strokeWidth={1.5} aria-hidden />
              </button>
            </div>
          ))}
        </div>
      ) : null}

      {expanded ? (
        <div className="rounded-[10px] border border-line bg-surface p-3">
          <div className="grid gap-2.5 sm:grid-cols-[minmax(0,1fr)_84px_96px_96px_auto] sm:items-end">
            <div className="min-w-0">
              <Label htmlFor={labelId}>Class</Label>
              <Input
                id={labelId}
                value={label}
                placeholder="e.g. CMSC216 lecture"
                onChange={(e) => setLabel(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    add();
                  }
                }}
              />
            </div>
            <div>
              <Label htmlFor={dayId}>Day</Label>
              <Select id={dayId} value={day} onChange={(e) => setDay(e.target.value as DayCode)}>
                {DAY_CODES.map((d) => (
                  <option key={d} value={d}>
                    {DAY_SHORT[d]}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor={startId}>Start</Label>
              <Select
                id={startId}
                className="font-mono"
                value={startMin}
                onChange={(e) => {
                  setStartMin(Number(e.target.value));
                  setError(null);
                }}
              >
                {TIME_OPTIONS.map((t) => (
                  <option key={t} value={t}>
                    {formatTime(t)}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor={endId}>End</Label>
              <Select
                id={endId}
                className="font-mono"
                value={endMin}
                aria-invalid={endMin <= startMin}
                aria-describedby={error ? errorId : undefined}
                onChange={(e) => {
                  setEndMin(Number(e.target.value));
                  setError(null);
                }}
              >
                {TIME_OPTIONS.map((t) => (
                  <option key={t} value={t}>
                    {formatTime(t)}
                  </option>
                ))}
              </Select>
            </div>
            <Button variant="secondary" onClick={add}>
              <Plus size={14} strokeWidth={1.5} aria-hidden />
              Add
            </Button>
          </div>
          {error ? (
            <p id={errorId} role="alert" className="mt-2 text-[12px] text-[#F4A3AE]">
              {error}
            </p>
          ) : null}
        </div>
      ) : (
        <Button variant="ghost" size="sm" className="self-start" onClick={() => setExpanded(true)}>
          <Plus size={14} strokeWidth={1.5} aria-hidden />
          Add a class time manually
        </Button>
      )}
    </div>
  );
}
