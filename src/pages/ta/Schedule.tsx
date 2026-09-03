/**
 * My Schedule (TA): published weekly grid, upcoming one-off events, async
 * work with logged/remaining bars, weekly hours vs cap, "Add to calendar"
 * (signed .ics link), and per-assignment swap requests.
 *
 * `ScheduleView` is the pure inner component (fixture-friendly for the DEV
 * preview harness); the default export wires Convex.
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import {
  ArrowLeftRight,
  CalendarClock,
  CalendarDays,
  CalendarPlus,
  Inbox,
  UserRoundPlus,
} from "lucide-react";
import { api } from "../../../convex/_generated/api";
import { usePeriod } from "../../lib/period";
import {
  formatDate,
  formatHourCount,
  formatHours,
  formatMeeting,
  formatTimeRange,
  DAY_CODES,
  DAY_SHORT,
  type DayCode,
} from "../../lib/format";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  PageHeader,
  ProgressBar,
  Spinner,
  toast,
} from "../../components/ui";
import SwapRequestModal, { type SwapModalTarget } from "./SwapRequestModal";

type ScheduleResult = FunctionReturnType<typeof api.ta.getSchedule>;
export type ScheduleItem = ScheduleResult["items"][number];
type HourLog = FunctionReturnType<typeof api.ta.getHourLogs>[number];

export interface PendingSwap {
  id: string;
  label: string;
  reason: string;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function hexToRgba(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return `rgba(125,147,178,${alpha})`;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

function hourLabel(h: number, isFirst: boolean): string {
  const h12 = h % 12 === 0 ? 12 : h % 12;
  if (isFirst) return `${h12} ${h < 12 ? "AM" : "PM"}`;
  if (h === 12) return "12 PM";
  return String(h12);
}

function todayIso(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** "202608" -> "Fall 2026" (best effort). */
function termName(term: string): string {
  const y = term.slice(0, 4);
  const season =
    { "01": "Spring", "05": "Summer", "08": "Fall", "12": "Winter" }[term.slice(4)] ?? "";
  return season ? `${season} ${y}` : term;
}

/** Active period for the signed-in TA: context selection, else first period
 *  where they have a profile (api.periods.listMine). */
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

function swapTargetFor(item: ScheduleItem): SwapModalTarget {
  const label =
    item.shift.description && item.shift.description !== item.dutyType.name
      ? `${item.dutyType.name} — ${item.shift.description}`
      : item.dutyType.name;
  let detail: string | undefined;
  if (
    item.shift.recurrence === "weekly" &&
    item.shift.day !== undefined &&
    item.shift.startMin !== undefined &&
    item.shift.endMin !== undefined
  ) {
    detail = formatMeeting(item.shift.day, item.shift.startMin, item.shift.endMin);
  } else if (
    item.shift.recurrence === "once" &&
    item.shift.date !== undefined &&
    item.shift.startMin !== undefined &&
    item.shift.endMin !== undefined
  ) {
    detail = `${formatDate(item.shift.date)} ${formatTimeRange(item.shift.startMin, item.shift.endMin)}`;
  } else if (item.shift.hoursRequired !== undefined) {
    detail = `${formatHourCount(item.assignment.hoursAllocated ?? item.shift.hoursRequired)} async`;
  }
  return { assignmentRef: item.assignment._id, label, detail };
}

/* ------------------------------------------------------------------ */
/* Weekly grid                                                         */
/* ------------------------------------------------------------------ */

const SLOT_PX = 22; // px per 30 minutes (board recipe)

function WeeklyGrid({
  items,
  onRequestSwap,
}: {
  items: ScheduleItem[];
  onRequestSwap: (t: SwapModalTarget) => void;
}) {
  const weekly = items.filter(
    (i) =>
      i.shift.recurrence === "weekly" &&
      i.shift.day !== undefined &&
      i.shift.startMin !== undefined &&
      i.shift.endMin !== undefined,
  );

  let rangeStart = 8 * 60;
  let rangeEnd = 20 * 60;
  for (const i of weekly) {
    rangeStart = Math.min(rangeStart, Math.floor((i.shift.startMin ?? rangeStart) / 60) * 60);
    rangeEnd = Math.max(rangeEnd, Math.ceil((i.shift.endMin ?? rangeEnd) / 60) * 60);
  }
  const slots = (rangeEnd - rangeStart) / 30;
  const hours: number[] = [];
  for (let h = rangeStart / 60; h < rangeEnd / 60; h++) hours.push(h);

  const byDay = new Map<DayCode, ScheduleItem[]>();
  for (const d of DAY_CODES) byDay.set(d, []);
  for (const i of weekly) byDay.get(i.shift.day as DayCode)?.push(i);

  return (
    <div className="overflow-hidden rounded-[12px] border border-line bg-surface">
      {/* Day header */}
      <div className="grid h-[34px] grid-cols-[56px_repeat(5,1fr)] items-center border-b border-line">
        <div />
        {DAY_CODES.map((d) => {
          const dayItems = byDay.get(d) ?? [];
          const total = dayItems.reduce(
            (s, i) => s + ((i.shift.endMin ?? 0) - (i.shift.startMin ?? 0)) / 60,
            0,
          );
          return (
            <div
              key={d}
              className="border-l border-[rgba(255,255,255,0.06)] pl-2.5 text-[12.5px] font-medium text-[#C9C9CF]"
            >
              {DAY_SHORT[d]}
              {total > 0 ? (
                <span className="ml-1.5 font-mono text-[12px] font-normal text-faint">
                  {formatHourCount(total)}
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
      {/* Body */}
      <div className="grid grid-cols-[56px_repeat(5,1fr)]">
        <div className="relative">
          {hours.map((h, idx) => (
            <div
              key={h}
              className="box-border pr-2 pt-[3px] text-right font-mono text-[10.5px] text-faint"
              style={{ height: SLOT_PX * 2 }}
            >
              {hourLabel(h, idx === 0)}
            </div>
          ))}
        </div>
        {DAY_CODES.map((d) => (
          <div key={d} className="relative border-l border-[rgba(255,255,255,0.06)]">
            {Array.from({ length: slots }, (_, s) => (
              <div
                key={s}
                className="box-border"
                style={{
                  height: SLOT_PX,
                  borderBottom: `1px solid ${s % 2 ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.035)"}`,
                }}
              />
            ))}
            {(byDay.get(d) ?? []).map((item) => {
              const start = item.shift.startMin ?? rangeStart;
              const end = item.shift.endMin ?? start + 30;
              const top = ((start - rangeStart) / 30) * SLOT_PX + 1;
              const height = ((end - start) / 30) * SLOT_PX - 3;
              const color = item.dutyType.color || "#7d93b2";
              return (
                <div
                  key={item.assignment._id}
                  className="group absolute right-1 left-1 box-border overflow-hidden rounded-[6px] px-2 py-[5px]"
                  style={{
                    top,
                    height,
                    background: hexToRgba(color, 0.16),
                    boxShadow: `inset 0 0 0 1px ${hexToRgba(color, 0.35)}`,
                  }}
                >
                  <div className="flex flex-col gap-px">
                    <span className="truncate text-[11px] font-medium text-ink">
                      {item.dutyType.name}
                    </span>
                    {height >= 34 ? (
                      <span className="truncate font-mono text-[10.5px]" style={{ color }}>
                        {formatTimeRange(start, end)}
                        {item.shift.description ? ` · ${item.shift.description}` : ""}
                      </span>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    onClick={() => onRequestSwap(swapTargetFor(item))}
                    title="Request swap"
                    aria-label={`Request swap for ${item.dutyType.name}`}
                    className="absolute top-1 right-1 grid size-5 cursor-pointer place-items-center rounded-[5px] bg-black/30 text-muted opacity-0 transition-opacity duration-100 group-hover:opacity-100 hover:bg-black/50 hover:text-ink"
                  >
                    <ArrowLeftRight size={11} strokeWidth={1.5} />
                  </button>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Pure view                                                           */
/* ------------------------------------------------------------------ */

export interface ScheduleViewProps {
  courseLabel: string;
  published: boolean;
  items: ScheduleItem[];
  hourLogs: HourLog[];
  maxHoursPerWeek: number | null;
  pendingSwaps: PendingSwap[];
  onRequestSwap: (target: SwapModalTarget) => void;
  onAddToCalendar?: () => void;
  addingToCalendar?: boolean;
}

export function ScheduleView({
  courseLabel,
  published,
  items,
  hourLogs,
  maxHoursPerWeek,
  pendingSwaps,
  onRequestSwap,
  onAddToCalendar,
  addingToCalendar,
}: ScheduleViewProps) {
  const today = todayIso();

  const weeklyHours = items
    .filter((i) => i.shift.recurrence === "weekly")
    .reduce((s, i) => s + ((i.shift.endMin ?? 0) - (i.shift.startMin ?? 0)) / 60, 0);

  const onceItems = items
    .filter((i) => i.shift.recurrence === "once" && (i.shift.date ?? "") >= today)
    .sort((a, b) =>
      (a.shift.date ?? "").localeCompare(b.shift.date ?? "") ||
      (a.shift.startMin ?? 0) - (b.shift.startMin ?? 0),
    );

  const asyncItems = items.filter(
    (i) => i.shift.recurrence === undefined && i.shift.hoursRequired !== undefined,
  );

  const loggedByAssignment = new Map<string, number>();
  for (const log of hourLogs) {
    loggedByAssignment.set(
      log.assignmentRef,
      (loggedByAssignment.get(log.assignmentRef) ?? 0) + log.hours,
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="My Schedule"
        description={courseLabel || undefined}
        actions={
          <>
            {published && maxHoursPerWeek !== null ? (
              <div className="flex h-8 items-center gap-2 rounded-[9px] border border-line bg-[rgba(255,255,255,0.03)] px-3">
                <span className="font-mono text-[12.5px] text-ink">
                  {formatHours(weeklyHours, maxHoursPerWeek)}
                </span>
                <span className="text-[12px] text-faint">per week</span>
                <ProgressBar value={weeklyHours} max={maxHoursPerWeek} className="w-16" />
              </div>
            ) : null}
            <Button
              variant="secondary"
              onClick={onAddToCalendar}
              disabled={!published || !onAddToCalendar}
              loading={addingToCalendar}
            >
              <CalendarPlus size={14} strokeWidth={1.5} aria-hidden />
              Add to calendar
            </Button>
          </>
        }
      />

      {!published ? (
        <EmptyState
          icon={CalendarClock}
          title="No schedule yet"
          hint="Your schedule appears when the coordinator publishes."
        />
      ) : items.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title="No assignments"
          hint="The schedule is published, but nothing is assigned to you in this period."
        />
      ) : (
        <>
          <WeeklyGrid items={items} onRequestSwap={onRequestSwap} />

          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Upcoming events">
              {onceItems.length === 0 ? (
                <p className="text-[12.5px] text-faint">No one-off events coming up.</p>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {onceItems.map((item) => (
                    <div
                      key={item.assignment._id}
                      className="flex h-9 items-center gap-3 rounded-[9px] border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)] px-2.5"
                    >
                      <CalendarDays size={14} strokeWidth={1.5} className="shrink-0 text-muted" aria-hidden />
                      <span className="w-14 shrink-0 font-mono text-[12.5px] text-ink">
                        {formatDate(item.shift.date ?? "")}
                      </span>
                      <span className="min-w-0 truncate text-[12.5px] text-ink">
                        {item.dutyType.name}
                        {item.shift.description ? (
                          <span className="text-muted"> · {item.shift.description}</span>
                        ) : null}
                      </span>
                      <span className="ml-auto shrink-0 font-mono text-[12px] text-muted">
                        {item.shift.startMin !== undefined && item.shift.endMin !== undefined
                          ? formatTimeRange(item.shift.startMin, item.shift.endMin)
                          : ""}
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onRequestSwap(swapTargetFor(item))}
                        className="shrink-0"
                      >
                        <ArrowLeftRight size={12} strokeWidth={1.5} aria-hidden />
                        Swap
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            <Card title="Async work">
              {asyncItems.length === 0 ? (
                <p className="text-[12.5px] text-faint">No async duties assigned.</p>
              ) : (
                <div className="flex flex-col gap-2.5">
                  {asyncItems.map((item) => {
                    const allocated =
                      item.assignment.hoursAllocated ?? item.shift.hoursRequired ?? 0;
                    const logged = loggedByAssignment.get(item.assignment._id) ?? 0;
                    return (
                      <div
                        key={item.assignment._id}
                        className="rounded-[9px] border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)] px-3 py-2.5"
                      >
                        <div className="flex items-center gap-2">
                          <span className="min-w-0 truncate text-[12.5px] font-medium text-ink">
                            {item.dutyType.name}
                            {item.shift.description ? (
                              <span className="font-normal text-muted">
                                {" "}· {item.shift.description}
                              </span>
                            ) : null}
                          </span>
                          {item.shift.dueDate ? (
                            <span className="ml-auto shrink-0 font-mono text-[12px] text-muted">
                              due {formatDate(item.shift.dueDate)}
                            </span>
                          ) : (
                            <span className="ml-auto" />
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => onRequestSwap(swapTargetFor(item))}
                            className="shrink-0"
                          >
                            <ArrowLeftRight size={12} strokeWidth={1.5} aria-hidden />
                            Swap
                          </Button>
                        </div>
                        <div className="mt-2 flex items-center gap-2.5">
                          <ProgressBar
                            value={logged}
                            max={allocated}
                            tone={logged >= allocated ? "ok" : "neutral"}
                            className="flex-1"
                          />
                          <span className="shrink-0 font-mono text-[11.5px] text-muted">
                            {formatHours(logged, allocated)} logged
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          </div>

          <Card title="Swap requests">
            {pendingSwaps.length === 0 ? (
              <p className="text-[12.5px] text-faint">No pending swap requests.</p>
            ) : (
              <div className="flex flex-col gap-1.5">
                {pendingSwaps.map((s) => (
                  <div
                    key={s.id}
                    className="flex h-9 items-center gap-3 rounded-[9px] border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)] px-2.5"
                  >
                    <ArrowLeftRight size={14} strokeWidth={1.5} className="shrink-0 text-muted" aria-hidden />
                    <span className="shrink-0 text-[12.5px] font-medium text-ink">{s.label}</span>
                    <span className="min-w-0 truncate text-[12.5px] text-muted">{s.reason}</span>
                    <Badge tone="amber" className="ml-auto shrink-0">
                      Pending
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Wired page                                                          */
/* ------------------------------------------------------------------ */

export default function TaSchedule() {
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
  const mint = useMutation(api.exportTokens.mint);

  const [swapTarget, setSwapTarget] = useState<SwapModalTarget | null>(null);
  const [swapOpen, setSwapOpen] = useState(false);
  // No backend query lists a TA's own swap requests yet, so successful
  // requests from this session are tracked locally.
  const [pendingSwaps, setPendingSwaps] = useState<PendingSwap[]>([]);
  const [minting, setMinting] = useState(false);

  if (pick.loading) {
    return (
      <div>
        <PageHeader title="My Schedule" />
        <Spinner label="Loading your schedule…" />
      </div>
    );
  }

  if (!pick.taProfileId) {
    return (
      <div>
        <PageHeader title="My Schedule" />
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
        <PageHeader title="My Schedule" description={pick.courseLabel} />
        <Spinner label="Loading your schedule…" />
      </div>
    );
  }

  const addToCalendar = async () => {
    if (!pick.taProfileId) return;
    setMinting(true);
    try {
      const token = await mint({ kind: "schedule", taProfileRef: pick.taProfileId });
      const env = import.meta.env as Record<string, string | undefined>;
      const base =
        env.VITE_CONVEX_SITE_URL ??
        (env.VITE_CONVEX_URL ?? "").replace(".convex.cloud", ".convex.site");
      window.open(
        `${base}/schedule.ics?token=${encodeURIComponent(token)}`,
        "_blank",
        "noopener",
      );
      toast("Calendar file ready — check your downloads");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not create calendar link", {
        tone: "error",
      });
    } finally {
      setMinting(false);
    }
  };

  return (
    <>
      <ScheduleView
        courseLabel={pick.courseLabel}
        published={schedule.published}
        items={schedule.items}
        hourLogs={hourLogs}
        maxHoursPerWeek={profile?.maxHoursPerWeek ?? null}
        pendingSwaps={pendingSwaps}
        onRequestSwap={(t) => {
          setSwapTarget(t);
          setSwapOpen(true);
        }}
        onAddToCalendar={() => void addToCalendar()}
        addingToCalendar={minting}
      />
      <SwapRequestModal
        open={swapOpen}
        onClose={() => setSwapOpen(false)}
        target={swapTarget}
        onRequested={({ reason }) => {
          if (!swapTarget) return;
          setPendingSwaps((prev) => [
            ...prev,
            { id: `${swapTarget.assignmentRef}:${Date.now()}`, label: swapTarget.label, reason },
          ]);
        }}
      />
    </>
  );
}
