import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { CheckCheck, Clock3, Download, Flag, FlagOff, Undo2 } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import {
  Badge,
  Button,
  EmptyState,
  IconButton,
  Input,
  Label,
  Modal,
  PageHeader,
  ProgressBar,
  Select,
  Spinner,
  Surface,
  Textarea,
  Tooltip,
  toast,
  type BadgeTone,
} from "../../components/ui";
import { usePeriod } from "../../lib/period";
import { formatDate, formatHourCount, formatHours } from "../../lib/format";
import { errorMessage } from "../../lib/errorMessage";

export type HourLogRow = FunctionReturnType<typeof api.hours.list>[number];
export type TaTotalsRow = FunctionReturnType<typeof api.hours.totalsByTa>[number];
export type DutyTypeRow = FunctionReturnType<typeof api.dutyTypes.list>[number];

export type HourLogStatus = HourLogRow["status"];

const STATUS_TONE: Record<HourLogStatus, BadgeTone> = {
  draft: "neutral",
  submitted: "amber",
  approved: "green",
  flagged: "red",
};

const STATUS_LABEL: Record<HourLogStatus, string> = {
  draft: "Draft",
  submitted: "Submitted",
  approved: "Approved",
  flagged: "Flagged",
};

export interface HoursFilters {
  taProfileRef: Id<"taProfiles"> | "";
  dutyTypeRef: Id<"dutyTypes"> | "";
  weekStart: string;
  status: HourLogStatus | "";
}

const ROW_GRID =
  "grid grid-cols-[24px_84px_minmax(0,0.9fr)_104px_56px_98px_minmax(0,1fr)_minmax(0,1fr)_68px] items-center gap-2.5 px-3.5";

/* ------------------------------------------------------------------ */
/* Pure view                                                           */
/* ------------------------------------------------------------------ */

export interface HoursViewProps {
  periodSelected: boolean;
  /** undefined = loading */
  logs: HourLogRow[] | undefined;
  totals: TaTotalsRow[] | undefined;
  dutyTypes: DutyTypeRow[] | undefined;
  filters: HoursFilters;
  onFiltersChange: (f: HoursFilters) => void;
  approving: boolean;
  onBulkApprove: (ids: Id<"hourLogs">[]) => void;
  /** `editing` is true when the row was already flagged and only the reason changed. */
  onFlag: (id: Id<"hourLogs">, note: string, editing: boolean) => void;
  /** Flagged → submitted. Optional so the DEV preview harness can omit it. */
  onUnflag?: (id: Id<"hourLogs">) => void;
  /** Approved → submitted. Optional so the DEV preview harness can omit it. */
  onUnapprove?: (id: Id<"hourLogs">) => void;
  exporting: boolean;
  onExport: () => void;
}

export function HoursView({
  periodSelected,
  logs,
  totals,
  dutyTypes,
  filters,
  onFiltersChange,
  approving,
  onBulkApprove,
  onFlag,
  onUnflag,
  onUnapprove,
  exporting,
  onExport,
}: HoursViewProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [flagTarget, setFlagTarget] = useState<HourLogRow | null>(null);
  const [flagNote, setFlagNote] = useState("");

  const hasFilter =
    filters.taProfileRef !== "" ||
    filters.dutyTypeRef !== "" ||
    filters.weekStart !== "" ||
    filters.status !== "";

  const visibleIds = useMemo(() => (logs ?? []).map((l) => l.hourLogId as string), [logs]);
  const selectedVisible = visibleIds.filter((id) => selected.has(id));
  const allSelected = visibleIds.length > 0 && selectedVisible.length === visibleIds.length;

  if (!periodSelected) {
    return (
      <div>
        <PageHeader
          title="Hours"
          description="Review, approve, or flag TA hour logs, and watch totals against weekly caps."
        />
        <EmptyState
          icon={Clock3}
          title="No staffing period selected"
          hint="Hour logs belong to a staffing period — create one in Period setup first."
        />
      </div>
    );
  }

  const set = (patch: Partial<HoursFilters>) => onFiltersChange({ ...filters, ...patch });
  const totalHoursShown = (logs ?? []).reduce((n, l) => n + l.hours, 0);

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Hours"
        description="Review, approve, or flag TA hour logs, and watch totals against weekly caps."
        actions={
          <Button onClick={onExport} loading={exporting}>
            {!exporting && <Download size={14} strokeWidth={1.5} aria-hidden />}
            Export CSV
          </Button>
        }
      />

      {/* Filters */}
      <div className="mb-4 flex items-end gap-2.5">
        <div className="w-44">
          <Label htmlFor="hf-ta">TA</Label>
          <Select
            id="hf-ta"
            value={filters.taProfileRef}
            onChange={(e) => set({ taProfileRef: e.target.value as HoursFilters["taProfileRef"] })}
          >
            <option value="">All TAs</option>
            {(totals ?? []).map((t) => (
              <option key={t.taProfileRef} value={t.taProfileRef}>
                {t.taName}
              </option>
            ))}
          </Select>
        </div>
        <div className="w-44">
          <Label htmlFor="hf-duty">Duty type</Label>
          <Select
            id="hf-duty"
            value={filters.dutyTypeRef}
            onChange={(e) => set({ dutyTypeRef: e.target.value as HoursFilters["dutyTypeRef"] })}
          >
            <option value="">All duty types</option>
            {(dutyTypes ?? []).map((d) => (
              <option key={d._id} value={d._id}>
                {d.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="w-40">
          <Label htmlFor="hf-week">Week of</Label>
          <Input
            id="hf-week"
            type="date"
            value={filters.weekStart}
            onChange={(e) => set({ weekStart: e.target.value })}
            className="font-mono"
          />
        </div>
        <div className="w-36">
          <Label htmlFor="hf-status">Status</Label>
          <Select
            id="hf-status"
            value={filters.status}
            onChange={(e) => set({ status: e.target.value as HoursFilters["status"] })}
          >
            <option value="">Any status</option>
            {(Object.keys(STATUS_LABEL) as HourLogStatus[]).map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </Select>
        </div>
        {hasFilter ? (
          <Button
            variant="ghost"
            onClick={() =>
              onFiltersChange({ taProfileRef: "", dutyTypeRef: "", weekStart: "", status: "" })
            }
          >
            Clear
          </Button>
        ) : null}
      </div>

      {/* Queue */}
      {logs === undefined ? (
        <Spinner label="Loading hour logs…" />
      ) : (
        <Surface className="overflow-hidden">
          <div className="flex h-10 items-center gap-2.5 border-b border-line px-3.5">
            <span className="text-[13px] font-medium text-ink">Hour logs</span>
            <span className="font-mono text-[12px] text-faint">
              {logs.length} · {formatHourCount(totalHoursShown)}
            </span>
            <span className="flex-1" />
            <Button
              variant="primary"
              size="sm"
              disabled={selectedVisible.length === 0}
              loading={approving}
              onClick={() => {
                onBulkApprove(selectedVisible as Id<"hourLogs">[]);
                setSelected(new Set());
              }}
            >
              {!approving && <CheckCheck size={13} strokeWidth={1.5} aria-hidden />}
              Approve selected{selectedVisible.length > 0 ? ` (${selectedVisible.length})` : ""}
            </Button>
          </div>
          {logs.length === 0 ? (
            <p className="px-3.5 py-6 text-center text-[12.5px] text-faint">
              {hasFilter ? "No hour logs match these filters." : "No hour logs yet — TAs log hours once the schedule is published."}
            </p>
          ) : (
            <>
              <div
                className={`${ROW_GRID} h-8 border-b border-line text-[11px] font-medium uppercase tracking-[0.06em] text-faint`}
              >
                <input
                  type="checkbox"
                  aria-label="Select all"
                  checked={allSelected}
                  onChange={() =>
                    setSelected(allSelected ? new Set() : new Set(visibleIds))
                  }
                  className="size-3.5 cursor-pointer accent-umd"
                />
                <span>Date</span>
                <span>TA</span>
                <span>Duty</span>
                <span className="text-right">Hours</span>
                <span>Status</span>
                <span>TA note</span>
                <span>Flag reason</span>
                <span />
              </div>
              {logs.map((log) => {
                const flagged = log.status === "flagged";
                const flagReason = flagged
                  ? (log.flagNote?.trim() ?? "") || "No reason given"
                  : null;
                return (
                <div
                  key={log.hourLogId}
                  className={`${ROW_GRID} h-11 border-b border-[rgba(255,255,255,0.04)] last:border-b-0 hover:bg-[rgba(255,255,255,0.02)]`}
                >
                  <input
                    type="checkbox"
                    aria-label={`Select log from ${log.taName}`}
                    checked={selected.has(log.hourLogId)}
                    onChange={() =>
                      setSelected((prev) => {
                        const next = new Set(prev);
                        if (next.has(log.hourLogId)) next.delete(log.hourLogId);
                        else next.add(log.hourLogId);
                        return next;
                      })
                    }
                    className="size-3.5 cursor-pointer accent-umd"
                  />
                  <span className="font-mono text-[12px] text-[#C9C9CF]">
                    {formatDate(log.date)}
                  </span>
                  <span className="truncate text-[12.5px]">{log.taName}</span>
                  <span className="truncate text-[12px] text-muted">{log.dutyTypeName}</span>
                  <span className="text-right font-mono text-[12px]">
                    {formatHourCount(log.hours)}
                  </span>
                  <Badge tone={STATUS_TONE[log.status]}>{STATUS_LABEL[log.status]}</Badge>
                  {log.note ? (
                    <Tooltip label={log.note} className="min-w-0 max-w-full">
                      <span className="truncate text-[11.5px] text-faint">{log.note}</span>
                    </Tooltip>
                  ) : (
                    <span className="text-[11.5px] text-faint">—</span>
                  )}
                  {flagReason !== null ? (
                    <Tooltip label={flagReason} className="min-w-0 max-w-full">
                      <span className="inline-flex min-w-0 items-center gap-1 text-[11.5px] text-[#ff8b9b]">
                        <Flag size={14} strokeWidth={1.5} className="shrink-0" aria-hidden />
                        <span className="truncate">{flagReason}</span>
                      </span>
                    </Tooltip>
                  ) : (
                    <span className="text-[11.5px] text-faint">—</span>
                  )}
                  <div className="flex items-center justify-end gap-1">
                    <Tooltip label={flagged ? "Edit flag reason" : "Flag for follow-up"}>
                      <IconButton
                        variant="secondary"
                        aria-label={
                          flagged
                            ? `Edit flag reason for ${log.taName}'s log`
                            : `Flag log from ${log.taName}`
                        }
                        onClick={() => {
                          setFlagTarget(log);
                          setFlagNote(log.flagNote ?? "");
                        }}
                      >
                        <Flag size={16} strokeWidth={1.5} aria-hidden />
                      </IconButton>
                    </Tooltip>
                    {flagged ? (
                      <Tooltip label="Unflag — back to submitted">
                        <IconButton
                          variant="secondary"
                          aria-label={`Unflag log from ${log.taName}`}
                          onClick={() => onUnflag?.(log.hourLogId)}
                        >
                          <FlagOff size={16} strokeWidth={1.5} aria-hidden />
                        </IconButton>
                      </Tooltip>
                    ) : null}
                    {log.status === "approved" ? (
                      <Tooltip label="Unapprove — back to submitted">
                        <IconButton
                          variant="secondary"
                          aria-label={`Unapprove log from ${log.taName}`}
                          onClick={() => onUnapprove?.(log.hourLogId)}
                        >
                          <Undo2 size={16} strokeWidth={1.5} aria-hidden />
                        </IconButton>
                      </Tooltip>
                    ) : null}
                  </div>
                </div>
                );
              })}
            </>
          )}
        </Surface>
      )}

      {/* Per-TA totals vs cap */}
      {totals !== undefined && totals.length > 0 ? (
        <Surface className="mt-4 overflow-hidden">
          <div className="flex h-10 items-center gap-2.5 border-b border-line px-3.5">
            <span className="text-[13px] font-medium text-ink">Per-TA totals</span>
            <span className="text-[12px] text-faint">approved + pending vs weekly cap</span>
          </div>
          {totals.map((t) => {
            const counted = t.approvedHours + t.submittedHours;
            return (
              <div
                key={t.taProfileRef}
                className="grid h-10 grid-cols-[minmax(0,1fr)_110px_110px_90px_180px] items-center gap-2.5 border-b border-[rgba(255,255,255,0.04)] px-3.5 last:border-b-0"
              >
                <span className="truncate text-[12.5px]">{t.taName}</span>
                <span className="font-mono text-[11.5px] text-ok-text">
                  {formatHourCount(t.approvedHours)} approved
                </span>
                <span className="font-mono text-[11.5px] text-warn-text">
                  {formatHourCount(t.submittedHours)} pending
                </span>
                <span className={"font-mono text-[11.5px] " + (t.flaggedHours > 0 ? "text-[#ff8b9b]" : "text-faint")}>
                  {t.flaggedHours > 0 ? `${formatHourCount(t.flaggedHours)} flagged` : "—"}
                </span>
                <div className="flex items-center gap-2">
                  <ProgressBar value={counted} max={t.maxHoursPerWeek} className="w-24" />
                  <span
                    className={
                      "font-mono text-[11.5px] " +
                      (counted > t.maxHoursPerWeek ? "text-warn-text" : "text-muted")
                    }
                  >
                    {formatHours(counted, t.maxHoursPerWeek)}
                  </span>
                </div>
              </div>
            );
          })}
        </Surface>
      ) : null}

      {/* Flag modal */}
      <Modal
        open={flagTarget !== null}
        onClose={() => setFlagTarget(null)}
        title={flagTarget?.status === "flagged" ? "Edit flag reason" : "Flag hour log"}
        footer={
          <>
            <Button onClick={() => setFlagTarget(null)}>Cancel</Button>
            <Button
              variant="danger"
              onClick={() => {
                if (flagTarget) {
                  onFlag(flagTarget.hourLogId, flagNote.trim(), flagTarget.status === "flagged");
                }
                setFlagTarget(null);
              }}
            >
              {flagTarget?.status === "flagged" ? "Save reason" : "Flag log"}
            </Button>
          </>
        }
      >
        <p className="mb-3 text-[12.5px] text-muted">
          {flagTarget?.status === "flagged" ? "Replace the reason on " : "Flag "}
          <span className="font-medium text-ink">
            {flagTarget ? `${formatHourCount(flagTarget.hours)} · ${flagTarget.dutyTypeName}` : ""}
          </span>{" "}
          logged by <span className="font-medium text-ink">{flagTarget?.taName}</span> on{" "}
          <span className="font-mono">{flagTarget ? formatDate(flagTarget.date) : ""}</span>
          {flagTarget?.status === "flagged"
            ? ". The row stays flagged — this replaces the reason, it does not add a second flag."
            : " for follow-up."}
        </p>
        <Label htmlFor="flag-note">Reason (optional, visible to the TA)</Label>
        <Textarea
          id="flag-note"
          autoFocus
          value={flagNote}
          onChange={(e) => setFlagNote(e.target.value)}
          placeholder="e.g. double-logged — office hours were cancelled that day"
        />
      </Modal>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Wired page                                                          */
/* ------------------------------------------------------------------ */

export default function CoordinatorHours() {
  const { periodId } = usePeriod();
  const [filters, setFilters] = useState<HoursFilters>({
    taProfileRef: "",
    dutyTypeRef: "",
    weekStart: "",
    status: "",
  });
  const [approving, setApproving] = useState(false);
  const [exporting, setExporting] = useState(false);

  const logs = useQuery(
    api.hours.list,
    periodId
      ? {
          periodRef: periodId,
          taProfileRef: filters.taProfileRef === "" ? undefined : filters.taProfileRef,
          dutyTypeRef: filters.dutyTypeRef === "" ? undefined : filters.dutyTypeRef,
          weekStart: filters.weekStart === "" ? undefined : filters.weekStart,
          status: filters.status === "" ? undefined : filters.status,
        }
      : "skip",
  );
  const totals = useQuery(api.hours.totalsByTa, periodId ? { periodRef: periodId } : "skip");
  const dutyTypes = useQuery(api.dutyTypes.list, periodId ? { periodRef: periodId } : "skip");
  const bulkApprove = useMutation(api.hours.bulkApprove);
  const flag = useMutation(api.hours.flag);
  const unflag = useMutation(api.hours.unflag);
  const unapprove = useMutation(api.hours.unapprove);
  const mint = useMutation(api.exportTokens.mint);

  return (
    <HoursView
      periodSelected={periodId !== null}
      logs={periodId ? logs : undefined}
      totals={periodId ? totals : undefined}
      dutyTypes={periodId ? dutyTypes : undefined}
      filters={filters}
      onFiltersChange={setFilters}
      approving={approving}
      onBulkApprove={(ids) => {
        setApproving(true);
        bulkApprove({ hourLogIds: ids })
          .then((n) => toast(`Approved ${n} hour log${n === 1 ? "" : "s"}`))
          .catch((e) => toast(errorMessage(e), { tone: "error" }))
          .finally(() => setApproving(false));
      }}
      onFlag={(id, note, editing) => {
        flag({ hourLogId: id, note: note === "" ? undefined : note })
          .then(() => toast(editing ? "Flag reason updated" : "Hour log flagged", { tone: "info" }))
          .catch((e) => toast(errorMessage(e), { tone: "error" }));
      }}
      onUnflag={(id) => {
        unflag({ hourLogId: id })
          .then(() => toast("Flag lifted — back in the pending queue"))
          .catch((e) => toast(errorMessage(e), { tone: "error" }));
      }}
      onUnapprove={(id) => {
        unapprove({ hourLogId: id })
          .then(() => toast("Approval undone — back in the pending queue"))
          .catch((e) => toast(errorMessage(e), { tone: "error" }));
      }}
      exporting={exporting}
      onExport={() => {
        if (!periodId) return;
        const cloudUrl = import.meta.env.VITE_CONVEX_URL as string | undefined;
        if (!cloudUrl) {
          toast("VITE_CONVEX_URL is not set", { tone: "error" });
          return;
        }
        setExporting(true);
        mint({ kind: "hourlogs", periodRef: periodId })
          .then((token) => {
            const site = cloudUrl.replace(/\.convex\.cloud$/, ".convex.site");
            const url = `${site}/hour-logs.csv?token=${encodeURIComponent(token)}`;
            const a = document.createElement("a");
            a.href = url;
            a.rel = "noopener";
            document.body.appendChild(a);
            a.click();
            a.remove();
            toast("hour-logs.csv download started");
          })
          .catch((e) => toast(errorMessage(e), { tone: "error" }))
          .finally(() => setExporting(false));
      }}
    />
  );
}
