import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { Plus, Settings2, Tags, Trash2 } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import {
  Button,
  EmptyState,
  IconButton,
  Input,
  Modal,
  PageHeader,
  Spinner,
  Surface,
  toast,
  Tooltip,
} from "../../components/ui";
import { usePeriod } from "../../lib/period";
import { errorMessage } from "../../lib/errorMessage";

export type DutyTypeRow = FunctionReturnType<typeof api.dutyTypes.list>[number];

export interface DutyTypeFields {
  name: string;
  mode: "sync" | "async" | "window";
  color: string;
  defaultHoursCredit: number;
  /** "window" only: office hours each TA must hold per week. */
  hoursPerTa?: number;
  /** Sync only: most shifts of this kind the solver gives one TA. 0 = no cap. */
  maxPerTa?: number;
  /** "window" only: shortest office-hour block the solver may cut, in minutes. */
  minBlockMinutes?: number;
  /** "window" only: duty types whose times office hours must stay clear of. */
  noOverlapDutyRefs?: Id<"dutyTypes">[];
  /** "window" only: also stay clear of the lecture meetings of the course. */
  noOverlapLectures?: boolean;
}

/** Office hours default to hour-long blocks. */
const DEFAULT_MIN_BLOCK = 60;

const MODE_LABEL: Record<DutyTypeFields["mode"], string> = {
  sync: "Sync",
  async: "Async",
  window: "Office hours",
};

/** Board-adjacent picker palette (UMD red first, then distinct hues). */
export const DUTY_COLORS = [
  "#E21833",
  "#2F6FED",
  "#7C3AED",
  "#0D9488",
  "#F5A524",
  "#3DD68C",
  "#7D93B2",
  "#D946EF",
];

const ROW_GRID = "grid grid-cols-[minmax(0,1fr)_216px_72px_132px_112px_40px] items-center gap-3 px-3.5";

/* ------------------------------------------------------------------ */
/* Small controls                                                      */
/* ------------------------------------------------------------------ */

function ModeToggle({
  value,
  onChange,
  lockedReason,
}: {
  value: "sync" | "async" | "window";
  onChange: (v: "sync" | "async" | "window") => void;
  /** When set, the toggle is read-only and explains why on hover. */
  lockedReason?: string;
}) {
  const toggle = (
    <div
      className={
        "inline-flex h-6 w-fit shrink-0 items-center gap-0.5 justify-self-start rounded-[7px] border border-line bg-[rgba(255,255,255,0.03)] p-0.5 " +
        (lockedReason ? "opacity-60" : "")
      }
    >
      {(["sync", "async", "window"] as const).map((m) => (
        <button
          key={m}
          type="button"
          onClick={() => onChange(m)}
          aria-pressed={value === m}
          disabled={lockedReason !== undefined && value !== m}
          className={
            "h-full whitespace-nowrap rounded-[5px] px-2 text-[11.5px] transition-colors duration-100 " +
            (lockedReason ? "cursor-not-allowed " : "cursor-pointer ") +
            (value === m
              ? "bg-[rgba(255,255,255,0.09)] font-medium text-ink shadow-[inset_0_0_0_1px_rgba(255,255,255,0.10)]"
              : lockedReason
                ? "text-faint"
                : "text-muted hover:text-ink")
          }
        >
          {MODE_LABEL[m]}
        </button>
      ))}
    </div>
  );
  return lockedReason ? (
    <Tooltip label={lockedReason} className="w-fit justify-self-start">
      {toggle}
    </Tooltip>
  ) : (
    toggle
  );
}

function ColorSwatchPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        aria-label="Pick color"
        onClick={() => setOpen((o) => !o)}
        className="block size-[18px] cursor-pointer rounded-[5px] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.20)]"
        style={{ background: value }}
      />
      {open ? (
        <>
          <button
            type="button"
            aria-label="Close color picker"
            className="fixed inset-0 z-10 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div className="absolute left-0 top-full z-20 mt-1.5 flex gap-1.5 rounded-[9px] border border-line-strong bg-popover p-2 shadow-[0_12px_40px_rgba(0,0,0,0.5)]">
            {DUTY_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={c}
                onClick={() => {
                  onChange(c);
                  setOpen(false);
                }}
                className={
                  "size-[18px] cursor-pointer rounded-[5px] transition-transform duration-100 hover:scale-110 " +
                  (c.toLowerCase() === value.toLowerCase()
                    ? "shadow-[inset_0_0_0_1px_rgba(255,255,255,0.9),0_0_0_2px_rgba(255,255,255,0.25)]"
                    : "shadow-[inset_0_0_0_1px_rgba(255,255,255,0.20)]")
                }
                style={{ background: c }}
              />
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Rows                                                                */
/* ------------------------------------------------------------------ */

/**
 * Everything a window duty type needs that will not fit on one row.
 *
 * Office hours are the only duty with rules about *where* the solver may cut
 * them, and cramming two more controls into the table is what made the mode
 * pills and the "h/TA" suffix wrap in the first place.
 */
function WindowRulesPopover({
  dt,
  siblings,
  onUpdate,
}: {
  dt: DutyTypeRow;
  /** Other duty types in the period, for the "keep clear of" list. */
  siblings: DutyTypeRow[];
  onUpdate: (patch: Partial<DutyTypeFields>) => void;
}) {
  const [open, setOpen] = useState(false);
  const minBlock = dt.minBlockMinutes ?? DEFAULT_MIN_BLOCK;
  const [minText, setMinText] = useState(String(minBlock / 60));
  useEffect(
    () => setMinText(String((dt.minBlockMinutes ?? DEFAULT_MIN_BLOCK) / 60)),
    [dt.minBlockMinutes],
  );

  const avoiding = new Set((dt.noOverlapDutyRefs ?? []).map((id) => id as string));
  const avoidCount = avoiding.size + (dt.noOverlapLectures ? 1 : 0);

  const commitMin = () => {
    const hours = Number(minText);
    if (!Number.isFinite(hours) || hours < 0.5) {
      setMinText(String(minBlock / 60));
      return;
    }
    // Blocks are cut on a half-hour grid, so anything between lands on one.
    const minutes = Math.max(30, Math.round((hours * 60) / 30) * 30);
    if (minutes !== minBlock) onUpdate({ minBlockMinutes: minutes });
  };

  const toggleDuty = (id: Id<"dutyTypes">) => {
    const next = new Set(avoiding);
    if (next.has(id as string)) next.delete(id as string);
    else next.add(id as string);
    onUpdate({
      noOverlapDutyRefs: siblings
        .filter((d) => next.has(d._id as string))
        .map((d) => d._id),
    });
  };

  return (
    <div className="relative justify-self-start">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={`Office-hour rules for ${dt.name}`}
        className="flex h-7 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-[7px] border border-line px-2 text-[12px] text-muted transition-colors hover:bg-[rgba(255,255,255,0.05)] hover:text-ink"
      >
        <Settings2 size={13} strokeWidth={1.5} aria-hidden />
        {minBlock % 60 === 0 ? `${minBlock / 60}h` : `${minBlock}m`} min
        {avoidCount > 0 ? <span className="text-faint">· {avoidCount}</span> : null}
      </button>
      {open ? (
        <>
          <button
            type="button"
            aria-label="Close office-hour rules"
            className="fixed inset-0 z-10 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div className="absolute right-0 top-full z-20 mt-1.5 flex w-[268px] flex-col gap-3 rounded-[11px] border border-line-strong bg-popover p-3 shadow-[0_12px_40px_rgba(0,0,0,0.5)]">
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2">
                <span className="flex-1 text-[12.5px] text-ink">Shortest block</span>
                <Input
                  value={minText}
                  onChange={(e) => setMinText(e.target.value)}
                  onBlur={commitMin}
                  onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                  type="number"
                  min={0.5}
                  step={0.5}
                  aria-label="Shortest office-hour block"
                  className="h-7 w-16 text-right font-mono"
                />
                <span className="text-[12px] text-faint">h</span>
              </div>
              <p className="text-[11.5px] leading-[1.45] text-faint">
                No TA is given a block shorter than this. Time left over after
                the last full block is reported, not shoehorned in.
              </p>
            </div>
            <div className="flex flex-col gap-1.5 border-t border-line pt-2.5">
              <span className="text-[12.5px] text-ink">Keep clear of</span>
              <label className="flex cursor-pointer items-center gap-2 text-[12.5px] text-muted hover:text-ink">
                <input
                  type="checkbox"
                  checked={dt.noOverlapLectures ?? false}
                  onChange={(e) => onUpdate({ noOverlapLectures: e.target.checked })}
                  className="size-[13px] accent-[#E21833]"
                />
                Lectures
              </label>
              {siblings.map((d) => (
                <label
                  key={d._id}
                  className="flex cursor-pointer items-center gap-2 text-[12.5px] text-muted hover:text-ink"
                >
                  <input
                    type="checkbox"
                    checked={avoiding.has(d._id as string)}
                    onChange={() => toggleDuty(d._id)}
                    className="size-[13px] accent-[#E21833]"
                  />
                  <span className="min-w-0 truncate">{d.name}</span>
                </label>
              ))}
              {siblings.length === 0 ? (
                <span className="text-[11.5px] text-faint">No other duty types yet.</span>
              ) : null}
              <p className="text-[11.5px] leading-[1.45] text-faint">
                Ruled out for everyone, not only the TA on that shift — nobody
                comes to office hours held during the lecture.
              </p>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

function EditableRow({
  dt,
  siblings,
  onUpdate,
  onDelete,
}: {
  dt: DutyTypeRow;
  siblings: DutyTypeRow[];
  onUpdate: (patch: Partial<DutyTypeFields>) => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(dt.name);
  const [credit, setCredit] = useState(String(dt.defaultHoursCredit));
  const [perTa, setPerTa] = useState(String(dt.hoursPerTa ?? 2));
  const [cap, setCap] = useState(dt.maxPerTa === undefined ? "" : String(dt.maxPerTa));
  useEffect(() => setCap(dt.maxPerTa === undefined ? "" : String(dt.maxPerTa)), [dt.maxPerTa]);
  useEffect(() => setName(dt.name), [dt.name]);
  useEffect(() => setCredit(String(dt.defaultHoursCredit)), [dt.defaultHoursCredit]);
  useEffect(() => setPerTa(String(dt.hoursPerTa ?? 2)), [dt.hoursPerTa]);
  const isWindow = dt.mode === "window";

  const commitName = () => {
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      setName(dt.name);
      return;
    }
    if (trimmed !== dt.name) onUpdate({ name: trimmed });
  };
  const commitCredit = () => {
    const n = Number(credit);
    if (!Number.isFinite(n) || n < 0) {
      setCredit(String(dt.defaultHoursCredit));
      return;
    }
    if (n !== dt.defaultHoursCredit) onUpdate({ defaultHoursCredit: n });
  };
  const commitPerTa = () => {
    const n = Number(perTa);
    if (!Number.isFinite(n) || n < 0) {
      setPerTa(String(dt.hoursPerTa ?? 2));
      return;
    }
    if (n !== (dt.hoursPerTa ?? 2)) onUpdate({ hoursPerTa: n });
  };
  const commitCap = () => {
    const n = cap.trim() === "" ? 0 : Math.round(Number(cap));
    if (!Number.isFinite(n) || n < 0) {
      setCap(dt.maxPerTa === undefined ? "" : String(dt.maxPerTa));
      return;
    }
    if (n !== (dt.maxPerTa ?? 0)) onUpdate({ maxPerTa: n });
  };

  return (
    <div className={`${ROW_GRID} h-11 border-b border-[rgba(255,255,255,0.04)] last:border-b-0 hover:bg-[rgba(255,255,255,0.02)]`}>
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={commitName}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        aria-label="Duty type name"
        className="h-7 max-w-64 px-2"
      />
      <ModeToggle
        value={dt.mode}
        onChange={(mode) => mode !== dt.mode && onUpdate({ mode })}
        lockedReason={
          dt.shiftCount > 0
            ? `Locked: ${dt.shiftCount} shift${dt.shiftCount === 1 ? "" : "s"} already use this duty type. Delete them to change its mode.`
            : undefined
        }
      />
      <ColorSwatchPicker value={dt.color} onChange={(color) => onUpdate({ color })} />
      {/* A window has no credit to award: the hours are real. The one number
          it needs is how many each TA owes per week. */}
      <div className="flex items-center gap-1.5">
        <Input
          value={isWindow ? perTa : credit}
          onChange={(e) => (isWindow ? setPerTa : setCredit)(e.target.value)}
          onBlur={isWindow ? commitPerTa : commitCredit}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          type="number"
          min={0}
          step={0.5}
          aria-label={isWindow ? "Office hours per TA per week" : "Default hours credit"}
          className="h-7 w-16 text-right font-mono"
        />
        <span className="whitespace-nowrap text-[12px] text-faint">{isWindow ? "h/TA" : "h"}</span>
      </div>
      {/* "One discussion per TA": the solver stops at the cap; a coordinator
          dropping someone in by hand is not stopped. Blank means no cap. */}
      {dt.mode === "sync" ? (
        <Input
          value={cap}
          onChange={(e) => setCap(e.target.value)}
          onBlur={commitCap}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          type="number"
          min={0}
          step={1}
          placeholder="none"
          aria-label={`Most ${dt.name} shifts per TA`}
          className="h-7 w-20 text-right font-mono"
        />
      ) : isWindow ? (
        <WindowRulesPopover dt={dt} siblings={siblings} onUpdate={onUpdate} />
      ) : (
        <span className="text-[12px] text-faint">—</span>
      )}
      <IconButton
        variant="danger"
        onClick={onDelete}
        aria-label={`Delete ${dt.name}`}
        className="justify-self-end"
      >
        <Trash2 size={16} strokeWidth={1.5} aria-hidden />
      </IconButton>
    </div>
  );
}

function DraftRow({
  onSave,
  onCancel,
}: {
  onSave: (fields: DutyTypeFields) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [mode, setMode] = useState<"sync" | "async" | "window">("sync");
  const [color, setColor] = useState(DUTY_COLORS[1]);
  const [credit, setCredit] = useState("1");

  const save = () => {
    const n = Number(credit);
    const safe = Number.isFinite(n) && n >= 0 ? n : 1;
    onSave({
      name: name.trim(),
      mode,
      color,
      defaultHoursCredit: mode === "window" ? 0 : safe,
      ...(mode === "window" ? { hoursPerTa: safe } : {}),
    });
  };

  return (
    <div className={`${ROW_GRID} h-12 border-b border-[rgba(255,255,255,0.04)] bg-[rgba(255,255,255,0.02)] last:border-b-0`}>
      <div className="flex items-center gap-2">
        <Input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && name.trim() && save()}
          placeholder="e.g. Office Hours"
          aria-label="New duty type name"
          className="h-7 max-w-56"
        />
        {/* Ghost buttons have no visible box, so their 10px padding reads as
            extra gap: 8px of flex gap became a 28px hole between "Add" and
            "Cancel". Tighten both for the pair to look evenly spaced. */}
        <div className="flex items-center gap-1">
          <Button variant="primary" size="sm" onClick={save} disabled={name.trim().length === 0}>
            Add
          </Button>
          <Button variant="ghost" size="sm" onClick={onCancel} className="px-2">
            Cancel
          </Button>
        </div>
      </div>
      <ModeToggle value={mode} onChange={setMode} />
      <ColorSwatchPicker value={color} onChange={setColor} />
      <div className="flex items-center gap-1.5">
        <Input
          value={credit}
          onChange={(e) => setCredit(e.target.value)}
          type="number"
          min={0}
          step={0.5}
          aria-label={mode === "window" ? "Office hours per TA per week" : "Default hours credit"}
          className="h-7 w-16 text-right font-mono"
        />
        <span className="whitespace-nowrap text-[12px] text-faint">{mode === "window" ? "h/TA" : "h"}</span>
      </div>
      <span className="text-[12px] text-faint">
        {mode === "async" ? "—" : "set after adding"}
      </span>
      <div />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Pure view                                                           */
/* ------------------------------------------------------------------ */

export interface DutyTypesViewProps {
  periodSelected: boolean;
  /** undefined = loading */
  dutyTypes: DutyTypeRow[] | undefined;
  onCreate: (fields: DutyTypeFields) => void;
  onUpdate: (id: Id<"dutyTypes">, patch: Partial<DutyTypeFields>) => void;
  onRemove: (id: Id<"dutyTypes">) => void;
}

export function DutyTypesView({
  periodSelected,
  dutyTypes,
  onCreate,
  onUpdate,
  onRemove,
}: DutyTypesViewProps) {
  const [adding, setAdding] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<DutyTypeRow | null>(null);

  if (!periodSelected) {
    return (
      <div>
        <PageHeader
          title="Duty types"
          description="The kinds of work in this period — discussions, office hours, grading — with colors and default hour credits."
        />
        <EmptyState
          icon={Tags}
          title="No staffing period selected"
          hint="Create a staffing period first; duty types belong to a period."
        />
      </div>
    );
  }

  const syncCount = dutyTypes?.filter((d) => d.mode === "sync").length ?? 0;
  const asyncCount = dutyTypes?.filter((d) => d.mode === "async").length ?? 0;

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Duty types"
        description="The kinds of work in this period — discussions, office hours, grading — with colors and default hour credits."
        actions={
          <Button onClick={() => setAdding(true)} disabled={adding || dutyTypes === undefined}>
            <Plus size={14} strokeWidth={1.5} aria-hidden />
            Add duty type
          </Button>
        }
      />
      {dutyTypes === undefined ? (
        <Spinner label="Loading duty types…" />
      ) : dutyTypes.length === 0 && !adding ? (
        <EmptyState
          icon={Tags}
          title="No duty types yet"
          hint="Add sync duty types (discussion, office hours) and async ones (grading)."
        >
          <Button onClick={() => setAdding(true)}>
            <Plus size={14} strokeWidth={1.5} aria-hidden />
            Add duty type
          </Button>
        </EmptyState>
      ) : (
        <Surface className="overflow-hidden">
          <div className="flex h-10 items-center gap-2.5 border-b border-line px-3.5">
            <span className="text-[13px] font-medium text-ink">Duty types</span>
            <span className="text-[12px] text-faint">
              {syncCount} sync · {asyncCount} async
            </span>
          </div>
          <div
            className={`${ROW_GRID} h-8 border-b border-line text-[11px] font-medium uppercase tracking-[0.06em] text-faint`}
          >
            <span>Name</span>
            <span>Mode</span>
            <span>Color</span>
            <span>Default credit</span>
            <span>Limits</span>
            <span />
          </div>
          {dutyTypes.map((dt) => (
            <EditableRow
              key={dt._id}
              dt={dt}
              siblings={dutyTypes.filter((d) => d._id !== dt._id)}
              onUpdate={(patch) => onUpdate(dt._id, patch)}
              onDelete={() => setPendingDelete(dt)}
            />
          ))}
          {adding ? (
            <DraftRow
              onSave={(fields) => {
                onCreate(fields);
                setAdding(false);
              }}
              onCancel={() => setAdding(false)}
            />
          ) : null}
        </Surface>
      )}

      <Modal
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        title="Delete duty type"
        footer={
          <>
            <Button onClick={() => setPendingDelete(null)}>Cancel</Button>
            <Button
              variant="danger"
              onClick={() => {
                if (pendingDelete) onRemove(pendingDelete._id);
                setPendingDelete(null);
              }}
            >
              Delete
            </Button>
          </>
        }
      >
        {/* Deleting this takes its shifts with it, so the count is named
            before the fact rather than discovered afterwards. */}
        <p className="text-[12.5px] text-muted">
          Delete <span className="font-medium text-ink">{pendingDelete?.name}</span>
          {pendingDelete && pendingDelete.shiftCount > 0 ? (
            <>
              {" and its "}
              <span className="font-medium text-ink">
                {pendingDelete.shiftCount} shift
                {pendingDelete.shiftCount === 1 ? "" : "s"}
              </span>
              ? Their assignments, one-off fill-ins and pending swap requests go
              with them. Logged hours are never deleted — if any shift has hours
              on it, nothing is removed and you keep the duty type.
            </>
          ) : (
            "? Nothing uses it yet."
          )}
        </p>
      </Modal>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Wired page                                                          */
/* ------------------------------------------------------------------ */

export default function DutyTypes() {
  const { periodId } = usePeriod();
  const dutyTypes = useQuery(api.dutyTypes.list, periodId ? { periodRef: periodId } : "skip");
  const create = useMutation(api.dutyTypes.create);
  const update = useMutation(api.dutyTypes.update);
  const remove = useMutation(api.dutyTypes.remove);

  return (
    <DutyTypesView
      periodSelected={periodId !== null}
      dutyTypes={periodId ? dutyTypes : undefined}
      onCreate={(fields) => {
        if (!periodId) return;
        create({ periodRef: periodId, ...fields })
          .then(() => toast(`Added ${fields.name}`))
          .catch((e) => toast(errorMessage(e), { tone: "error" }));
      }}
      onUpdate={(id, patch) => {
        update({ dutyTypeRef: id, ...patch }).catch((e) =>
          toast(errorMessage(e), { tone: "error" }),
        );
      }}
      onRemove={(id) => {
        remove({ dutyTypeRef: id })
          .then(() => toast("Duty type deleted"))
          .catch((e) => toast(errorMessage(e), { tone: "error" }));
      }}
    />
  );
}
