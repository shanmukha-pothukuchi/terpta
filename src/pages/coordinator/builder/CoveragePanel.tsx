/**
 * One-off coverage (Builder).
 *
 * A date-scoped swap does not move the recurring assignment, so an approved
 * one lands here instead: "Priya is out on Oct 7 — who is standing in?".
 * Fill it by hand from the eligible list, or hit Auto-fill to take the top
 * candidate from the rest of the pool (available that day, no date exception
 * over the date, not already booked at that hour).
 *
 * `CoveragePanelView` is the pure inner component the DEV preview harness
 * renders; the default export wires Convex.
 */
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { CalendarX2, UserRoundCheck, Wand2 } from "lucide-react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { Badge, Button, Select, toast } from "../../../components/ui";
import { errorMessage } from "../../../lib/errorMessage";
import { formatTimeRange } from "../../../lib/format";

export interface CoverageCandidate {
  taProfileRef: string;
  name: string;
  fit: "available" | "prefer_not";
  assignedCount: number;
}

export interface CoverageRow {
  id: string;
  date: string;
  label: string;
  startMin?: number;
  endMin?: number;
  absentName: string;
  coverTaRef: string | null;
  coverName: string | null;
  filledBy: "manual" | "auto" | null;
  reason: string | null;
}

/** "2026-10-07" -> "Tue Oct 7". Parsed locally so it cannot slip a day. */
function formatIsoDate(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString(
    undefined,
    { weekday: "short", month: "short", day: "numeric" },
  );
}

export interface CoveragePanelViewProps {
  rows: CoverageRow[];
  /** Candidates for the row currently being edited, if any. */
  candidates?: CoverageCandidate[];
  candidatesFor?: string | null;
  onPickRow?: (rowId: string | null) => void;
  onSetCover?: (rowId: string, taProfileRef: string | null) => void;
  onAutoFill?: (rowId: string) => void;
  busyRowId?: string | null;
}

export function CoveragePanelView({
  rows,
  candidates = [],
  candidatesFor = null,
  onPickRow,
  onSetCover,
  onAutoFill,
  busyRowId = null,
}: CoveragePanelViewProps) {
  if (rows.length === 0) return null;

  const unfilled = rows.filter((r) => r.coverTaRef === null).length;

  return (
    <div className="overflow-hidden rounded-[12px] border border-line bg-surface">
      {/* This panel lives in the Builder's narrow right column, so everything
          stacks. Laid out as one wide row, every field truncated to an
          ellipsis and the card said nothing at all. */}
      <div className="flex h-10 items-center gap-2 border-b border-line px-[14px]">
        <CalendarX2 size={14} strokeWidth={1.5} className="shrink-0 text-muted" aria-hidden />
        <div className="min-w-0 flex-1 truncate text-[13px] font-medium">
          One-off coverage
        </div>
        {unfilled > 0 && (
          <Badge tone="amber" className="shrink-0">
            {unfilled} unfilled
          </Badge>
        )}
      </div>

      <div className="flex flex-col divide-y divide-line">
        {rows.map((row) => {
          const editing = candidatesFor === row.id;
          const busy = busyRowId === row.id;
          return (
            <div key={row.id} className="flex flex-col gap-1.5 px-[14px] py-3">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 font-mono text-[11.5px] text-muted">
                <span>{formatIsoDate(row.date)}</span>
                {row.startMin !== undefined && row.endMin !== undefined && (
                  <span className="text-faint">
                    {formatTimeRange(row.startMin, row.endMin)}
                  </span>
                )}
              </div>

              {/* The shift name wraps rather than truncating — it is the one
                  thing the row exists to identify. */}
              <div className="text-[12.5px] font-medium text-ink">{row.label}</div>

              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[12px] text-faint">{row.absentName} out</span>
                {row.coverTaRef ? (
                  <Badge tone="green">
                    <UserRoundCheck size={11} strokeWidth={1.5} aria-hidden />
                    {row.coverName}
                    {row.filledBy === "auto" ? " · auto" : ""}
                  </Badge>
                ) : (
                  <Badge tone="amber">Unfilled</Badge>
                )}
              </div>

              {row.reason && (
                <div className="text-[12px] leading-snug text-faint">“{row.reason}”</div>
              )}

              <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                {editing ? (
                  <>
                    <Select
                      aria-label={`Cover for ${row.label} on ${row.date}`}
                      value={row.coverTaRef ?? ""}
                      onChange={(e) => onSetCover?.(row.id, e.target.value || null)}
                      className="h-7 w-full text-[12px]"
                    >
                      <option value="">Nobody yet</option>
                      {candidates.map((c) => (
                        <option key={c.taProfileRef} value={c.taProfileRef}>
                          {c.name}
                          {c.fit === "prefer_not" ? " (would rather not)" : ""} ·{" "}
                          {c.assignedCount} shifts
                        </option>
                      ))}
                    </Select>
                    {candidates.length === 0 && (
                      <span className="text-[12px] text-faint">
                        Nobody in the pool is free then.
                      </span>
                    )}
                    <Button variant="ghost" size="sm" onClick={() => onPickRow?.(null)}>
                      Done
                    </Button>
                  </>
                ) : (
                  <>
                    <Button variant="secondary" size="sm" onClick={() => onPickRow?.(row.id)}>
                      {row.coverTaRef ? "Change" : "Pick someone"}
                    </Button>
                    {row.coverTaRef === null && (
                      <Button
                        variant="secondary"
                        size="sm"
                        loading={busy}
                        onClick={() => onAutoFill?.(row.id)}
                      >
                        <Wand2 size={13} strokeWidth={1.5} aria-hidden />
                        Auto-fill
                      </Button>
                    )}
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function CoveragePanel({ periodRef }: { periodRef: Id<"staffingPeriods"> }) {
  const rows = useQuery(api.coverage.list, { periodRef });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busyRowId, setBusyRowId] = useState<string | null>(null);
  const candidates = useQuery(
    api.coverage.candidates,
    editingId ? { coverageRef: editingId as Id<"shiftCoverages"> } : "skip",
  );
  const setCover = useMutation(api.coverage.setCover);
  const autoFill = useMutation(api.coverage.autoFill);

  if (!rows || rows.length === 0) return null;

  return (
    <CoveragePanelView
      rows={rows.map((r) => ({
        id: r._id as string,
        date: r.date,
        label: r.label,
        startMin: r.startMin,
        endMin: r.endMin,
        absentName: r.absentName,
        coverTaRef: r.coverTaRef as string | null,
        coverName: r.coverName,
        filledBy: r.filledBy,
        reason: r.reason,
      }))}
      candidates={(candidates ?? []).map((c) => ({
        taProfileRef: c.taProfileRef as string,
        name: c.name,
        fit: c.fit,
        assignedCount: c.assignedCount,
      }))}
      candidatesFor={editingId}
      onPickRow={setEditingId}
      onSetCover={(rowId, taProfileRef) => {
        void setCover({
          coverageRef: rowId as Id<"shiftCoverages">,
          coverTaRef: taProfileRef
            ? (taProfileRef as Id<"taProfiles">)
            : undefined,
        }).catch((e: unknown) => toast(errorMessage(e), { tone: "error" }));
      }}
      onAutoFill={(rowId) => {
        setBusyRowId(rowId);
        void autoFill({ coverageRef: rowId as Id<"shiftCoverages"> })
          .then((res) => {
            toast(
              res
                ? `${res.name} is covering`
                : "Nobody in the pool is free then — pick someone by hand",
              { tone: res ? "success" : "error" },
            );
          })
          .catch((e: unknown) => toast(errorMessage(e), { tone: "error" }))
          .finally(() => setBusyRowId(null));
      }}
      busyRowId={busyRowId}
    />
  );
}
