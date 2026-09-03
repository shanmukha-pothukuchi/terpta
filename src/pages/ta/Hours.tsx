/**
 * TA Hours: one-tap "Log scheduled hours" for sync assignments, a manual
 * entry row for async work, the week's log with status chips, weekly total
 * vs cap, and "Submit week" (api.ta.submitWeek).
 *
 * `HoursView` is the pure inner component (fixture-friendly for the DEV
 * preview harness); the default export wires Convex.
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Pencil,
  Plus,
  Send,
  Trash2,
  TriangleAlert,
  Undo2,
  UserRoundPlus,
} from "lucide-react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { errorMessage } from "../../lib/errorMessage";
import { usePeriod } from "../../lib/period";
import {
  formatDate,
  formatHourCount,
  formatHours,
  formatMeeting,
  formatTimeRange,
  shortShiftName,
  termName,
  type DayCode,
} from "../../lib/format";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  IconButton,
  Input,
  PageHeader,
  ProgressBar,
  Select,
  Spinner,
  Surface,
  Table,
  TBody,
  TD,
  TH,
  THead,
  Tooltip,
  TR,
  toast,
  type BadgeTone,
} from "../../components/ui";

type ScheduleResult = FunctionReturnType<typeof api.ta.getSchedule>;
export type ScheduleItem = ScheduleResult["items"][number];
type WeekResult = FunctionReturnType<typeof api.weeks.taWeek>;
export type WeekOccurrence = WeekResult["occurrences"][number];
type HourLog = FunctionReturnType<typeof api.ta.getHourLogs>[number];

/* ------------------------------------------------------------------ */
/* Date helpers (local time, ISO YYYY-MM-DD)                           */
/* ------------------------------------------------------------------ */

function toIso(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function todayIso(): string {
  return toIso(new Date());
}

/** Monday of the week containing the given ISO date. */
function mondayOf(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  const dow = d.getDay(); // 0=Sun..6=Sat
  d.setDate(d.getDate() - ((dow + 6) % 7));
  return toIso(d);
}

function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return toIso(d);
}

const DAY_INDEX: Record<DayCode, number> = { M: 0, Tu: 1, W: 2, Th: 3, F: 4 };

/** Active period for the signed-in TA (context selection, else listMine). */
function useMyTaPeriod() {
  const ctx = usePeriod();
  const mine = useQuery(api.periods.listMine, {});
  return useMemo(() => {
    if (mine === undefined) {
      return { loading: true as const, periodId: null, taProfileId: null, courseLabel: "" };
    }
    let row = ctx.periodId
      ? (mine.find((r) => r.period._id === ctx.periodId) ?? null)
      : null;
    if (!row) row = mine.find((r) => r.taProfileId !== null) ?? mine[0] ?? null;
    return {
      loading: false as const,
      periodId: row?.period._id ?? null,
      taProfileId: row?.taProfileId ?? null,
      courseLabel: row
        ? `${row.course?.courseId ?? "Course"} · ${termName(row.period.term)}`
        : "",
    };
  }, [mine, ctx.periodId]);
}

const LOG_STATUS: Record<HourLog["status"], { tone: BadgeTone; label: string }> = {
  draft: { tone: "neutral", label: "Draft" },
  submitted: { tone: "green", label: "Submitted" },
  approved: { tone: "green", label: "Approved" },
  flagged: { tone: "red", label: "Flagged" },
};

function itemLabel(item: ScheduleItem): string {
  const detail = item.shift.description
    ? shortShiftName(item.shift.description, item.dutyType.name)
    : "";
  return detail && detail !== item.dutyType.name
    ? `${item.dutyType.name} · ${detail}`
    : item.dutyType.name;
}

/* ------------------------------------------------------------------ */
/* Pure view                                                           */
/* ------------------------------------------------------------------ */

export interface HoursViewProps {
  courseLabel: string;
  published: boolean;
  items: ScheduleItem[];
  /**
   * This week as it actually is, when known: meetings handed off do not
   * appear, and meetings the TA is standing in for do. Falls back to the
   * standing roster when absent (previews).
   */
  weekOccurrences?: WeekOccurrence[];
  hourLogs: HourLog[];
  maxHoursPerWeek: number | null;
  /** ISO Monday of the visible week. */
  weekStart: string;
  onWeekChange: (weekStart: string) => void;
  onLogHours: (fields: {
    assignmentRef: string;
    date: string;
    hours: number;
    note?: string;
  }) => Promise<void>;
  onSubmitWeek: () => Promise<void>;
  submittingWeek?: boolean;
  /**
   * Fix a draft or flagged entry in place. A flagged entry drops back to
   * draft, so the TA can correct what the coordinator objected to and
   * resubmit instead of being stuck with a red badge.
   */
  onUpdateLog?: (fields: {
    hourLogId: string;
    hours: number;
    note?: string;
  }) => Promise<void>;
  /** Delete a draft or flagged entry outright. */
  onDeleteLog?: (hourLogId: string) => Promise<void>;
  /** Pull the whole week back to draft after submitting it too early. */
  onUnsubmitWeek?: () => Promise<void>;
}

export function HoursView({
  courseLabel,
  published,
  items,
  weekOccurrences,
  hourLogs,
  maxHoursPerWeek,
  weekStart,
  onWeekChange,
  onLogHours,
  onSubmitWeek,
  submittingWeek,
  onUpdateLog,
  onDeleteLog,
  onUnsubmitWeek,
}: HoursViewProps) {
  const weekEnd = addDaysIso(weekStart, 6);
  const [loggingId, setLoggingId] = useState<string | null>(null);
  // Inline edit of one row at a time; `editHours`/`editNote` mirror it.
  const [editingLogId, setEditingLogId] = useState<string | null>(null);
  const [editHours, setEditHours] = useState("");
  const [editNote, setEditNote] = useState("");
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [unsubmitting, setUnsubmitting] = useState(false);

  // Manual entry form state
  const [entryAssignment, setEntryAssignment] = useState("");
  const [entryDate, setEntryDate] = useState(todayIso());
  const [entryHours, setEntryHours] = useState("");
  const [entryNote, setEntryNote] = useState("");
  const [addingEntry, setAddingEntry] = useState(false);

  const itemByAssignment = new Map(items.map((i) => [i.assignment._id as string, i]));

  const weekLogs = hourLogs
    .filter((l) => l.date >= weekStart && l.date <= weekEnd)
    .sort((a, b) => a.date.localeCompare(b.date) || a._creationTime - b._creationTime);
  const weekTotal = weekLogs.reduce((s, l) => s + l.hours, 0);
  const draftCount = weekLogs.filter((l) => l.status === "draft").length;
  const submittedCount = weekLogs.filter((l) => l.status === "submitted").length;
  const flaggedCount = weekLogs.filter((l) => l.status === "flagged").length;
  /** Draft and flagged entries are the TA's to change; the rest are not. */
  const isEditable = (status: HourLog["status"]) =>
    status === "draft" || status === "flagged";

  const beginEdit = (log: HourLog) => {
    setEditingLogId(log._id as string);
    setEditHours(String(log.hours));
    setEditNote(log.note ?? "");
  };

  const saveEdit = async (log: HourLog) => {
    const hours = Number(editHours);
    if (!Number.isFinite(hours) || hours <= 0) {
      toast("Enter a number of hours greater than zero", { tone: "error" });
      return;
    }
    setRowBusy(log._id as string);
    try {
      await onUpdateLog?.({
        hourLogId: log._id as string,
        hours,
        note: editNote.trim() || undefined,
      });
      setEditingLogId(null);
    } finally {
      setRowBusy(null);
    }
  };

  // Sync occurrences inside this week: weekly shifts (active that week) +
  // one-off shifts dated within it.
  // One row per meeting this week. Built from the dated week when it is
  // known, because the standing roster cannot say that Tuesday was handed
  // off or that Thursday is somebody else's seat the TA is filling — and a
  // stand-in with no assignment of their own had no row at all to log from.
  const fromWeek = weekOccurrences
    ?.filter((o) => o.state !== "off" && o.assignment !== null)
    .filter((o) => o.shift.startMin !== undefined && o.shift.endMin !== undefined)
    .map((o) => {
      const s = o.shift;
      const start = s.startMin ?? 0;
      const end = s.endMin ?? 0;
      return {
        item: { assignment: o.assignment!, shift: s, dutyType: o.dutyType },
        date: o.date,
        hours: (end - start) / 60,
        when:
          s.recurrence === "once"
            ? `${formatDate(o.date)} ${formatTimeRange(start, end)}`
            : formatMeeting((o.day ?? "M") as DayCode, start, end),
        coveringFor: o.state === "covering" ? o.otherName : null,
      };
    });

  const occurrences = fromWeek ?? items
    .flatMap((item) => {
      const s = item.shift;
      if (
        s.recurrence === "weekly" &&
        s.day !== undefined &&
        s.startMin !== undefined &&
        s.endMin !== undefined
      ) {
        const date = addDaysIso(weekStart, DAY_INDEX[s.day as DayCode] ?? 0);
        if ((s.startDate ?? "0000-01-01") > weekEnd) return [];
        if ((s.endDate ?? "9999-12-31") < weekStart) return [];
        return [
          {
            item,
            date,
            hours: (s.endMin - s.startMin) / 60,
            when: formatMeeting(s.day as DayCode, s.startMin, s.endMin),
            coveringFor: null as string | null,
          },
        ];
      }
      if (
        s.recurrence === "once" &&
        s.date !== undefined &&
        s.startMin !== undefined &&
        s.endMin !== undefined &&
        s.date >= weekStart &&
        s.date <= weekEnd
      ) {
        return [
          {
            item,
            date: s.date,
            hours: (s.endMin - s.startMin) / 60,
            when: `${formatDate(s.date)} ${formatTimeRange(s.startMin, s.endMin)}`,
            coveringFor: null as string | null,
          },
        ];
      }
      return [];
    })
    .sort((a, b) => a.date.localeCompare(b.date));

  const asyncItems = items.filter(
    (i) => i.shift.recurrence === undefined && i.shift.hoursRequired !== undefined,
  );

  const logScheduled = async (occ: (typeof occurrences)[number]) => {
    const id = `${occ.item.assignment._id}:${occ.date}`;
    setLoggingId(id);
    try {
      await onLogHours({
        assignmentRef: occ.item.assignment._id,
        date: occ.date,
        hours: occ.hours,
      });
      toast(`Logged ${formatHourCount(occ.hours)} — ${itemLabel(occ.item)}`);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not log hours", { tone: "error" });
    } finally {
      setLoggingId(null);
    }
  };

  const addManualEntry = async () => {
    const hours = Number(entryHours);
    if (!entryAssignment) {
      toast("Pick an assignment first", { tone: "error" });
      return;
    }
    if (!(hours > 0) || hours > 24) {
      toast("Hours must be between 0 and 24", { tone: "error" });
      return;
    }
    setAddingEntry(true);
    try {
      await onLogHours({
        assignmentRef: entryAssignment,
        date: entryDate,
        hours,
        note: entryNote.trim() || undefined,
      });
      toast(`Logged ${formatHourCount(hours)}`);
      setEntryHours("");
      setEntryNote("");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not log hours", { tone: "error" });
    } finally {
      setAddingEntry(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Hours"
        description={courseLabel || undefined}
        actions={
          published ? (
            <>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label="Previous week"
                  onClick={() => onWeekChange(addDaysIso(weekStart, -7))}
                >
                  <ChevronLeft size={14} strokeWidth={1.5} />
                </Button>
                <span className="w-[118px] text-center font-mono text-[12.5px] text-ink">
                  Week of {formatDate(weekStart)}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label="Next week"
                  onClick={() => onWeekChange(addDaysIso(weekStart, 7))}
                >
                  <ChevronRight size={14} strokeWidth={1.5} />
                </Button>
              </div>
              {/* Submitting is not a one-way door: pull the week back while
                  the coordinator has not approved any of it yet. */}
              {submittedCount > 0 && onUnsubmitWeek ? (
                <Button
                  variant="secondary"
                  loading={unsubmitting}
                  onClick={() => {
                    setUnsubmitting(true);
                    void onUnsubmitWeek().finally(() => setUnsubmitting(false));
                  }}
                >
                  <Undo2 size={14} strokeWidth={1.5} aria-hidden />
                  Unsubmit week
                </Button>
              ) : null}
              <Button
                variant="primary"
                onClick={() => void onSubmitWeek()}
                loading={submittingWeek}
                disabled={draftCount === 0}
              >
                <Send size={14} strokeWidth={1.5} aria-hidden />
                Submit week
              </Button>
            </>
          ) : undefined
        }
      />

      {!published ? (
        <EmptyState
          icon={Clock3}
          title="Nothing to log yet"
          hint="Hour logging opens once the coordinator publishes the schedule."
        />
      ) : (
        <>
          {/* Weekly total vs cap */}
          <Surface className="flex items-center gap-4 px-4 py-3">
            <div className="flex items-baseline gap-1.5">
              <span className="font-mono text-[18px] font-medium text-ink">
                {maxHoursPerWeek !== null
                  ? formatHours(weekTotal, maxHoursPerWeek)
                  : formatHourCount(weekTotal)}
              </span>
              <span className="text-[12px] text-muted">logged this week</span>
            </div>
            {maxHoursPerWeek !== null ? (
              <ProgressBar value={weekTotal} max={maxHoursPerWeek} className="max-w-56 flex-1" />
            ) : null}
            <span className="ml-auto text-[12px] text-faint">
              {flaggedCount > 0
                ? `${flaggedCount} flagged ${flaggedCount === 1 ? "entry" : "entries"} to fix`
                : draftCount === 0
                  ? "All entries submitted"
                  : `${draftCount} draft ${draftCount === 1 ? "entry" : "entries"} to submit`}
            </span>
          </Surface>

          {/* One-tap scheduled logging */}
          <Card title="Scheduled this week">
            {occurrences.length === 0 ? (
              <p className="text-[12.5px] text-faint">No sync shifts fall in this week.</p>
            ) : (
              <div className="flex flex-col gap-1.5">
                {occurrences.map((occ) => {
                  const id = `${occ.item.assignment._id}:${occ.date}`;
                  const alreadyLogged = hourLogs.some(
                    (l) => l.assignmentRef === occ.item.assignment._id && l.date === occ.date,
                  );
                  return (
                    <div
                      key={id}
                      className="flex h-10 items-center gap-3 rounded-[9px] border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)] px-2.5"
                    >
                      <span className="w-32 shrink-0 font-mono text-[12px] text-muted">
                        {occ.when}
                      </span>
                      <span className="min-w-0 truncate text-[12.5px] text-ink">
                        {itemLabel(occ.item)}
                        {occ.coveringFor ? (
                          <span className="text-ok-text"> · covering for {occ.coveringFor}</span>
                        ) : null}
                      </span>
                      <span className="ml-auto shrink-0 font-mono text-[12px] text-muted">
                        {formatHourCount(occ.hours)}
                      </span>
                      {alreadyLogged ? (
                        <span className="inline-flex shrink-0 items-center gap-1 text-[12px] text-ok-text">
                          <Check size={13} strokeWidth={1.5} aria-hidden />
                          Logged
                        </span>
                      ) : (
                        <Button
                          variant="secondary"
                          size="sm"
                          className="shrink-0"
                          loading={loggingId === id}
                          onClick={() => void logScheduled(occ)}
                        >
                          Log scheduled hours
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </Card>

          {/* Manual / async entry */}
          <Card title="Manual entry">
            <div className="flex flex-wrap items-center gap-2">
              <Select
                aria-label="Assignment"
                value={entryAssignment}
                onChange={(e) => setEntryAssignment(e.target.value)}
                className="w-56"
              >
                <option value="">Pick an assignment…</option>
                {asyncItems.length > 0 ? (
                  <optgroup label="Async">
                    {asyncItems.map((i) => (
                      <option key={i.assignment._id} value={i.assignment._id}>
                        {itemLabel(i)}
                      </option>
                    ))}
                  </optgroup>
                ) : null}
                <optgroup label="Sync">
                  {items
                    .filter((i) => i.shift.recurrence !== undefined)
                    .map((i) => (
                      <option key={i.assignment._id} value={i.assignment._id}>
                        {itemLabel(i)}
                      </option>
                    ))}
                </optgroup>
              </Select>
              <Input
                type="date"
                aria-label="Date"
                value={entryDate}
                onChange={(e) => setEntryDate(e.target.value)}
                className="w-38 font-mono"
              />
              <Input
                type="number"
                aria-label="Hours"
                min={0.5}
                max={24}
                step={0.5}
                placeholder="Hours"
                value={entryHours}
                onChange={(e) => setEntryHours(e.target.value)}
                className="w-24 font-mono"
              />
              <Input
                aria-label="Note"
                placeholder="Note (optional)"
                value={entryNote}
                onChange={(e) => setEntryNote(e.target.value)}
                className="min-w-40 flex-1"
              />
              <Button
                variant="secondary"
                onClick={() => void addManualEntry()}
                loading={addingEntry}
              >
                <Plus size={14} strokeWidth={1.5} aria-hidden />
                Add entry
              </Button>
            </div>
          </Card>

          {/* Week log */}
          <Surface className="overflow-hidden">
            <Table>
              <THead>
                <TR>
                  <TH className="w-24">Date</TH>
                  <TH>Assignment</TH>
                  <TH className="w-20">Hours</TH>
                  <TH className="w-32">Status</TH>
                  <TH>Note</TH>
                  <TH className="w-24 text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {weekLogs.length === 0 ? (
                  <TR>
                    <TD colSpan={6} className="py-6 text-center text-faint">
                      No hours logged this week.
                    </TD>
                  </TR>
                ) : (
                  weekLogs.map((log) => {
                    const item = itemByAssignment.get(log.assignmentRef);
                    const status = LOG_STATUS[log.status];
                    const id = log._id as string;
                    const editing = editingLogId === id;
                    const busy = rowBusy === id;
                    return (
                      <TR key={log._id}>
                        <TD className="font-mono text-[12px]">{formatDate(log.date)}</TD>
                        <TD>{item ? itemLabel(item) : "—"}</TD>
                        <TD className="font-mono text-[12px]">
                          {editing ? (
                            <Input
                              type="number"
                              step="0.25"
                              min="0.25"
                              aria-label="Hours"
                              value={editHours}
                              onChange={(e) => setEditHours(e.target.value)}
                              className="h-7 w-20 text-[12px]"
                            />
                          ) : (
                            formatHourCount(log.hours)
                          )}
                        </TD>
                        <TD>
                          <Badge tone={status.tone}>{status.label}</Badge>
                        </TD>
                        <TD className="text-muted">
                          {editing ? (
                            <Input
                              aria-label="Note"
                              value={editNote}
                              onChange={(e) => setEditNote(e.target.value)}
                              placeholder="Note"
                              className="h-7 text-[12px]"
                            />
                          ) : (
                            <div className="flex min-w-0 flex-col gap-0.5">
                              <span className="truncate">{log.note ?? ""}</span>
                              {/* Why it was flagged, so the fix is obvious. */}
                              {log.status === "flagged" && log.flagNote ? (
                                <span className="flex items-start gap-1 text-[12px] text-[#F4A3AE]">
                                  <TriangleAlert
                                    size={12}
                                    strokeWidth={1.5}
                                    className="mt-[2px] shrink-0"
                                    aria-hidden
                                  />
                                  <span className="min-w-0">{log.flagNote}</span>
                                </span>
                              ) : null}
                            </div>
                          )}
                        </TD>
                        <TD>
                          {isEditable(log.status) && onUpdateLog ? (
                            <div className="flex items-center justify-end gap-1">
                              {editing ? (
                                <>
                                  <Button
                                    variant="secondary"
                                    size="sm"
                                    loading={busy}
                                    onClick={() => void saveEdit(log)}
                                  >
                                    Save
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setEditingLogId(null)}
                                  >
                                    Cancel
                                  </Button>
                                </>
                              ) : (
                                <>
                                  <Tooltip
                                    label={
                                      log.status === "flagged"
                                        ? "Fix and return to draft"
                                        : "Edit this entry"
                                    }
                                  >
                                    <IconButton
                                      onClick={() => beginEdit(log)}
                                      aria-label={`Edit ${formatDate(log.date)} entry`}
                                    >
                                      <Pencil size={16} strokeWidth={1.5} aria-hidden />
                                    </IconButton>
                                  </Tooltip>
                                  {onDeleteLog ? (
                                    <Tooltip label="Delete this entry">
                                      <IconButton
                                        variant="danger"
                                        disabled={busy}
                                        onClick={() => {
                                          setRowBusy(id);
                                          void onDeleteLog(id).finally(() =>
                                            setRowBusy(null),
                                          );
                                        }}
                                        aria-label={`Delete ${formatDate(log.date)} entry`}
                                      >
                                        <Trash2 size={16} strokeWidth={1.5} aria-hidden />
                                      </IconButton>
                                    </Tooltip>
                                  ) : null}
                                </>
                              )}
                            </div>
                          ) : (
                            <span className="block text-right text-[12px] text-faint">
                              {log.status === "approved" ? "Locked" : ""}
                            </span>
                          )}
                        </TD>
                      </TR>
                    );
                  })
                )}
              </TBody>
            </Table>
          </Surface>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Wired page                                                          */
/* ------------------------------------------------------------------ */

export default function TaHours() {
  const pick = useMyTaPeriod();
  const schedule = useQuery(
    api.ta.getSchedule,
    pick.taProfileId ? { taProfileRef: pick.taProfileId } : "skip",
  );
  const hourLogs = useQuery(
    api.ta.getHourLogs,
    pick.taProfileId ? { taProfileRef: pick.taProfileId } : "skip",
  );
  const profile = useQuery(
    api.ta.getProfile,
    pick.periodId ? { periodRef: pick.periodId } : "skip",
  );
  const logHours = useMutation(api.ta.logHours);
  const submitWeek = useMutation(api.ta.submitWeek);
  const updateHourLog = useMutation(api.ta.updateHourLog);
  const deleteHourLog = useMutation(api.ta.deleteHourLog);
  const unsubmitWeek = useMutation(api.ta.unsubmitWeek);

  const [weekStart, setWeekStart] = useState(() => mondayOf(todayIso()));
  const [submitting, setSubmitting] = useState(false);
  const week = useQuery(
    api.weeks.taWeek,
    pick.taProfileId ? { taProfileRef: pick.taProfileId, weekStart } : "skip",
  );

  if (pick.loading) {
    return (
      <div>
        <PageHeader title="Hours" />
        <Spinner label="Loading your hours…" />
      </div>
    );
  }

  if (!pick.taProfileId) {
    return (
      <div>
        <PageHeader title="Hours" />
        <EmptyState
          icon={UserRoundPlus}
          title="You're not part of a course yet"
          hint="Ask your coordinator for an invite, then finish setup under Preferences."
        />
      </div>
    );
  }

  if (schedule === undefined || hourLogs === undefined || profile === undefined) {
    return (
      <div>
        <PageHeader title="Hours" description={pick.courseLabel} />
        <Spinner label="Loading your hours…" />
      </div>
    );
  }

  const handleSubmitWeek = async () => {
    if (!pick.taProfileId) return;
    setSubmitting(true);
    try {
      const n = await submitWeek({ taProfileRef: pick.taProfileId, weekStart });
      toast(
        n === 0
          ? "Nothing to submit this week"
          : `${n} ${n === 1 ? "entry" : "entries"} submitted for review`,
      );
    } catch (err) {
      toast(err instanceof Error ? err.message : "Submit failed", { tone: "error" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <HoursView
      courseLabel={pick.courseLabel}
      published={schedule.published}
      items={schedule.items}
      weekOccurrences={week?.occurrences}
      hourLogs={hourLogs}
      maxHoursPerWeek={profile?.maxHoursPerWeek ?? null}
      weekStart={weekStart}
      onWeekChange={setWeekStart}
      onLogHours={async ({ assignmentRef, date, hours, note }) => {
        await logHours({
          assignmentRef: assignmentRef as Id<"assignments">,
          date,
          hours,
          note,
        });
      }}
      onSubmitWeek={handleSubmitWeek}
      submittingWeek={submitting}
      onUpdateLog={async ({ hourLogId, hours, note }) => {
        try {
          await updateHourLog({
            hourLogRef: hourLogId as Id<"hourLogs">,
            hours,
            note,
          });
          toast("Entry updated — back to draft");
        } catch (e) {
          toast(errorMessage(e), { tone: "error" });
        }
      }}
      onDeleteLog={async (hourLogId) => {
        try {
          await deleteHourLog({ hourLogRef: hourLogId as Id<"hourLogs"> });
          toast("Entry deleted");
        } catch (e) {
          toast(errorMessage(e), { tone: "error" });
        }
      }}
      onUnsubmitWeek={async () => {
        if (!pick.taProfileId) return;
        try {
          const n = await unsubmitWeek({
            taProfileRef: pick.taProfileId,
            weekStart,
          });
          toast(
            n === 0
              ? "Nothing to pull back — those entries are already approved"
              : `${n} ${n === 1 ? "entry" : "entries"} back to draft`,
            { tone: n === 0 ? "error" : "success" },
          );
        } catch (e) {
          toast(errorMessage(e), { tone: "error" });
        }
      }}
    />
  );
}
