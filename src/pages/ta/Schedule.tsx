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
  CalendarOff,
  CalendarPlus,
  Inbox,
  UserRoundCheck,
  UserRoundPlus,
  X,
} from "lucide-react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { errorMessage } from "../../lib/errorMessage";
import { usePeriod } from "../../lib/period";
import { useHiddenIds } from "../../lib/viewFilter";
import { DutyFilterBar, type DutyFilterItem } from "../../components/DutyFilterBar";
import { assignLanes, laneStyle, type LaneSpan } from "../../lib/lanes";
import {
  formatDate,
  formatHourCount,
  formatHours,
  formatMeeting,
  formatTimeRange,
  shortShiftName,
  termName,
  DAY_CODES,
  DAY_SHORT,
  type DayCode,
} from "../../lib/format";
import {
  Badge,
  type BadgeTone,
  Button,
  Card,
  EmptyState,
  IconButton,
  Modal,
  PageHeader,
  ProgressBar,
  Spinner,
  Tooltip,
  toast,
} from "../../components/ui";
import { WeekNav } from "../../components/WeekNav";
import {
  dateOfDayInWeek,
  dayOfIso,
  mondayOf,

  weeklyShiftRunsInWeek,
  thisMonday,
  todayIso,
  weekRange,
} from "../../lib/week";
import SwapRequestModal, { type SwapModalTarget } from "./SwapRequestModal";
import { CalendarFeed } from "../../components/CalendarFeed";

type ScheduleResult = FunctionReturnType<typeof api.ta.getSchedule>;
export type ScheduleItem = ScheduleResult["items"][number];
type HourLog = FunctionReturnType<typeof api.ta.getHourLogs>[number];

/**
 * One of the caller's swap requests, as `api.ta.listMySwaps` returns it.
 * Previously this list lived in React state, so a request the coordinator had
 * already resolved kept reading "Pending" until the page was reloaded.
 */
export interface PendingSwap {
  id: string;
  label: string;
  reason: string;
  status: "pending" | "approved" | "declined" | "cancelled";
  scope: "date" | "permanent";
  /** ISO date, set when `scope` is "date". */
  date?: string;
  suggestedName?: string;
}

/** One-off coverage the TA is either taking or handing off. */
export interface CoverageNotice {
  id: string;
  date: string;
  label: string;
  role: "covering" | "off";
  otherName: string | null;
}

const SWAP_TONE: Record<PendingSwap["status"], BadgeTone> = {
  pending: "amber",
  approved: "green",
  declined: "red",
  cancelled: "neutral",
};

const SWAP_LABEL: Record<PendingSwap["status"], string> = {
  pending: "Pending",
  approved: "Approved",
  declined: "Declined",
  cancelled: "Withdrawn",
};

/** "Just Tue Oct 7" vs "Rest of the term" — the duration, said plainly. */
export function swapDurationLabel(swap: PendingSwap): string {
  if (swap.scope !== "date") return "Rest of the term";
  return swap.date ? `Just ${formatIsoDate(swap.date)}` : "One date";
}

/** "2026-10-07" -> "Tue Oct 7". Local-time parse; see convex/coverage.ts. */
export function formatIsoDate(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString(
    undefined,
    { weekday: "short", month: "short", day: "numeric" },
  );
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
  const shortName = item.shift.description
    ? shortShiftName(item.shift.description, item.dutyType.name)
    : "";
  const label =
    shortName && shortName !== item.dutyType.name
      ? `${item.dutyType.name} — ${shortName}`
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
  return {
    assignmentRef: item.assignment._id,
    label,
    detail,
    day: item.shift.recurrence === "weekly" ? item.shift.day : undefined,
    onceDate: item.shift.recurrence === "once" ? item.shift.date : undefined,
  };
}

/* ------------------------------------------------------------------ */
/* Weekly grid                                                         */
/* ------------------------------------------------------------------ */

/**
 * One meeting on one dated day.
 *
 * The grid used to draw the repeating week straight from assignments, which
 * cannot express anything that happens to a *particular* week: a date the TA
 * is away, a meeting somebody else is covering, a one-off event. Every block
 * is now a dated occurrence, so those states have somewhere to live.
 */
export interface WeekOccurrence {
  key: string;
  /** Which duty type this is, so the view filter can hide it. */
  dutyTypeRef: string;
  date: string;
  day: DayCode;
  startMin: number;
  endMin: number;
  title: string;
  color: string;
  state: "normal" | "off" | "covering" | "excepted";
  /** The other party in a coverage. */
  otherName: string | null;
  /** Why the TA marked themselves away, for "excepted". */
  note: string | null;
  /** Null when the TA has no assignment of their own to swap (covering). */
  swapTarget: SwapModalTarget | null;
}

const OCCURRENCE_NOTE: Record<WeekOccurrence["state"], string | null> = {
  normal: null,
  off: "Not you this week",
  covering: "You are covering",
  excepted: "You marked yourself away",
};

/** Place this week's weekly + one-off items on their real dates. */
export function occurrencesFromItems(
  items: ScheduleItem[],
  weekStart: string,
): WeekOccurrence[] {
  const week = weekRange(weekStart);
  const out: WeekOccurrence[] = [];
  for (const item of items) {
    const s = item.shift;
    if (s.startMin === undefined || s.endMin === undefined) continue;
    let date: string | null = null;
    let day: DayCode | null = null;
    if (s.recurrence === "weekly" && s.day) {
      if (!weeklyShiftRunsInWeek(s, week)) continue;
      day = s.day as DayCode;
      date = dateOfDayInWeek(week.start, day);
    } else if (s.recurrence === "once" && s.date) {
      if (s.date < week.start || s.date > week.end) continue;
      day = dayOfIso(s.date);
      date = s.date;
    }
    if (!date || !day) continue;
    out.push({
      key: `${item.assignment._id}:${date}`,
      dutyTypeRef: item.dutyType._id as string,
      date,
      day,
      startMin: s.startMin,
      endMin: s.endMin,
      title: occurrenceTitle(item.dutyType.name, s.description),
      color: item.dutyType.color || "#7d93b2",
      state: "normal",
      otherName: null,
      note: null,
      swapTarget: swapTargetFor(item),
    });
  }
  return out;
}

/** "Discussion 0101" without saying "Discussion" twice. */
export function occurrenceTitle(dutyTypeName: string, description?: string): string {
  const detail = description ? shortShiftName(description, dutyTypeName) : "";
  return detail && detail !== dutyTypeName ? `${dutyTypeName} ${detail}` : dutyTypeName;
}

const SLOT_PX = 22; // px per 30 minutes (board recipe)

function WeeklyGrid({
  occurrences,
  weekStart,
  onRequestSwap,
}: {
  occurrences: WeekOccurrence[];
  weekStart: string;
  onRequestSwap: (t: SwapModalTarget) => void;
}) {
  const week = weekRange(weekStart);
  const today = todayIso();

  let rangeStart = 8 * 60;
  let rangeEnd = 20 * 60;
  for (const o of occurrences) {
    rangeStart = Math.min(rangeStart, Math.floor(o.startMin / 60) * 60);
    rangeEnd = Math.max(rangeEnd, Math.ceil(o.endMin / 60) * 60);
  }
  const slots = (rangeEnd - rangeStart) / 30;
  const hours: number[] = [];
  for (let h = rangeStart / 60; h < rangeEnd / 60; h++) hours.push(h);

  const byDay = new Map<DayCode, WeekOccurrence[]>();
  for (const d of DAY_CODES) byDay.set(d, []);
  for (const o of occurrences) byDay.get(o.day)?.push(o);

  // Blocks are absolutely positioned by time, so two in the same slot would
  // paint on top of each other. Split each day overlap set into side-by-side
  // lanes; a block with no neighbour still spans the column.
  const laneSpans = new Map<string, LaneSpan>();
  for (const d of DAY_CODES) {
    const dayItems = (byDay.get(d) ?? []).map((o) => ({
      id: o.key,
      start: o.startMin,
      end: o.endMin,
    }));
    for (const [id, span] of assignLanes(dayItems)) laneSpans.set(id, span);
  }

  return (
    <div className="overflow-hidden rounded-[12px] border border-line bg-surface">
      {/* Day header — dated, so "this week" is a fact rather than a guess. */}
      <div className="grid h-[34px] grid-cols-[56px_repeat(5,1fr)] items-center border-b border-line">
        <div />
        {week.days.map(({ day, date }) => {
          const dayItems = byDay.get(day) ?? [];
          // Hours the TA is actually on the hook for: a meeting somebody else
          // is covering does not count toward their week.
          const total = dayItems
            .filter((o) => o.state !== "off")
            .reduce((sum, o) => sum + (o.endMin - o.startMin) / 60, 0);
          const isToday = date === today;
          return (
            <div
              key={day}
              className={
                "flex items-baseline gap-1.5 border-l border-[rgba(255,255,255,0.06)] pl-2.5 pr-2 text-[12.5px] " +
                (isToday ? "font-semibold text-ink" : "font-medium text-[#C9C9CF]")
              }
            >
              <span>{DAY_SHORT[day]}</span>
              <span
                className={
                  "font-mono text-[11.5px] font-normal " +
                  (isToday ? "text-ink" : "text-faint")
                }
              >
                {Number(date.slice(8, 10))}
              </span>
              {total > 0 ? (
                <span className="ml-auto font-mono text-[12px] font-normal text-faint">
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
        {week.days.map(({ day, date }) => (
          <div
            key={day}
            className="relative border-l border-[rgba(255,255,255,0.06)]"
            style={date === today ? { background: "rgba(255,255,255,0.022)" } : undefined}
          >
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
            {(byDay.get(day) ?? []).map((o) => {
              const top = ((o.startMin - rangeStart) / 30) * SLOT_PX + 1;
              const height = ((o.endMin - o.startMin) / 30) * SLOT_PX - 3;
              const { left, width } = laneStyle(laneSpans.get(o.key));
              // Handed off: keep the block so the TA can see it is not simply
              // gone, but drain the colour so it never reads as work to attend.
              const off = o.state === "off";
              const accent = off ? "#7d7d86" : o.color;
              const ring =
                o.state === "excepted"
                  ? "inset 0 0 0 1px rgba(245,165,36,0.75)"
                  : `inset 0 0 0 1px ${hexToRgba(accent, off ? 0.28 : 0.35)}`;
              const stateNote = OCCURRENCE_NOTE[o.state];
              const tip = [
                o.title,
                formatTimeRange(o.startMin, o.endMin),
                o.state === "off" && o.otherName
                  ? `${o.otherName} is covering`
                  : stateNote,
                o.note,
              ]
                .filter(Boolean)
                .join(" · ");
              return (
                <div
                  key={o.key}
                  title={tip}
                  className="group absolute box-border overflow-hidden rounded-[6px] px-2 py-[5px]"
                  style={{
                    top,
                    height,
                    left,
                    width,
                    background: hexToRgba(accent, off ? 0.07 : 0.16),
                    boxShadow: ring,
                    // Standing in for somebody is not the same commitment as
                    // your own shift, and the block is too short for a label —
                    // a green left edge separates them at a glance.
                    borderLeft:
                      o.state === "covering" ? "3px solid var(--color-ok)" : undefined,
                  }}
                >
                  {/* pr-5 keeps the title clear of the hover swap button. */}
                  <div className="flex min-w-0 flex-col gap-px pr-5">
                    <span
                      className={
                        "truncate text-[11px] font-medium " +
                        (off ? "text-faint line-through" : "text-ink")
                      }
                    >
                      {o.title}
                    </span>
                    {height >= 34 ? (
                      <span
                        className="truncate font-mono text-[10.5px]"
                        style={{ color: accent }}
                      >
                        {formatTimeRange(o.startMin, o.endMin)}
                      </span>
                    ) : null}
                    {height >= 50 && stateNote ? (
                      <span
                        className={
                          "truncate text-[10.5px] " +
                          (o.state === "excepted" ? "text-warn-text" : "text-faint")
                        }
                      >
                        {o.state === "off" && o.otherName
                          ? `${o.otherName} covers`
                          : stateNote}
                      </span>
                    ) : null}
                  </div>
                  {o.swapTarget && o.state !== "off" ? (
                    <button
                      type="button"
                      onClick={() => onRequestSwap(o.swapTarget as SwapModalTarget)}
                      title="Request swap"
                      aria-label={`Request swap for ${o.title}`}
                      className="absolute top-1 right-1 grid size-5 cursor-pointer place-items-center rounded-[5px] bg-black/30 text-muted opacity-0 transition-opacity duration-100 group-hover:opacity-100 hover:bg-black/50 hover:text-ink"
                    >
                      <ArrowLeftRight size={11} strokeWidth={1.5} />
                    </button>
                  ) : null}
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
  /** One-off substitutions touching this TA, either direction. */
  coverage?: CoverageNotice[];
  /** ISO Monday of the visible week. Defaults to the current one. */
  weekStart?: string;
  onWeekChange?: (weekStart: string) => void;
  /**
   * This week's dated meetings. Omitted in previews and while the week query
   * is still loading, in which case the generic repeating week is derived
   * from `items` so the grid is never blank.
   */
  weekOccurrences?: WeekOccurrence[];
  /** Date exceptions overlapping the visible week. */
  weekExceptions?: Array<{ id: string; startDate: string; endDate: string; reason: string }>;
  onRequestSwap: (target: SwapModalTarget) => void;
  /** Omitted in previews; hides the withdraw button when absent. */
  onCancelSwap?: (swapId: string) => void;
  onAddToCalendar?: () => void;
  addingToCalendar?: boolean;
  /** Duty type ids the TA has hidden; display only, never a data change. */
  hiddenDuties?: Set<string>;
  onToggleDuty?: (dutyTypeRef: string) => void;
  onShowAllDuties?: () => void;
}

export function ScheduleView({
  courseLabel,
  published,
  items,
  hourLogs,
  maxHoursPerWeek,
  pendingSwaps,
  coverage = [],
  weekStart: weekStartProp,
  onWeekChange,
  weekOccurrences,
  weekExceptions = [],
  onRequestSwap,
  onCancelSwap,
  onAddToCalendar,
  addingToCalendar,
  hiddenDuties = new Set<string>(),
  onToggleDuty,
  onShowAllDuties,
}: ScheduleViewProps) {
  const today = todayIso();
  const weekStart = weekStartProp ?? mondayOf(today);
  // Falling back to the repeating week keeps the grid populated while the
  // dated query resolves, and lets the preview harness render without it.
  const occurrences = weekOccurrences ?? occurrencesFromItems(items, weekStart);

  // Every kind of work assigned to this TA, for the filter chips. Counted
  // before hiding so a chip never reads 0 because it is the one hidden.
  const dutyFilterItems: DutyFilterItem[] = [];
  for (const item of items) {
    const id = item.dutyType._id as string;
    const seen = dutyFilterItems.find((d) => d.id === id);
    if (seen) seen.count += 1;
    else {
      dutyFilterItems.push({
        id,
        name: item.dutyType.name,
        color: item.dutyType.color || "#7d93b2",
        count: 1,
      });
    }
  }

  // Hours against the cap are a fact about the week, not a view of it: they
  // stay whole however much of the screen is hidden.
  const weeklyHours = items
    .filter((i) => i.shift.recurrence === "weekly")
    .reduce((s, i) => s + ((i.shift.endMin ?? 0) - (i.shift.startMin ?? 0)) / 60, 0);

  const shown = items.filter((i) => !hiddenDuties.has(i.dutyType._id as string));
  const shownOccurrences = occurrences.filter((o) => !hiddenDuties.has(o.dutyTypeRef));

  const onceItems = shown
    .filter((i) => i.shift.recurrence === "once" && (i.shift.date ?? "") >= today)
    .sort((a, b) =>
      (a.shift.date ?? "").localeCompare(b.shift.date ?? "") ||
      (a.shift.startMin ?? 0) - (b.shift.startMin ?? 0),
    );

  const asyncItems = shown.filter(
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
              <div className="flex h-8 shrink-0 items-center gap-2 rounded-[9px] border border-line bg-[rgba(255,255,255,0.03)] px-3">
                <span className="shrink-0 font-mono text-[12.5px] text-ink">
                  {formatHours(weeklyHours, maxHoursPerWeek)}
                </span>
                <span className="shrink-0 whitespace-nowrap text-[12px] text-faint">
                  per week
                </span>
                <ProgressBar
                  value={weeklyHours}
                  max={maxHoursPerWeek}
                  className="w-16 shrink-0"
                />
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
          {onWeekChange ? (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <WeekNav weekStart={weekStart} onChange={onWeekChange} />
              {weekExceptions.length > 0 ? (
                <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                  {weekExceptions.map((x) => (
                    <Badge key={x.id} tone="amber">
                      <CalendarOff size={11} strokeWidth={1.5} aria-hidden />
                      Away {formatIsoDate(x.startDate)}
                      {x.endDate !== x.startDate ? ` – ${formatIsoDate(x.endDate)}` : ""}
                      {x.reason ? ` · ${x.reason}` : ""}
                    </Badge>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          {onToggleDuty && onShowAllDuties ? (
            <DutyFilterBar
              items={dutyFilterItems}
              hidden={hiddenDuties}
              onToggle={onToggleDuty}
              onShowAll={onShowAllDuties}
            />
          ) : null}

          <WeeklyGrid
            occurrences={shownOccurrences}
            weekStart={weekStart}
            onRequestSwap={onRequestSwap}
          />

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
                          <span className="text-muted">
                            {" "}·{" "}
                            {shortShiftName(item.shift.description, item.dutyType.name)}
                          </span>
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
                                {" "}·{" "}
                                {shortShiftName(item.shift.description, item.dutyType.name)}
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

          {coverage.length > 0 && (
            <Card title="One-off coverage">
              <div className="flex flex-col gap-1.5">
                {coverage.map((c) => (
                  <div
                    key={c.id}
                    className="flex min-h-9 items-center gap-3 rounded-[9px] border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)] px-2.5 py-1.5"
                  >
                    <UserRoundCheck
                      size={14}
                      strokeWidth={1.5}
                      className="shrink-0 text-muted"
                      aria-hidden
                    />
                    <span className="shrink-0 font-mono text-[12px] text-muted">
                      {formatIsoDate(c.date)}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">
                      {c.label}
                    </span>
                    <Badge
                      tone={c.role === "covering" ? "green" : "neutral"}
                      className="shrink-0"
                    >
                      {c.role === "covering"
                        ? c.otherName
                          ? `Covering for ${c.otherName}`
                          : "You are covering"
                        : c.otherName
                          ? `${c.otherName} covers`
                          : "Cover pending"}
                    </Badge>
                  </div>
                ))}
              </div>
            </Card>
          )}

          <Card title="Swap requests">
            {pendingSwaps.length === 0 ? (
              <p className="text-[12.5px] text-faint">No swap requests yet.</p>
            ) : (
              <div className="flex flex-col gap-1.5">
                {pendingSwaps.map((s) => (
                  <div
                    key={s.id}
                    className="flex min-h-9 flex-wrap items-center gap-x-3 gap-y-1 rounded-[9px] border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)] px-2.5 py-1.5"
                  >
                    <ArrowLeftRight size={14} strokeWidth={1.5} className="shrink-0 text-muted" aria-hidden />
                    <span className="shrink-0 text-[12.5px] font-medium text-ink">{s.label}</span>
                    {/* The duration was invisible before, and approval is not
                        reversible — say which one this request is. */}
                    <span className="shrink-0 font-mono text-[11.5px] text-faint">
                      {swapDurationLabel(s)}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[12.5px] text-muted">
                      {s.reason}
                    </span>
                    <Badge tone={SWAP_TONE[s.status]} className="ml-auto shrink-0">
                      {SWAP_LABEL[s.status]}
                    </Badge>
                    {s.status === "pending" && onCancelSwap ? (
                      <Tooltip label="Withdraw this request">
                        <IconButton
                          onClick={() => onCancelSwap(s.id)}
                          aria-label={`Withdraw swap request for ${s.label}`}
                        >
                          <X size={16} strokeWidth={1.5} aria-hidden />
                        </IconButton>
                      </Tooltip>
                    ) : null}
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
  // Read swaps back from the database rather than tracking them locally, so a
  // request the coordinator resolves stops reading "Pending" on its own.
  const mySwaps = useQuery(
    api.ta.listMySwaps,
    pick.taProfileId ? { taProfileRef: pick.taProfileId } : "skip",
  );
  const myCoverage = useQuery(
    api.coverage.mine,
    pick.periodId ? { periodRef: pick.periodId } : "skip",
  );
  const cancelSwap = useMutation(api.ta.cancelSwap);

  const [swapTarget, setSwapTarget] = useState<SwapModalTarget | null>(null);
  const [swapOpen, setSwapOpen] = useState(false);
  const [minting, setMinting] = useState(false);
  const [feedOpen, setFeedOpen] = useState(false);
  const [feedSecret, setFeedSecret] = useState<string | undefined>(undefined);
  const createFeed = useMutation(api.calendarFeeds.mine);
  const rotateFeed = useMutation(api.calendarFeeds.rotate);
  const [weekStart, setWeekStart] = useState(thisMonday);
  // Kept per profile: a TA in two courses filters each one separately.
  const hiddenDuties = useHiddenIds(
    pick.taProfileId ? `terpta:schedule-hidden-duties:${pick.taProfileId}` : null,
  );

  // The dated week: which meetings actually happen, who is away, who is
  // covering. The repeating week cannot express any of that.
  const week = useQuery(
    api.weeks.taWeek,
    pick.taProfileId ? { taProfileRef: pick.taProfileId, weekStart } : "skip",
  );

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

  // A downloaded .ics is a photograph of today's schedule. Asking for the
  // feed address instead means a swap approved in October turns up in the
  // calendar entry the TA added in September.
  const askForFeed = (rotate: boolean) => {
    if (!pick.taProfileId) return;
    setMinting(true);
    const call = rotate
      ? rotateFeed({ kind: "ta" as const, taProfileRef: pick.taProfileId })
      : createFeed({ taProfileRef: pick.taProfileId });
    call
      .then((r) => setFeedSecret(r.secret))
      .catch((err) =>
        toast(err instanceof Error ? err.message : "Could not create the calendar link", {
          tone: "error",
        }),
      )
      .finally(() => setMinting(false));
  };

  return (
    <>
      <ScheduleView
        courseLabel={pick.courseLabel}
        published={schedule.published}
        items={schedule.items}
        hourLogs={hourLogs}
        maxHoursPerWeek={profile?.maxHoursPerWeek ?? null}
        pendingSwaps={(mySwaps ?? []).map((s) => ({
          id: s._id as string,
          label: s.label || "Shift",
          reason: s.reason,
          status: s.status,
          scope: s.scope,
          date: s.date,
          suggestedName: s.suggestedName,
        }))}
        coverage={(myCoverage ?? []).map((c) => ({
          id: c._id as string,
          date: c.date,
          label: c.label,
          role: c.role,
          otherName: c.otherName,
        }))}
        weekStart={weekStart}
        onWeekChange={setWeekStart}
        weekOccurrences={
          week
            ? week.occurrences.map((o) => ({
                key: o.key,
                dutyTypeRef: o.dutyType._id as string,
                date: o.date,
                day: (o.day ?? "M") as DayCode,
                startMin: o.shift.startMin ?? 0,
                endMin: o.shift.endMin ?? 0,
                title: occurrenceTitle(o.dutyType.name, o.shift.description),
                color: o.dutyType.color || "#7d93b2",
                state: o.state,
                otherName: o.otherName,
                note: o.exceptionReason,
                // A meeting being covered belongs to somebody else this week,
                // so there is nothing of the TA's own to swap out of it — the
                // seat carried on a "covering" occurrence is the absent TA's.
                swapTarget:
                  o.assignment && o.state !== "covering"
                    ? {
                        assignmentRef: o.assignment._id,
                        label: occurrenceTitle(o.dutyType.name, o.shift.description),
                        detail: formatTimeRange(
                          o.shift.startMin ?? 0,
                          o.shift.endMin ?? 0,
                        ),
                        day: o.shift.recurrence === "weekly" ? o.shift.day : undefined,
                        onceDate: o.shift.recurrence === "once" ? o.shift.date : undefined,
                        date: o.date,
                      }
                    : null,
              }))
            : undefined
        }
        weekExceptions={(week?.exceptions ?? []).map((x) => ({
          id: x._id as string,
          startDate: x.startDate,
          endDate: x.endDate,
          reason: x.reason,
        }))}
        onRequestSwap={(t) => {
          setSwapTarget(t);
          setSwapOpen(true);
        }}
        onCancelSwap={(id) => {
          void cancelSwap({ swapRef: id as Id<"swapRequests"> })
            .then(() => toast("Swap request withdrawn"))
            .catch((e: unknown) => toast(errorMessage(e), { tone: "error" }));
        }}
        hiddenDuties={hiddenDuties.hidden}
        onToggleDuty={hiddenDuties.toggle}
        onShowAllDuties={hiddenDuties.showAll}
        onAddToCalendar={() => setFeedOpen(true)}
        addingToCalendar={false}
      />
      <Modal
        open={feedOpen}
        onClose={() => setFeedOpen(false)}
        title="Add to your calendar"
        width={460}
        footer={<Button onClick={() => setFeedOpen(false)}>Close</Button>}
      >
        <CalendarFeed
          secret={feedSecret}
          loading={minting}
          onCreate={() => askForFeed(false)}
          onRotate={feedSecret ? () => askForFeed(true) : undefined}
          description="Your shifts, as a calendar you add once. Swaps, covers and anything the coordinator republishes turn up on their own."
        />
      </Modal>

      <SwapRequestModal
        open={swapOpen}
        onClose={() => setSwapOpen(false)}
        target={swapTarget}
      />
    </>
  );
}
