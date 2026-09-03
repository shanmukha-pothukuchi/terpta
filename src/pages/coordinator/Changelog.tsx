import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { ArrowLeftRight, History } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import {
  Badge,
  Button,
  EmptyState,
  PageHeader,
  Spinner,
  Surface,
  toast,
  type BadgeTone,
} from "../../components/ui";
import { usePeriod } from "../../lib/period";
import { formatDate, formatTimeRange } from "../../lib/format";
import { errorMessage } from "../../lib/errorMessage";

export type ChangeEntry = FunctionReturnType<typeof api.periods.getChangelog>[number];
export type SwapRow = FunctionReturnType<typeof api.periods.listSwaps>[number];

const ACTION_LABEL: Record<string, string> = {
  "period.publish": "Published the schedule",
  "shift.create": "Added a shift",
  "shift.update": "Edited a shift",
  "shift.remove": "Removed a shift",
  "assignment.override": "Reassigned a shift",
  "assignment.remove": "Removed an assignment",
  "assignment.lock": "Locked an assignment",
  "assignment.unlock": "Unlocked an assignment",
  "swap.approve": "Approved a swap request",
  "swap.decline": "Declined a swap request",
};

const SWAP_TONE: Record<SwapRow["status"], BadgeTone> = {
  pending: "amber",
  approved: "green",
  declined: "neutral",
};

/* ------------------------------------------------------------------ */
/* before → after diff lines                                           */
/* ------------------------------------------------------------------ */

export interface DiffLine {
  key: string;
  before: string | null;
  after: string | null;
}

const SKIP_KEYS = new Set(["_id", "_creationTime", "periodRef"]);

function fmtValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function diffLines(before: unknown, after: unknown): DiffLine[] {
  if (isPlainObject(before) && isPlainObject(after)) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(
      (k) => !SKIP_KEYS.has(k),
    );
    const lines: DiffLine[] = [];
    for (const k of keys) {
      const b = before[k];
      const a = after[k];
      if (JSON.stringify(b) !== JSON.stringify(a)) {
        lines.push({ key: k, before: fmtValue(b), after: fmtValue(a) });
      }
    }
    return lines;
  }
  if ((before === null || before === undefined) && isPlainObject(after)) {
    return Object.entries(after)
      .filter(([k, v]) => !SKIP_KEYS.has(k) && v !== undefined)
      .map(([k, v]) => ({ key: k, before: null, after: fmtValue(v) }));
  }
  if (isPlainObject(before) && (after === null || after === undefined)) {
    return Object.entries(before)
      .filter(([k, v]) => !SKIP_KEYS.has(k) && v !== undefined)
      .map(([k, v]) => ({ key: k, before: fmtValue(v), after: null }));
  }
  if (JSON.stringify(before) === JSON.stringify(after)) return [];
  return [{ key: "value", before: fmtValue(before), after: fmtValue(after) }];
}

function swapShiftLabel(swap: SwapRow): string {
  const base = swap.description ?? swap.dutyTypeName;
  if (swap.recurrence === "weekly" && swap.day && swap.startMin !== undefined && swap.endMin !== undefined) {
    return `${base} · ${swap.day} ${formatTimeRange(swap.startMin, swap.endMin)}`;
  }
  if (swap.recurrence === "once" && swap.date) {
    const time =
      swap.startMin !== undefined && swap.endMin !== undefined
        ? ` ${formatTimeRange(swap.startMin, swap.endMin)}`
        : "";
    return `${base} · ${formatDate(swap.date)}${time}`;
  }
  if (swap.dueDate) return `${base} · due ${formatDate(swap.dueDate)}`;
  return base;
}

function timeOf(at: number): string {
  return new Date(at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

/* ------------------------------------------------------------------ */
/* Pure view                                                           */
/* ------------------------------------------------------------------ */

export interface ChangelogViewProps {
  periodSelected: boolean;
  /** undefined = loading */
  entries: ChangeEntry[] | undefined;
  swaps: SwapRow[] | undefined;
  resolving: Id<"swapRequests"> | null;
  onResolve: (id: Id<"swapRequests">, approve: boolean) => void;
}

export function ChangelogView({
  periodSelected,
  entries,
  swaps,
  resolving,
  onResolve,
}: ChangelogViewProps) {
  if (!periodSelected) {
    return (
      <div>
        <PageHeader
          title="Changelog"
          description="Post-publish edits and swap requests for this period — who changed what, when."
        />
        <EmptyState
          icon={History}
          title="No staffing period selected"
          hint="Create a staffing period first; its audit trail appears here."
        />
      </div>
    );
  }

  const pendingSwaps = swaps?.filter((s) => s.status === "pending").length ?? 0;

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Changelog"
        description="Post-publish edits and swap requests for this period — who changed what, when."
      />

      {/* Swap requests ---------------------------------------------------- */}
      <Surface className="mb-4 overflow-hidden">
        <div className="flex h-10 items-center gap-2.5 border-b border-line px-3.5">
          <ArrowLeftRight size={14} strokeWidth={1.5} className="text-muted" aria-hidden />
          <span className="text-[13px] font-medium text-ink">Swap requests</span>
          {swaps !== undefined ? (
            <span className="text-[12px] text-faint">
              {pendingSwaps > 0 ? `${pendingSwaps} pending` : "none pending"}
            </span>
          ) : null}
        </div>
        {swaps === undefined ? (
          <Spinner label="Loading swap requests…" />
        ) : swaps.length === 0 ? (
          <p className="px-3.5 py-5 text-center text-[12.5px] text-faint">
            No swap requests yet — TAs can request swaps once the schedule is published.
          </p>
        ) : (
          swaps.map((swap) => (
            <div
              key={swap._id}
              className="flex items-start gap-3 border-b border-[rgba(255,255,255,0.04)] px-3.5 py-3 last:border-b-0"
            >
              <Badge tone={SWAP_TONE[swap.status]} className="shrink-0">
                {swap.status === "pending"
                  ? "Pending"
                  : swap.status === "approved"
                    ? "Approved"
                    : "Declined"}
              </Badge>
              <div className="min-w-0 flex-1">
                <p className="text-[12.5px]">
                  <span className="font-medium">{swap.requesterName}</span>
                  <span className="text-muted"> wants out of </span>
                  <span className="font-mono text-[12px] text-[#C9C9CF]">
                    {swapShiftLabel(swap)}
                  </span>
                  {swap.suggestedTaName ? (
                    <span className="text-muted">
                      {" "}
                      · suggests <span className="text-ink">{swap.suggestedTaName}</span>
                    </span>
                  ) : null}
                </p>
                <p className="mt-0.5 truncate text-[12px] text-muted">“{swap.reason}”</p>
                {swap.assignmentGone && swap.status === "pending" ? (
                  <p className="mt-0.5 text-[11.5px] text-warn-text">
                    The assignment behind this request no longer exists.
                  </p>
                ) : null}
              </div>
              {swap.status === "pending" ? (
                <div className="flex shrink-0 items-center gap-2">
                  <Button
                    variant="primary"
                    size="sm"
                    loading={resolving === swap._id}
                    onClick={() => onResolve(swap._id, true)}
                  >
                    Approve
                  </Button>
                  <Button
                    size="sm"
                    disabled={resolving === swap._id}
                    onClick={() => onResolve(swap._id, false)}
                  >
                    Decline
                  </Button>
                </div>
              ) : (
                <span className="shrink-0 font-mono text-[11px] text-faint">
                  {formatDate(swap._creationTime)}
                </span>
              )}
            </div>
          ))
        )}
      </Surface>

      {/* Change entries ---------------------------------------------------- */}
      {entries === undefined ? (
        <Spinner label="Loading changelog…" />
      ) : entries.length === 0 ? (
        <EmptyState
          icon={History}
          title="No changes yet"
          hint="Post-publish edits — shift changes, reassignments, approved swaps — are recorded here."
        />
      ) : (
        <Surface className="overflow-hidden">
          <div className="flex h-10 items-center gap-2.5 border-b border-line px-3.5">
            <History size={14} strokeWidth={1.5} className="text-muted" aria-hidden />
            <span className="text-[13px] font-medium text-ink">Changes</span>
            <span className="text-[12px] text-faint">
              {entries.length} entr{entries.length === 1 ? "y" : "ies"} · newest first
            </span>
          </div>
          {entries.map((entry) => {
            const lines = diffLines(entry.before, entry.after);
            return (
              <div
                key={entry._id}
                className="border-b border-[rgba(255,255,255,0.04)] px-3.5 py-3 last:border-b-0"
              >
                <div className="flex items-center gap-2.5">
                  <span className="rounded-[5px] bg-[rgba(255,255,255,0.05)] px-1.5 py-0.5 font-mono text-[10.5px] text-muted">
                    {entry.action}
                  </span>
                  <span className="text-[12.5px] text-ink">
                    {ACTION_LABEL[entry.action] ?? "Change"}
                  </span>
                  <span className="text-[12px] text-faint">by {entry.actorName}</span>
                  <span className="flex-1" />
                  <span className="font-mono text-[11px] text-faint">
                    {formatDate(entry.at)} · {timeOf(entry.at)}
                  </span>
                </div>
                {lines.length > 0 ? (
                  <div className="mt-2 flex flex-col gap-0.5 pl-1">
                    {lines.map((line, i) => (
                      <p key={i} className="truncate font-mono text-[11.5px]">
                        <span className="text-faint">{line.key}: </span>
                        {line.before !== null ? (
                          <span className="text-[#f4a3ae]">{line.before}</span>
                        ) : null}
                        {line.before !== null && line.after !== null ? (
                          <span className="text-faint"> → </span>
                        ) : null}
                        {line.after !== null ? (
                          <span className="text-ok-text">{line.after}</span>
                        ) : line.before !== null ? (
                          <span className="text-faint"> → —</span>
                        ) : null}
                      </p>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </Surface>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Wired page                                                          */
/* ------------------------------------------------------------------ */

export default function Changelog() {
  const { periodId } = usePeriod();
  const entries = useQuery(api.periods.getChangelog, periodId ? { periodRef: periodId } : "skip");
  const swaps = useQuery(api.periods.listSwaps, periodId ? { periodRef: periodId } : "skip");
  const resolveSwap = useMutation(api.periods.resolveSwap);
  const [resolving, setResolving] = useState<Id<"swapRequests"> | null>(null);

  return (
    <ChangelogView
      periodSelected={periodId !== null}
      entries={periodId ? entries : undefined}
      swaps={periodId ? swaps : undefined}
      resolving={resolving}
      onResolve={(id, approve) => {
        setResolving(id);
        resolveSwap({ swapRef: id, approve })
          .then(() => toast(approve ? "Swap approved" : "Swap declined"))
          .catch((e) => toast(errorMessage(e), { tone: "error" }))
          .finally(() => setResolving(null));
      }}
    />
  );
}
