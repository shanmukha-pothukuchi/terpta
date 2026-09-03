import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "convex/react";
import { X } from "lucide-react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import {
  DAY_CODES,
  DAY_SHORT,
  formatDate,
  formatTimeRange,
  type DayCode,
} from "../../../lib/format";
import { Spinner } from "../../../components/ui";
import {
  firstName,
  roomOf,
  shiftLongLabel,
  shiftWhen,
  type BuilderModel,
  type TaDetailData,
} from "./model";

const CELL_MIN = 30; // mini-grid resolution
const CELL_H = 8; // px
const CELL_GAP = 1;
const HEADER_H = 15; // 14px label + 1px gap

export interface TaDrawerProps {
  taProfileRef: Id<"taProfiles">;
  model: BuilderModel;
  onClose: () => void;
  /** Assign this TA to the given shift (open slots listed first). */
  onAssign: (shiftRef: Id<"shifts">) => void;
  /** DEV harness override — skips the Convex query when provided. */
  fixtureDetail?: TaDetailData;
}

function cellColor(
  detail: TaDetailData,
  day: DayCode,
  startMin: number,
): string {
  let cls = false;
  let status: "available" | "prefer_not" | null = null;
  for (const b of detail.blocks) {
    if (b.day !== day) continue;
    if (b.startMin > startMin || b.endMin <= startMin) continue;
    if (b.source === "imported_class") cls = true;
    else if (b.status === "available") status ??= "available";
    else if (b.status === "prefer_not" && status !== "available") status = "prefer_not";
  }
  if (cls) return "rgba(125,147,178,0.35)";
  if (status === "available") return "rgba(61,214,140,0.28)";
  if (status === "prefer_not") return "rgba(245,165,36,0.25)";
  return "rgba(255,255,255,0.04)"; // unpainted time is unavailable
}

/** TA detail drawer: load, availability mini-grid, preferences, Assign to…. */
export function TaDrawer({
  taProfileRef,
  model,
  onClose,
  onAssign,
  fixtureDetail,
}: TaDrawerProps) {
  const queried = useQuery(
    api.builder.taDetail,
    fixtureDetail ? "skip" : { taProfileRef },
  );
  const detail = fixtureDetail ?? queried;
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(raf);
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const taKey = taProfileRef as string;
  const myAssignments = useMemo(() => {
    const out: { shiftId: string; conflict: boolean; hoursAllocated?: number }[] = [];
    for (const [shiftId, list] of model.assignmentsByShift) {
      for (const a of list) {
        if ((a.taProfileRef as string) !== taKey) continue;
        out.push({
          shiftId,
          conflict:
            (model.conflictsByAssignment.get(a._id as string)?.length ?? 0) > 0,
          hoursAllocated: a.hoursAllocated,
        });
      }
    }
    return out;
  }, [model, taKey]);

  const targets = useMemo(() => {
    const label = (s: (typeof model.weekly)[number], suffix = "") =>
      `${shiftLongLabel(model, s)} · ${shiftWhen(s)}${suffix}`;
    const open = [...model.weekly, ...model.events].filter(
      (s) =>
        (model.assignmentsByShift.get(s._id as string)?.length ?? 0) <
        s.requiredCount,
    );
    const full = [...model.weekly, ...model.events].filter(
      (s) =>
        (model.assignmentsByShift.get(s._id as string)?.length ?? 0) >=
        s.requiredCount,
    );
    return [
      ...open.map((s) => ({ id: s._id as string, label: label(s) })),
      ...full.map((s) => ({ id: s._id as string, label: label(s, " (replace)") })),
    ];
  }, [model]);
  const [target, setTarget] = useState<string>("");
  const selected = target || targets[0]?.id || "";

  const load = model.loadByTa.get(taKey);
  const hours = load?.weeklyHours ?? 0;
  const cap = load?.maxHoursPerWeek ?? detail?.maxHoursPerWeek ?? 0;
  const over = hours > cap + 1e-9;
  const pct = cap > 0 ? Math.min(100, (hours / cap) * 100) : 0;

  const nCells = Math.max(1, (model.gridEndMin - model.gridStartMin) / CELL_MIN);

  const availableHoursPerWeek = detail
    ? detail.blocks
        .filter((b) => b.source === "manual" && b.status === "available")
        .reduce((n, b) => n + (b.endMin - b.startMin) / 60, 0)
    : 0;

  const items: { a: string; b: string; c: string }[] = [];
  for (const { shiftId, conflict: _c, hoursAllocated } of myAssignments) {
    const shift =
      model.weekly.find((s) => (s._id as string) === shiftId) ??
      model.events.find((s) => (s._id as string) === shiftId) ??
      model.asyncShifts.find((s) => (s._id as string) === shiftId);
    if (!shift) continue;
    if (shift.recurrence === "weekly") {
      const dur =
        shift.startMin !== undefined && shift.endMin !== undefined
          ? (shift.endMin - shift.startMin) / 60
          : 0;
      items.push({
        a: shiftLongLabel(model, shift),
        b: `${shiftWhen(shift)}${roomOf(model, shift) ? ` · ${roomOf(model, shift)}` : ""}`,
        c: `${dur}h/wk`,
      });
    } else if (shift.recurrence === "once") {
      const dur =
        shift.startMin !== undefined && shift.endMin !== undefined
          ? (shift.endMin - shift.startMin) / 60
          : 0;
      items.push({
        a: shift.description ?? shiftLongLabel(model, shift),
        b: `${shift.day ? DAY_SHORT[shift.day as DayCode] : ""} ${
          shift.date ? formatDate(shift.date) : ""
        }${
          shift.startMin !== undefined && shift.endMin !== undefined
            ? ` · ${formatTimeRange(shift.startMin, shift.endMin)}`
            : ""
        }`,
        c: `${dur}h once`,
      });
    } else {
      items.push({
        a: shift.description ?? shiftLongLabel(model, shift),
        b: shift.dueDate ? `due ${formatDate(shift.dueDate)}` : "async",
        c: `${hoursAllocated ?? shift.hoursRequired ?? 0}h`,
      });
    }
  }

  const prefLabel = detail
    ? detail.syncAsyncPreference < 0.4
      ? "Mostly synchronous"
      : detail.syncAsyncPreference > 0.6
        ? "Mostly asynchronous"
        : "No strong preference"
    : "";

  const name = detail?.name ?? model.taName(taProfileRef);

  return createPortal(
    <div className="fixed inset-0 z-50">
      <div
        className="absolute inset-0 bg-[rgba(0,0,0,0.35)]"
        onClick={onClose}
      />
      <div
        className="absolute bottom-0 right-0 top-0 flex w-[420px] flex-col overflow-auto border-l border-line-strong bg-[#111115] shadow-[-30px_0_80px_rgba(0,0,0,0.5)] transition-[transform,opacity] duration-200 ease-out"
        style={{
          transform: entered ? "none" : "translateX(24px)",
          opacity: entered ? 1 : 0,
        }}
      >
        <div className="flex items-center gap-3 border-b border-line px-5 pb-[14px] pt-[18px]">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-[#2B2B33] to-[#3A3A45] text-[13px] font-semibold">
            {name.slice(0, 2).toUpperCase()}
          </div>
          <div className="flex flex-col gap-[2px]">
            <div className="text-[15px] font-semibold tracking-[-0.01em]">{name}</div>
            <div className="font-mono text-xs text-muted">{detail?.email ?? ""}</div>
          </div>
          <div className="flex-1" />
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-[7px] text-faint transition-colors hover:bg-[rgba(255,255,255,0.06)]"
          >
            <X size={15} strokeWidth={1.5} />
          </button>
        </div>

        {detail === undefined ? (
          <div className="flex flex-1 items-center justify-center py-16">
            <Spinner label="Loading TA…" />
          </div>
        ) : detail === null ? (
          <div className="px-5 py-8 text-[12.5px] text-faint">
            This TA could not be loaded.
          </div>
        ) : (
          <div className="flex flex-col gap-[18px] px-5 py-4">
            <div className="flex flex-col gap-2">
              <div className="flex items-baseline gap-2">
                <span className="text-xs text-muted">Weekly load</span>
                <span className="flex-1" />
                <span
                  className="font-mono text-[13px]"
                  style={{ color: over ? "#F7C566" : "#EDEDEF" }}
                >
                  {hours} / {cap}h
                </span>
              </div>
              <div className="relative h-[6px] overflow-hidden rounded-[3px] bg-[rgba(255,255,255,0.06)]">
                <div
                  className="absolute bottom-0 left-0 top-0 rounded-[3px]"
                  style={{
                    width: `${pct}%`,
                    background: over ? "#F5A524" : "#3DD68C",
                  }}
                />
              </div>
              {items.length === 0 ? (
                <div className="text-[12.5px] text-faint">No assignments yet.</div>
              ) : (
                items.map((it, i) => (
                  <div key={i} className="flex items-center gap-2 text-[12.5px]">
                    <span className="min-w-[118px] font-mono text-[#C9C9CF]">
                      {it.a}
                    </span>
                    <span className="flex-1 text-muted">{it.b}</span>
                    <span className="font-mono text-muted">{it.c}</span>
                  </div>
                ))
              )}
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted">Availability</span>
                <span className="text-[11.5px] text-faint">· assignments outlined</span>
                <span className="flex-1" />
                <span
                  className="text-[11.5px]"
                  style={{ color: detail.availabilitySubmitted ? "#7FE3B1" : "#F7C566" }}
                >
                  {detail.availabilitySubmitted
                    ? `${Math.round(availableHoursPerWeek * 10) / 10}h available`
                    : "Not submitted"}
                </span>
              </div>
              <div className="grid grid-cols-5 gap-1 rounded-[10px] border border-line bg-page p-2">
                {DAY_CODES.map((day) => {
                  const outlines = model.weekly
                    .filter(
                      (s) =>
                        s.day === day &&
                        myAssignments.some((m) => m.shiftId === (s._id as string)),
                    )
                    .map((s) => {
                      const conflict = myAssignments.find(
                        (m) => m.shiftId === (s._id as string),
                      )?.conflict;
                      const startIdx =
                        ((s.startMin ?? model.gridStartMin) - model.gridStartMin) /
                        CELL_MIN;
                      const span =
                        ((s.endMin ?? model.gridStartMin) -
                          (s.startMin ?? model.gridStartMin)) /
                        CELL_MIN;
                      return {
                        key: s._id as string,
                        top: HEADER_H + startIdx * (CELL_H + CELL_GAP),
                        h: span * (CELL_H + CELL_GAP) - CELL_GAP,
                        color: conflict ? "#E21833" : "#EDEDEF",
                        tip: `${shiftLongLabel(model, s)} ${shiftWhen(s)}`,
                      };
                    });
                  return (
                    <div key={day} className="relative flex flex-col gap-px">
                      <div className="h-[14px] text-center text-[10px] text-faint">
                        {DAY_SHORT[day]}
                      </div>
                      {Array.from({ length: nCells }, (_, i) => (
                        <div
                          key={i}
                          className="rounded-[2px]"
                          style={{
                            height: CELL_H,
                            background: cellColor(
                              detail,
                              day,
                              model.gridStartMin + i * CELL_MIN,
                            ),
                          }}
                        />
                      ))}
                      {outlines.map((o) => (
                        <div
                          key={o.key}
                          title={o.tip}
                          className="absolute -left-px -right-px rounded-[3px]"
                          style={{
                            top: o.top,
                            height: o.h,
                            boxShadow: `inset 0 0 0 1.5px ${o.color}`,
                          }}
                        />
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="flex flex-col gap-[10px]">
              <div className="text-xs text-muted">Preferences</div>
              <div className="grid grid-cols-2 gap-[10px]">
                <div className="flex flex-col gap-1 rounded-[10px] border border-line px-3 py-[10px]">
                  <span className="text-[11px] text-faint">Max hours / week</span>
                  <span className="font-mono text-[14px]">
                    {detail.maxHoursPerWeek}h
                  </span>
                </div>
                <div className="flex flex-col gap-[7px] rounded-[10px] border border-line px-3 py-[10px]">
                  <span className="text-[11px] text-faint">Sync ↔ Async</span>
                  <div className="relative my-1 h-1 rounded-[2px] bg-[rgba(255,255,255,0.08)]">
                    <div
                      className="absolute -top-1 h-3 w-3 -translate-x-[6px] rounded-full bg-ink shadow-[0_0_0_3px_rgba(255,255,255,0.10)]"
                      style={{ left: `${detail.syncAsyncPreference * 100}%` }}
                    />
                  </div>
                  <span className="text-[11px] text-muted">{prefLabel}</span>
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-[11px] text-faint">Duty ranking</span>
                <div className="flex flex-wrap gap-[6px]">
                  {detail.dutyTypePrefNames.length === 0 ? (
                    <span className="text-[12.5px] text-faint">—</span>
                  ) : (
                    detail.dutyTypePrefNames.map((label, i) => (
                      <span
                        key={label}
                        className="flex h-6 items-center gap-[6px] rounded-[7px] border border-line bg-[rgba(255,255,255,0.05)] py-0 pl-[7px] pr-[9px] text-xs"
                      >
                        <span className="font-mono text-[11px] text-faint">{i + 1}</span>
                        {label}
                      </span>
                    ))
                  )}
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-[11px] text-faint">Preferred sections</span>
                <span className="font-mono text-[12.5px] text-[#C9C9CF]">
                  {detail.sectionPrefNumbers.length > 0
                    ? detail.sectionPrefNumbers.join(" · ")
                    : "—"}
                </span>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-[11px] text-faint">Enrolled sections</span>
                <span className="font-mono text-[12.5px] text-[#C9C9CF]">
                  {detail.enrolledSectionNumbers.length > 0
                    ? detail.enrolledSectionNumbers.join(" · ")
                    : "—"}
                </span>
              </div>
            </div>
          </div>
        )}

        <div className="flex-1" />
        <div className="flex items-center gap-2 border-t border-line px-5 pb-[18px] pt-[14px]">
          <select
            value={selected}
            onChange={(e) => setTarget(e.target.value)}
            className="h-8 flex-1 rounded-[9px] border border-line-strong bg-page px-[10px] text-[12.5px] text-ink outline-none"
          >
            {targets.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={selected === ""}
            onClick={() => {
              if (selected !== "") onAssign(selected as Id<"shifts">);
            }}
            className="flex h-8 items-center gap-[7px] whitespace-nowrap rounded-[9px] bg-ink px-3 text-[12.5px] font-medium text-page hover:bg-white disabled:opacity-50"
          >
            Assign {firstName(name)} to…
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
