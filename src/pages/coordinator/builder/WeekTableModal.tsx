import { useMemo, useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button, Modal, Select, toast } from "../../../components/ui";
import { weekLabel } from "../../../lib/week";
import type { WeekOverlay } from "./weekOverlay";
import type { BuilderModel, DutyType } from "./model";
import {
  hourSpan,
  scribbleTabular,
  tableRows,
  weekTableBlocks,
  type HourSpan,
} from "./weekTable";

export interface WeekTableModalProps {
  open: boolean;
  onClose: () => void;
  /** The whole board, not the filtered one: the kinds of work are picked here. */
  model: BuilderModel;
  week: WeekOverlay | null;
  weekStart: string;
  dutyTypes: DutyType[];
}

/** The clock the course page is plausibly posted over. */
const HOURS = Array.from({ length: 17 }, (_, i) => i + 7);

function hourOption(hour: number): string {
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12} ${hour < 12 ? "AM" : "PM"}`;
}

/**
 * The selected week as Scribble source, to paste into the course page.
 *
 * The calendar links next door answer "add this to my phone"; this answers
 * the other thing a coordinator does with a finished week, which is publish
 * it as a table on a page students read. It is deliberately a week and not
 * the template: the table that goes up should say who is actually coming.
 */
export function WeekTableModal({
  open,
  onClose,
  model,
  week,
  weekStart,
  dutyTypes,
}: WeekTableModalProps) {
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  // Null until the coordinator widens it: the measured span is the useful
  // default, and a course that posts a fixed 9–5 grid can say so.
  const [span, setSpan] = useState<HourSpan | null>(null);
  const [copied, setCopied] = useState(false);

  const carried = useMemo(
    () =>
      new Set(
        dutyTypes.map((d) => d._id as string).filter((id) => !excluded.has(id)),
      ),
    [dutyTypes, excluded],
  );

  const blocks = useMemo(
    () => weekTableBlocks(model, week, carried),
    [model, week, carried],
  );
  const measured = useMemo(() => hourSpan(blocks), [blocks]);
  const effective = span ?? measured;
  // The grid the hours were actually cut on, so the table cannot claim cover
  // on either side of a block that does not fill its row. Finest wins when
  // two window duty types disagree; an hour is the fallback and the default
  // for a course whose office hours land on the hour anyway.
  const measuredStep = useMemo(() => {
    const grids = dutyTypes
      .filter((d) => d.mode === "window" && !excluded.has(d._id as string))
      .map((d) => d.slotMinutes ?? 15);
    return grids.length > 0 ? Math.min(...grids) : 60;
  }, [dutyTypes, excluded]);
  const [step, setStep] = useState<number | null>(null);
  const effectiveStep = step ?? measuredStep;
  const source = useMemo(
    () => scribbleTabular(tableRows(blocks, effective, effectiveStep)),
    [blocks, effective, effectiveStep],
  );

  const staffed = blocks.filter((b) => b.names.length > 0).length;

  const toggle = (id: string) =>
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const setStart = (start: number) =>
    setSpan({ start, end: Math.max(effective.end, start + 1) });
  const setEnd = (end: number) =>
    setSpan({ start: Math.min(effective.start, end - 1), end });

  const copy = () => {
    navigator.clipboard
      .writeText(source)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() =>
        toast("Could not reach the clipboard — select the text instead", { tone: "error" }),
      );
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Copy ${weekLabel(weekStart)} as a table`}
      width={760}
      footer={
        <>
          <Button onClick={onClose}>Close</Button>
          <Button variant="primary" onClick={copy}>
            {copied ? (
              <Check size={13} strokeWidth={1.5} aria-hidden />
            ) : (
              <Copy size={13} strokeWidth={1.5} aria-hidden />
            )}
            {copied ? "Copied" : "Copy Scribble"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-[12.5px] leading-[1.5] text-muted">
          This week as a Scribble <code className="font-mono text-[11.5px]">@tabular</code>,
          ready to paste into the course page. It is the week, not the template:
          a TA who is away drops out and a recorded stand-in takes their place.
        </p>

        <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
          <div className="flex flex-col gap-1">
            <span className="text-[12px] text-muted">Hours</span>
            <div className="flex items-center gap-1.5">
              <Select
                value={effective.start}
                onChange={(e) => setStart(Number(e.target.value))}
                aria-label="First hour"
              >
                {HOURS.map((h) => (
                  <option key={h} value={h}>
                    {hourOption(h)}
                  </option>
                ))}
              </Select>
              <span className="text-[12px] text-faint">to</span>
              <Select
                value={effective.end}
                onChange={(e) => setEnd(Number(e.target.value))}
                aria-label="Last hour"
              >
                {HOURS.map((h) => (
                  <option key={h + 1} value={h + 1}>
                    {hourOption(h)}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[12px] text-muted">Rows</span>
            <div className="inline-flex h-8 items-center gap-0.5 rounded-[7px] border border-line bg-[rgba(255,255,255,0.03)] p-0.5">
              {[15, 30, 60].map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setStep(m)}
                  aria-pressed={effectiveStep === m}
                  className={
                    "h-full cursor-pointer rounded-[5px] px-2 text-[11.5px] transition-colors duration-100 " +
                    (effectiveStep === m
                      ? "bg-[rgba(255,255,255,0.09)] font-medium text-ink shadow-[inset_0_0_0_1px_rgba(255,255,255,0.10)]"
                      : "text-muted hover:text-ink")
                  }
                >
                  {m === 60 ? "1h" : `${m}m`}
                </button>
              ))}
            </div>
          </div>
          {span || step ? (
            <button
              type="button"
              onClick={() => {
                setSpan(null);
                setStep(null);
              }}
              className="h-8 text-[11.5px] text-faint transition-colors hover:text-ink"
            >
              Fit to the week
            </button>
          ) : null}
        </div>

        {dutyTypes.length > 1 ? (
          <div className="flex flex-col gap-1.5">
            <span className="text-[12px] text-muted">Carries</span>
            <div className="flex flex-wrap gap-x-4 gap-y-1.5">
              {dutyTypes.map((d) => (
                <label
                  key={d._id}
                  className="flex cursor-pointer items-center gap-2 text-[12.5px] text-muted hover:text-ink"
                >
                  <input
                    type="checkbox"
                    checked={carried.has(d._id as string)}
                    onChange={() => toggle(d._id as string)}
                    className="size-[13px] accent-[#E21833]"
                  />
                  <span
                    className="size-[8px] shrink-0 rounded-[2.5px]"
                    style={{ background: d.color }}
                    aria-hidden
                  />
                  <span className="min-w-0 truncate">{d.name}</span>
                </label>
              ))}
            </div>
          </div>
        ) : null}

        <pre className="max-h-[46vh] overflow-auto rounded-[9px] border border-line bg-page px-3 py-2.5 font-mono text-[11px] leading-[1.6] text-ink">
          {source}
        </pre>

        <p className="text-[11.5px] leading-[1.45] text-faint">
          {staffed === 0
            ? "No staffed hours in this week for the kinds of work above, so every row is empty."
            : "An hour nobody is on becomes 'cont, so the time label spans the row. A shift on the board with nobody assigned comes out blank rather than guessed at."}
        </p>
      </div>
    </Modal>
  );
}
