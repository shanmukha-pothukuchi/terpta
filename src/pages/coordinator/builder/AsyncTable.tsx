import { useEffect, useState } from "react";
import type { Id } from "../../../../convex/_generated/dataModel";
import { formatDate } from "../../../lib/format";
import {
  type BoardAssignment,
  type BuilderModel,
  type ShiftRow,
} from "./model";

export interface AsyncTableProps {
  model: BuilderModel;
  /** TA rows added locally via the "Add TA to async…" select. */
  addedTaIds: string[];
  onAddTa: (taProfileRef: string) => void;
  onOpenTa: (taProfileRef: Id<"taProfiles">) => void;
  onChangeHours: (
    shift: ShiftRow,
    taProfileRef: Id<"taProfiles">,
    hours: number,
    existing: BoardAssignment | undefined,
  ) => void;
}

/** Committed-on-blur numeric input styled per the board (26px, mono). */
function HourInput({
  value,
  onCommit,
}: {
  value: number;
  onCommit: (n: number) => void;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = () => {
    const n = Math.max(0, Math.min(40, Number(text) || 0));
    setText(String(n));
    if (n !== value) onCommit(n);
  };
  return (
    <input
      type="number"
      min={0}
      max={40}
      step={1}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
      className="box-border h-[26px] w-[58px] rounded-[7px] border border-line bg-transparent px-2 font-mono text-xs text-ink outline-none transition-[border-color,box-shadow] duration-150 focus:border-[rgba(255,255,255,0.28)] focus:shadow-[0_0_0_3px_rgba(255,255,255,0.05)]"
      style={{ background: Number(text) > 0 ? "rgba(255,255,255,0.05)" : "transparent" }}
    />
  );
}

/** Async allocation table: editable hours per TA, totals, weekly-load tally. */
export function AsyncTable({
  model,
  addedTaIds,
  onAddTa,
  onOpenTa,
  onChangeHours,
}: AsyncTableProps) {
  const { asyncShifts } = model;
  if (asyncShifts.length === 0) return null;

  const rowTaIds = new Set<string>(addedTaIds);
  for (const shift of asyncShifts) {
    for (const a of model.assignmentsByShift.get(shift._id as string) ?? []) {
      rowTaIds.add(a.taProfileRef as string);
    }
  }
  const rows = [...rowTaIds]
    .map((id) => ({ id, roster: model.rosterByTa.get(id) }))
    .filter((r) => r.roster !== undefined)
    .sort((a, b) => a.roster!.name.localeCompare(b.roster!.name));

  const gridCols = { gridTemplateColumns: `1.4fr repeat(${asyncShifts.length},1fr) 0.7fr` };

  const cellOf = (shift: ShiftRow, taId: string) =>
    (model.assignmentsByShift.get(shift._id as string) ?? []).find(
      (a) => (a.taProfileRef as string) === taId,
    );

  return (
    <div className="overflow-hidden rounded-[12px] border border-line bg-surface">
      <div className="flex h-10 items-center gap-[10px] border-b border-line px-[14px]">
        <div className="text-[13px] font-medium">Async allocation</div>
        <div className="text-xs text-faint">
          Hours per TA · async hours count toward the weekly cap spread over the
          semester
        </div>
      </div>
      <div
        className="grid h-10 items-center border-b border-[rgba(255,255,255,0.06)] px-[14px] text-[11.5px] text-muted"
        style={gridCols}
      >
        <div>TA</div>
        {asyncShifts.map((shift) => {
          const duty = model.dutyById.get(shift.dutyTypeRef as string);
          return (
            <div key={shift._id as string} className="flex flex-col gap-[1px]">
              <span className="font-medium text-[#C9C9CF]">
                {shift.description ?? duty?.name ?? "Async duty"}
              </span>
              <span className="font-mono text-[10.5px]">
                {shift.hoursRequired ?? 0}h per TA · {shift.requiredCount} TAs
                {shift.dueDate ? ` · due ${formatDate(shift.dueDate)}` : ""}
              </span>
            </div>
          );
        })}
        <div className="text-right">Weekly load</div>
      </div>
      {rows.map(({ id, roster }) => {
        const load = model.loadByTa.get(id);
        const over = model.overTaIds.has(id);
        const loadColor = over
          ? "#F7C566"
          : load && load.weeklyHours < 0.3 * load.maxHoursPerWeek
            ? "#9A9AA3"
            : "#EDEDEF";
        return (
          <div
            key={id}
            className="grid h-[38px] items-center border-b border-[rgba(255,255,255,0.04)] px-[14px] text-[12.5px] transition-colors duration-150 hover:bg-[rgba(255,255,255,0.02)]"
            style={gridCols}
          >
            <button
              type="button"
              onClick={() => onOpenTa(id as Id<"taProfiles">)}
              className="flex cursor-pointer items-center gap-2 text-left"
            >
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[rgba(255,255,255,0.08)] text-[9.5px] font-semibold text-[#C9C9CF]">
                {roster!.name.slice(0, 2).toUpperCase()}
              </span>
              <span>{roster!.name}</span>
            </button>
            {asyncShifts.map((shift) => {
              const existing = cellOf(shift, id);
              const value = existing
                ? (existing.hoursAllocated ?? shift.hoursRequired ?? 0)
                : 0;
              return (
                <div key={shift._id as string}>
                  <HourInput
                    value={value}
                    onCommit={(n) =>
                      onChangeHours(shift, id as Id<"taProfiles">, n, existing)
                    }
                  />
                </div>
              );
            })}
            <div className="text-right font-mono text-xs" style={{ color: loadColor }}>
              {load ? `${load.weeklyHours} / ${load.maxHoursPerWeek}h` : "—"}
            </div>
          </div>
        );
      })}
      <div
        className="grid h-10 items-center px-[14px] text-xs text-muted"
        style={gridCols}
      >
        <div className="flex items-center gap-2">
          <select
            value=""
            onChange={(e) => {
              if (e.target.value) onAddTa(e.target.value);
            }}
            className="h-[26px] rounded-[7px] border border-line bg-raised px-2 text-xs text-[#C9C9CF] outline-none"
          >
            <option value="">Add TA to async…</option>
            {[...model.rosterByTa.values()]
              .filter((r) => !rowTaIds.has(r.taProfileRef as string))
              .map((r) => (
                <option key={r.taProfileRef as string} value={r.taProfileRef as string}>
                  {r.name}
                </option>
              ))}
          </select>
        </div>
        {asyncShifts.map((shift) => {
          const assigned = model.assignmentsByShift.get(shift._id as string) ?? [];
          const got = assigned.reduce(
            (n, a) => n + (a.hoursAllocated ?? shift.hoursRequired ?? 0),
            0,
          );
          const req = (shift.hoursRequired ?? 0) * shift.requiredCount;
          const color = got === req ? "#7FE3B1" : got > req ? "#F7C566" : "#F4A3AE";
          return (
            <div key={shift._id as string} className="font-mono text-xs" style={{ color }}>
              {got} / {req}h allocated
            </div>
          );
        })}
        <div />
      </div>
    </div>
  );
}
