import {
  firstName,
  shiftLongLabel,
  shiftWhen,
  type BuilderModel,
  type Highlight,
} from "./model";

export interface DiagnosticsPanelProps {
  model: BuilderModel;
  highlight: Highlight;
  onToggle: (key: Exclude<Highlight, null | `ta:${string}`>) => void;
  onClear: () => void;
}

interface DiagRow {
  key: Exclude<Highlight, null | `ta:${string}`>;
  label: string;
  count: number;
  items: string[];
  dot: string;
}

/**
 * Right-rail diagnostics. Clicking a row toggles a highlight that outlines the
 * cells/chips it refers to; the active row expands its detail lines.
 */
export function DiagnosticsPanel({
  model,
  highlight,
  onToggle,
  onClear,
}: DiagnosticsPanelProps) {
  const unfilledItems = [...model.weekly, ...model.events]
    .filter(
      (s) =>
        (model.assignmentsByShift.get(s._id as string)?.length ?? 0) <
        s.requiredCount,
    )
    .map((s) => {
      const missing =
        s.requiredCount - (model.assignmentsByShift.get(s._id as string)?.length ?? 0);
      return `${shiftLongLabel(model, s)} · ${shiftWhen(s)} · ${missing} open`;
    });

  const conflictItems: string[] = [];
  for (const list of model.conflictsByAssignment.values()) {
    for (const c of list) {
      conflictItems.push(`${firstName(model.taName(c.taProfileRef))} — ${c.detail}`);
    }
  }

  const loadItem = (id: string) => {
    const l = model.loadByTa.get(id);
    const name = model.rosterByTa.get(id)?.name ?? "(unknown)";
    return l ? `${name} · ${l.weeklyHours} / ${l.maxHoursPerWeek}h` : name;
  };
  const overItems = [...model.overTaIds].map(loadItem);
  const underItems = [...model.underTaIds].map(loadItem);
  const zeroItems = [...model.zeroTaIds].map((id) => {
    const r = model.rosterByTa.get(id);
    if (!r) return "(unknown)";
    return r.status === "missing" ? `${r.name} · availability not submitted` : r.name;
  });

  const rows: DiagRow[] = [
    { key: "unfilled", label: "Unfilled shifts", count: unfilledItems.length, items: unfilledItems, dot: "#E21833" },
    { key: "conflict", label: "Conflicts", count: conflictItems.length, items: conflictItems, dot: "#E21833" },
    { key: "over", label: "Over hours cap", count: overItems.length, items: overItems, dot: "#F5A524" },
    { key: "under", label: "Under 30% of cap", count: underItems.length, items: underItems, dot: "#F5A524" },
    { key: "zero", label: "No assignments", count: zeroItems.length, items: zeroItems, dot: "#9A9AA3" },
  ];

  return (
    <div className="overflow-hidden rounded-[12px] border border-line bg-surface">
      <div className="flex h-10 items-center gap-[10px] border-b border-line px-[14px]">
        <div className="text-[13px] font-medium">Diagnostics</div>
        <div className="flex-1" />
        <button
          type="button"
          onClick={onClear}
          className="text-[11.5px] text-faint transition-colors hover:text-ink"
        >
          Clear highlight
        </button>
      </div>
      <div className="flex flex-col gap-[2px] p-[6px]">
        {rows.map((row) => {
          const active = highlight === row.key;
          const color = row.count > 0 ? "#EDEDEF" : "#6B6B75";
          const dot = row.count > 0 ? row.dot : "rgba(255,255,255,0.18)";
          return (
            <button
              key={row.key}
              type="button"
              onClick={() => onToggle(row.key)}
              className="flex cursor-pointer flex-col gap-[6px] rounded-[9px] p-2 text-left transition-colors duration-150 hover:bg-[rgba(255,255,255,0.05)]"
              style={{ background: active ? "rgba(255,255,255,0.06)" : "transparent" }}
            >
              <span className="flex items-center gap-[9px] text-[12.5px]">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ background: dot, boxShadow: `0 0 8px ${dot}` }}
                />
                <span className="flex-1" style={{ color }}>
                  {row.label}
                </span>
                <span className="font-mono text-xs" style={{ color }}>
                  {row.count}
                </span>
              </span>
              {active &&
                row.items.map((item, i) => (
                  <span
                    key={i}
                    className="pl-[17px] text-[11.5px] leading-[1.35] text-muted"
                  >
                    {item}
                  </span>
                ))}
            </button>
          );
        })}
      </div>
    </div>
  );
}
