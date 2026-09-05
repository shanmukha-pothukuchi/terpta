import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { CalendarOff, Lock, LockOpen, Search, UserRoundCheck, X } from "lucide-react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import {
  DAY_SHORT,
  formatDate,
  formatHourCount,
  formatTimeRange,
  type DayCode,
} from "../../../lib/format";
import { dateOfDayInWeek } from "../../../lib/week";
import { Spinner } from "../../../components/ui";
import { awayHole, coverageFor, isAwayOnDay, type WeekOverlay } from "./weekOverlay";
import { roomOf, type BuilderModel, type ShiftRow } from "./model";

export type ShiftCandidate = FunctionReturnType<
  typeof api.builder.shiftCandidates
>[number];

export interface ShiftDrawerProps {
  shift: ShiftRow;
  model: BuilderModel;
  /** What is different about the selected week; null = the template. */
  week?: WeekOverlay | null;
  onClose: () => void;
  onOpenTa: (taProfileRef: Id<"taProfiles">) => void;
  /** Put this TA on the shift for the rest of term. */
  onAssign: (taProfileRef: Id<"taProfiles">) => void;
  /**
   * Stand this TA in for one date. Absent when nobody on the shift is away
   * this week; present, and replacing the current stand-in, when somebody is.
   */
  onCoverDate?: (taProfileRef: Id<"taProfiles">) => void;
  /** Give the current stand-in the shift every week. */
  onMakeCoverPermanent?: (taProfileRef: Id<"taProfiles">) => void;
  /** Take the current stand-in back off the date, leaving the hole open. */
  onClearCover?: () => void;
  onToggleLock: (assignmentRef: Id<"assignments">) => void;
  onRemoveAssignment: (assignmentRef: Id<"assignments">) => void;
  /** DEV harness override — skips the Convex query when provided. */
  fixtureCandidates?: ShiftCandidate[];
}

/** "50m" / "2h" / "1h 20m" — never 0.8333h. */
function minutesLabel(mins: number): string {
  if (mins % 60 === 0) return `${mins / 60}h`;
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

/** One labelled fact. Wraps rather than truncating: that is the point of it. */
function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-[3px]">
      <span className="text-[11px] text-faint">{label}</span>
      <span className="text-[12.5px] leading-[1.4] text-ink">{value}</span>
    </div>
  );
}

function FitPill({ candidate }: { candidate: ShiftCandidate }) {
  const [label, color, bg] =
    candidate.fit === "unavailable"
      ? ["Unavailable", "#F4A3AE", "rgba(226,24,51,0.14)"]
      : candidate.fit === "prefer_not"
        ? ["Prefers not", "#F7C566", "rgba(245,165,36,0.14)"]
        : candidate.submitted
          ? ["Free", "#7FE3B1", "rgba(61,214,140,0.14)"]
          : // A TA who never submitted is scheduled as free; saying so plainly
            // stops "Free" from reading as a promise they made.
            ["Free (no form)", "#9FB6D6", "rgba(125,147,178,0.16)"];
  return (
    <span
      className="shrink-0 whitespace-nowrap rounded-[5px] px-[5px] py-[1px] text-[10.5px]"
      style={{ color, background: bg }}
    >
      {label}
    </span>
  );
}

/**
 * Everything about one shift, with the whole roster ranked against it.
 *
 * The board block is a few hundred pixels wide, so its room, term and
 * availability hint all truncate, and filling a seat meant dragging a name
 * from a list that says nothing about whether that TA is free. This panel is
 * the long form of both.
 */
export function ShiftDrawer({
  shift,
  model,
  week = null,
  onClose,
  onOpenTa,
  onAssign,
  onCoverDate,
  onMakeCoverPermanent,
  onClearCover,
  onToggleLock,
  onRemoveAssignment,
  fixtureCandidates,
}: ShiftDrawerProps) {
  const queried = useQuery(
    api.builder.shiftCandidates,
    fixtureCandidates ? "skip" : { shiftRef: shift._id },
  );
  const candidates = fixtureCandidates ?? queried;

  const [entered, setEntered] = useState(false);
  const [filter, setFilter] = useState("");
  /** "date" only offered while somebody on this shift is away this week. */
  const [scope, setScope] = useState<"term" | "date">(onCoverDate ? "date" : "term");
  useEffect(() => {
    if (!onCoverDate) setScope("term");
  }, [onCoverDate]);

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

  const duty = model.dutyById.get(shift.dutyTypeRef as string);
  const section =
    shift.sectionRef !== undefined
      ? model.sectionById.get(shift.sectionRef as string)
      : undefined;
  const assigned = model.assignmentsByShift.get(shift._id as string) ?? [];
  const missing = Math.max(0, shift.requiredCount - assigned.length);
  const room = roomOf(model, shift);
  const coverage = coverageFor(week, shift._id, shift.day);
  // A holder away by their own calendar, with nothing written down yet.
  const hole = coverage ? undefined : awayHole(week, shift, assigned);
  const dormant = week?.dormantShiftIds.has(shift._id as string) ?? false;
  const occurrenceDate =
    shift.date ??
    (week && shift.day !== undefined
      ? dateOfDayInWeek(week.weekStart, shift.day as DayCode)
      : undefined);

  const when =
    shift.recurrence === "once"
      ? `${shift.day ? `${DAY_SHORT[shift.day as DayCode]} ` : ""}${
          shift.date ? formatDate(shift.date) : ""
        }`
      : shift.recurrence === "weekly" && shift.day !== undefined
        ? `Every ${DAY_SHORT[shift.day as DayCode]}`
        : shift.dueDate
          ? `Due ${formatDate(shift.dueDate)}`
          : "—";
  const timeText =
    shift.startMin !== undefined && shift.endMin !== undefined
      ? formatTimeRange(shift.startMin, shift.endMin)
      : "—";
  // A 50-minute discussion is 0.8333h, which is not a thing anyone says.
  const durationText =
    shift.startMin !== undefined && shift.endMin !== undefined
      ? minutesLabel(shift.endMin - shift.startMin)
      : formatHourCount(shift.hoursRequired ?? duty?.defaultHoursCredit ?? 0);

  const shown = useMemo(() => {
    if (!candidates) return [];
    const q = filter.trim().toLowerCase();
    // The stand-in has a row of their own above; listing them again would
    // offer to cover a date they already cover.
    const covering = String(coverage?.coverTaRef ?? "");
    return candidates.filter(
      (c) =>
        !c.assigned &&
        String(c.taProfileRef) !== covering &&
        (q === "" || c.name.toLowerCase().includes(q)),
    );
  }, [candidates, filter, coverage?.coverTaRef]);

  const title = section
    ? `Section ${section.sectionNumber}`
    : (shift.description ?? duty?.name ?? "Shift");

  return createPortal(
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-[rgba(0,0,0,0.35)]" onClick={onClose} />
      <div
        className="absolute bottom-0 right-0 top-0 flex w-[440px] flex-col overflow-auto border-l border-line-strong bg-[#111115] shadow-[-30px_0_80px_rgba(0,0,0,0.5)] transition-[transform,opacity] duration-200 ease-out"
        style={{
          transform: entered ? "none" : "translateX(24px)",
          opacity: entered ? 1 : 0,
        }}
      >
        <div className="flex items-start gap-3 border-b border-line px-5 pb-[14px] pt-[18px]">
          <span
            className="mt-[6px] size-[10px] shrink-0 rounded-[3px]"
            style={{ background: duty?.color ?? "#7D93B2" }}
            aria-hidden
          />
          <div className="flex min-w-0 flex-col gap-[3px]">
            <div className="text-[15px] font-semibold leading-[1.25] tracking-[-0.01em]">
              {title}
            </div>
            <div className="text-[12px] text-muted">
              {duty?.name ?? "Shift"} · {when} · {timeText}
            </div>
          </div>
          <div className="flex-1" />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] text-faint transition-colors hover:bg-[rgba(255,255,255,0.06)]"
          >
            <X size={15} strokeWidth={1.5} />
          </button>
        </div>

        <div className="flex flex-col gap-[18px] px-5 py-4">
          {dormant ? (
            <div className="flex items-center gap-2 rounded-[9px] border border-line bg-[rgba(255,255,255,0.03)] px-3 py-2 text-[12.5px] text-muted">
              <CalendarOff size={13} strokeWidth={1.5} className="text-faint" aria-hidden />
              Not running the week of {week ? formatDate(week.weekStart) : ""}.
            </div>
          ) : null}
          {coverage ? (
            <div
              className="rounded-[9px] px-3 py-2 text-[12.5px]"
              style={{
                background: coverage.coverName
                  ? "rgba(61,214,140,0.10)"
                  : "rgba(245,165,36,0.12)",
                color: coverage.coverName ? "#7FE3B1" : "#F7C566",
              }}
            >
              {coverage.coverName
                ? `${coverage.coverName} is covering for ${coverage.absentName} on ${formatDate(coverage.date)}.`
                : `${coverage.absentName} is away on ${formatDate(coverage.date)} — nobody is covering yet.`}
            </div>
          ) : hole ? (
            <div
              className="rounded-[9px] px-3 py-2 text-[12.5px]"
              style={{ background: "rgba(245,165,36,0.12)", color: "#F7C566" }}
            >
              {model.taShort(hole.absentTaRef as Id<"taProfiles">)} is away on{" "}
              {formatDate(hole.date)} — nobody is covering yet. A TA added for that
              date stands in once; the shift stays theirs.
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-[10px] border border-line px-3.5 py-3">
            <Fact label="When" value={`${when} · ${timeText}`} />
            <Fact
              label="Seats"
              value={`${assigned.length} of ${shift.requiredCount} filled`}
            />
            <Fact label="Room" value={room || "Not given"} />
            <Fact label="Time each" value={durationText} />
            {shift.recurrence === "weekly" ? (
              <Fact
                label="Runs"
                value={
                  shift.startDate || shift.endDate
                    ? `${shift.startDate ? formatDate(shift.startDate) : "term start"} – ${
                        shift.endDate ? formatDate(shift.endDate) : "term end"
                      }`
                    : "All term"
                }
              />
            ) : null}
            <Fact
              label="Free that day"
              value={`${shift.availableTaCount} TA${shift.availableTaCount === 1 ? "" : "s"}`}
            />
            {shift.description && section ? (
              <div className="col-span-2">
                <Fact label="Note" value={shift.description} />
              </div>
            ) : null}
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-xs text-muted">
              Assigned{missing > 0 ? ` · ${missing} seat${missing === 1 ? "" : "s"} open` : ""}
            </span>
            {assigned.length === 0 ? (
              <div className="text-[12.5px] text-faint">Nobody yet.</div>
            ) : (
              assigned.map((a) => {
                const conflicts = model.conflictsByAssignment.get(a._id as string) ?? [];
                const load = model.loadByTa.get(a.taProfileRef as string);
                const away =
                  week !== null &&
                  (isAwayOnDay(week, a.taProfileRef, shift.day, (d) =>
                    dateOfDayInWeek(week.weekStart, d),
                  ) !== undefined ||
                    String(coverage?.absentTaRef ?? "") === String(a.taProfileRef));
                return (
                  <div
                    key={a._id as string}
                    className="flex items-center gap-2 rounded-[9px] border border-line bg-[rgba(255,255,255,0.03)] px-3 py-2"
                  >
                    <button
                      type="button"
                      onClick={() => onOpenTa(a.taProfileRef)}
                      className="min-w-0 flex-1 truncate text-left text-[12.5px] text-ink hover:underline"
                    >
                      {model.taName(a.taProfileRef)}
                    </button>
                    {away ? (
                      <span className="flex shrink-0 items-center gap-1 text-[11px] text-warn">
                        <CalendarOff size={11} strokeWidth={1.5} aria-hidden />
                        Away
                      </span>
                    ) : null}
                    {conflicts.length > 0 ? (
                      <span className="shrink-0 text-[11px] text-[#F4A3AE]">
                        {conflicts[0].detail}
                      </span>
                    ) : load ? (
                      <span className="shrink-0 font-mono text-[11px] text-faint">
                        {load.weeklyHours}/{load.maxHoursPerWeek}h
                      </span>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => onToggleLock(a._id)}
                      title={a.locked ? "Unlock assignment" : "Lock assignment"}
                      aria-label={a.locked ? "Unlock assignment" : "Lock assignment"}
                      className="flex size-6 shrink-0 items-center justify-center rounded-[6px] hover:bg-[rgba(255,255,255,0.08)]"
                    >
                      {a.locked ? (
                        <Lock size={12} strokeWidth={1.5} className="text-ink" />
                      ) : (
                        <LockOpen size={12} strokeWidth={1.5} className="text-faint" />
                      )}
                    </button>
                    <button
                      type="button"
                      disabled={a.locked}
                      onClick={() => onRemoveAssignment(a._id)}
                      aria-label={`Remove ${model.taName(a.taProfileRef)}`}
                      className="flex size-6 shrink-0 items-center justify-center rounded-[6px] text-[#F4A3AE] hover:bg-[rgba(226,24,51,0.18)] disabled:opacity-30"
                    >
                      <X size={12} strokeWidth={1.5} />
                    </button>
                  </div>
                );
              })
            )}
            {/* The stand-in for the date, distinct from the seats: one date,
                not the term. "Assign" here is the one place it becomes the
                term — the cover is the same person, kept. */}
            {coverage?.coverTaRef && coverage.coverName ? (
              <div
                className="flex items-center gap-2 rounded-[9px] px-3 py-2"
                style={{
                  background: "rgba(61,214,140,0.08)",
                  boxShadow: "inset 0 0 0 1px rgba(61,214,140,0.35)",
                }}
              >
                <button
                  type="button"
                  onClick={() => onOpenTa(coverage.coverTaRef as Id<"taProfiles">)}
                  className="min-w-0 flex-1 truncate text-left text-[12.5px] text-ink hover:underline"
                >
                  {coverage.coverName}
                </button>
                <span className="flex shrink-0 items-center gap-1 text-[11px] text-ok-text">
                  <UserRoundCheck size={11} strokeWidth={1.5} aria-hidden />
                  Covers {formatDate(coverage.date)}
                </span>
                {onMakeCoverPermanent ? (
                  <button
                    type="button"
                    title="Give them this shift every week"
                    onClick={() => onMakeCoverPermanent(coverage.coverTaRef as Id<"taProfiles">)}
                    className="h-6 shrink-0 cursor-pointer whitespace-nowrap rounded-[7px] bg-ink px-2 text-[11.5px] font-medium text-page transition-colors hover:bg-white"
                  >
                    Assign
                  </button>
                ) : null}
                {onClearCover ? (
                  <button
                    type="button"
                    onClick={onClearCover}
                    title="Take them off this date"
                    aria-label={`Take ${coverage.coverName} off ${formatDate(coverage.date)}`}
                    className="flex size-6 shrink-0 items-center justify-center rounded-[6px] text-[#F4A3AE] hover:bg-[rgba(226,24,51,0.18)]"
                  >
                    <X size={12} strokeWidth={1.5} />
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted">Add a TA</span>
              <span className="flex-1" />
              {onCoverDate ? (
                <div className="inline-flex h-6 items-center gap-0.5 rounded-[7px] border border-line bg-[rgba(255,255,255,0.03)] p-0.5">
                  {(["date", "term"] as const).map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setScope(s)}
                      aria-pressed={scope === s}
                      className={
                        "h-full cursor-pointer whitespace-nowrap rounded-[5px] px-2 text-[11px] transition-colors " +
                        (scope === s
                          ? "bg-[rgba(255,255,255,0.09)] font-medium text-ink"
                          : "text-muted hover:text-ink")
                      }
                    >
                      {s === "date"
                        ? occurrenceDate
                          ? `${formatDate(occurrenceDate)} only`
                          : "This date"
                        : "Every week"}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <div className="flex h-8 items-center gap-2 rounded-[9px] border border-line bg-page px-2.5">
              <Search size={13} strokeWidth={1.5} className="shrink-0 text-faint" aria-hidden />
              <input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filter by name"
                aria-label="Filter TAs"
                className="min-w-0 flex-1 bg-transparent text-[12.5px] text-ink outline-none placeholder:text-faint"
              />
            </div>

            {candidates === undefined ? (
              <div className="py-6">
                <Spinner label="Ranking TAs…" />
              </div>
            ) : shown.length === 0 ? (
              <div className="py-3 text-[12.5px] text-faint">
                {filter.trim() ? "Nobody by that name." : "Everyone is already on it."}
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                {shown.map((c) => {
                  const blocked = c.fit === "unavailable" || c.clash !== null || c.away;
                  const note =
                    c.away && occurrenceDate
                      ? `Away ${formatDate(occurrenceDate)}`
                      : c.clash !== null
                        ? `Busy · ${c.clash}`
                        : c.atCap
                          ? "At limit"
                          : null;
                  return (
                    <div
                      key={c.taProfileRef as string}
                      className="flex items-center gap-2 rounded-[9px] px-2.5 py-[7px] transition-colors hover:bg-[rgba(255,255,255,0.04)]"
                      style={{ opacity: blocked ? 0.55 : 1 }}
                    >
                      <button
                        type="button"
                        onClick={() => onOpenTa(c.taProfileRef)}
                        className="max-w-[150px] shrink-0 truncate text-left text-[12.5px] text-ink hover:underline"
                      >
                        {c.name}
                      </button>
                      <FitPill candidate={c} />
                      {/* The note is what gives way when the row is tight; a
                          half-printed name identifies nobody. */}
                      <span className="min-w-0 flex-1 truncate text-[11px] text-faint">
                        {note ?? ""}
                      </span>
                      <span className="shrink-0 font-mono text-[11px] text-faint">
                        {c.weeklyHours}/{c.maxHoursPerWeek}h
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          scope === "date" && onCoverDate
                            ? onCoverDate(c.taProfileRef)
                            : onAssign(c.taProfileRef)
                        }
                        className="h-6 shrink-0 cursor-pointer whitespace-nowrap rounded-[7px] bg-ink px-2 text-[11.5px] font-medium text-page transition-colors hover:bg-white"
                      >
                        {scope === "date" && onCoverDate ? "Cover" : "Assign"}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
            {/* Nothing here is a hard stop: a coordinator who knows better can
                still place a TA the rule would keep out. */}
            <p className="text-[11.5px] leading-[1.45] text-faint">
              Anyone can be assigned — dimmed rows are only the ones the
              generator would not pick. Adding somebody to a full shift
              replaces its first unlocked TA.
            </p>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
