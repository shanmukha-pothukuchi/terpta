/**
 * Step 3 — Preferences.
 *
 * Rebuilt against the Claude Design reference (design/terpta-onboarding-ref/
 * onboarding-spec.md section 5) on this project's dark tokens. It is a real
 * simplification of the old four-card Step4Preferences:
 *
 *  - one "Preferences" card with three inline groups instead of three cards;
 *  - hours move from a minus/plus stepper to a 4-20 slider;
 *  - the sync/async slider and the drag-to-rank duty chips are gone — duty
 *    types are flat multi-select pills and click order *is* the ranking
 *    (syncAsyncFromDuties() in model.ts derives the axis the solver wants);
 *  - only ranked sections are listed; the rest hide behind "+ Add a section",
 *    and the "No preference" toggle is gone (an empty list says it already);
 *  - the picker is split: a TA can only rank a section they could physically
 *    attend. Sections that collide with their step-1 classes are still shown,
 *    disabled and captioned with the clash, because "why can't I pick 0104?"
 *    deserves an answer on screen rather than a silent omission;
 *  - a new advisory conflict card reconciles the step-1 classes against the
 *    ranking. It never blocks and never disables anything.
 *
 * The @dnd-kit reorder behaviour is carried over from Step4Preferences.
 */
import { useMemo, useState } from "react";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { GripVertical, Plus, TriangleAlert, X } from "lucide-react";
import type { Id } from "../../../../convex/_generated/dataModel";
import { Card, IconButton, Tooltip } from "../../../components/ui";
import { DAY_SHORT, formatMeeting, formatTime } from "../../../lib/format";
import {
  DEFAULT_HOURS,
  MAX_HOURS,
  MIN_HOURS,
  conflictBySectionId,
  findConflicts,
  type ClassesValue,
  type PreferencesValue,
  type SchedulableSection,
  type SectionConflict,
} from "./model";

/* ------------------------------------------------------------------ */
/* Props                                                               */
/* ------------------------------------------------------------------ */

export interface Step3PreferencesProps {
  value: PreferencesValue;
  onChange: (next: PreferencesValue) => void;
  dutyTypes: Array<{
    _id: Id<"dutyTypes">;
    name: string;
    mode: "sync" | "async";
    color: string;
  }>;
  sections: SchedulableSection[];
  /** For the cross-step conflict card. */
  classes: ClassesValue;
  departmentCapNote?: string;
  /**
   * wizard (default): centred 720px card for onboarding.
   * page: full-width, left-aligned like the other TA tabs.
   */
  layout?: "wizard" | "page";
}

const DEFAULT_CAP_NOTE =
  "The department caps most TA appointments at 20 hours a week.";

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function reorder(ids: string[], from: number, to: number): string[] {
  if (from < 0 || to < 0 || to >= ids.length || from === to) return ids;
  const next = [...ids];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

function clampHours(hours: number): number {
  if (!Number.isFinite(hours)) return DEFAULT_HOURS;
  return Math.min(MAX_HOURS, Math.max(MIN_HOURS, Math.round(hours)));
}

function meetingsLabel(meetings: SchedulableSection["meetings"]): string {
  return meetings.map((m) => formatMeeting(m.day, m.startMin, m.endMin)).join(" · ");
}

/** "Tu 9:30a · CMSC131" — when the section meets and what it runs into. */
function conflictLabel(c: SectionConflict): string {
  return `${c.day} ${formatTime(c.startMin)} · ${c.courseId}`;
}

/* ------------------------------------------------------------------ */
/* Ranked section row (dnd-kit core, carried over from Step4)          */
/* ------------------------------------------------------------------ */

function RankedSectionRow({
  id,
  index,
  sectionNumber,
  meetings,
  conflict,
  onRemove,
}: {
  id: string;
  index: number;
  sectionNumber: string;
  meetings: string;
  /** Set when a class added *after* this was ranked now collides with it. */
  conflict: SectionConflict | undefined;
  onRemove: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef: setDragRef,
    transform,
    isDragging,
  } = useDraggable({ id });
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id });

  return (
    <div
      ref={setDropRef}
      className={
        isOver && !isDragging
          ? "rounded-[7px] shadow-[0_-2px_0_0_rgba(255,255,255,0.28)]"
          : undefined
      }
    >
      <div
        ref={setDragRef}
        style={{
          transform: transform
            ? `translate3d(${transform.x}px, ${transform.y}px, 0)`
            : undefined,
        }}
        className={
          "group relative flex h-10 min-w-0 items-center gap-2 rounded-[7px] border px-2.5 " +
          (isDragging
            ? "z-10 border-line-strong bg-raised shadow-[0_10px_30px_rgba(0,0,0,0.5)]"
            : "border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.025)]")
        }
      >
        <span className="w-[18px] shrink-0 font-mono text-[11px] text-faint">
          {index + 1}
        </span>
        <span className="w-12 shrink-0 truncate font-mono text-[13px] text-ink">
          {sectionNumber}
        </span>
        {/* A choice the TA already made is never dropped for them — it is
            flagged where they can see it and left in their ranking. The icon
            sits left of centre so its tooltip cannot run off a 390px screen. */}
        {conflict ? (
          <Tooltip
            label={`Clashes with ${conflict.courseId}, ${conflict.day} ${formatTime(conflict.startMin)}`}
            className="shrink-0"
          >
            <TriangleAlert
              size={14}
              strokeWidth={1.5}
              className="text-warn"
              aria-label={`Section ${sectionNumber} clashes with your ${conflict.courseId} class`}
            />
          </Tooltip>
        ) : null}
        <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-muted">
          {meetings}
        </span>
        <IconButton
          variant="ghost"
          onClick={onRemove}
          aria-label={`Remove section ${sectionNumber} from your ranking`}
        >
          <X size={16} strokeWidth={1.5} aria-hidden />
        </IconButton>
        <button
          type="button"
          aria-label={`Drag to reorder section ${sectionNumber}`}
          className="grid size-6 shrink-0 cursor-grab place-items-center rounded-[6px] text-faint hover:text-ink active:cursor-grabbing"
          {...listeners}
          {...attributes}
        >
          <GripVertical size={16} strokeWidth={1.5} aria-hidden />
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Step 3                                                              */
/* ------------------------------------------------------------------ */

export function Step3Preferences({
  value,
  onChange,
  dutyTypes,
  sections,
  classes,
  departmentCapNote,
  layout = "wizard",
}: Step3PreferencesProps) {
  const [pickerOpen, setPickerOpen] = useState(false);

  const hours = clampHours(value.maxHoursPerWeek);
  const fillRatio = (hours - MIN_HOURS) / (MAX_HOURS - MIN_HOURS);
  const fillPct = fillRatio * 100;
  /** Half a 16px thumb, shifted so the fill ends under the thumb's centre. */
  const fillStop = `calc(${fillPct}% + ${(0.5 - fillRatio) * 16}px)`;

  const sectionById = useMemo(
    () => new Map(sections.map((s) => [String(s._id), s])),
    [sections],
  );

  /** Only the sections the TA opted into, in their ranked order. */
  const ranked = useMemo(
    () => value.sectionPrefs.map(String).filter((id) => sectionById.has(id)),
    [value.sectionPrefs, sectionById],
  );
  const rankedSet = useMemo(() => new Set(ranked), [ranked]);
  const unranked = useMemo(
    () => sections.filter((s) => !rankedSet.has(String(s._id))),
    [sections, rankedSet],
  );

  const dutySelected = useMemo(
    () => new Set(value.dutyTypePrefs.map(String)),
    [value.dutyTypePrefs],
  );

  const conflicts = useMemo(
    () => findConflicts(classes, sections, value.sectionPrefs),
    [classes, sections, value.sectionPrefs],
  );
  const conflictById = useMemo(() => conflictBySectionId(conflicts), [conflicts]);

  /* The picker is split rather than filtered: a TA who cannot attend a section
     still needs to see it and read why, otherwise the omission looks like a
     bug in the import. */
  const [available, blocked] = useMemo(() => {
    const free: SchedulableSection[] = [];
    const clashing: Array<{ section: SchedulableSection; conflict: SectionConflict }> = [];
    for (const s of unranked) {
      const conflict = conflictById.get(String(s._id));
      if (conflict) clashing.push({ section: s, conflict });
      else free.push(s);
    }
    return [free, clashing] as const;
  }, [unranked, conflictById]);

  const patch = (next: Partial<PreferencesValue>) => onChange({ ...value, ...next });
  const setRanked = (ids: string[]) => patch({ sectionPrefs: ids as Id<"sections">[] });

  /* Selection order is the ranking, so appending is the whole interaction. */
  const toggleDuty = (id: string) => {
    const current = value.dutyTypePrefs.map(String);
    const next = current.includes(id)
      ? current.filter((x) => x !== id)
      : [...current, id];
    patch({ dutyTypePrefs: next as Id<"dutyTypes">[] });
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  const onDragEnd = (e: DragEndEvent) => {
    const overId = e.over?.id;
    if (overId === undefined || overId === e.active.id) return;
    setRanked(
      reorder(ranked, ranked.indexOf(String(e.active.id)), ranked.indexOf(String(overId))),
    );
  };

  const page = layout === "page";

  // Left-aligned on the page, centred in the wizard — but capped either way.
  // These are form controls, and a slider or a ranked row stretched across a
  // 1900px window stops looking like the rest of the app; the sibling "Your
  // details" tab holds its fields in rather than filling the page.
  return (
    <div
      className={
        page
          ? "flex min-w-0 max-w-[720px] flex-col gap-3"
          : "mx-auto flex min-w-0 max-w-[720px] flex-col gap-3"
      }
    >
      {/* The wizard card is one 18px-gap stack; zero the Card title's own
          bottom margin so the rhythm stays even. On the Preferences page the
          page header already names this, so the card title is dropped. */}
      <Card
        title={page ? undefined : "Preferences"}
        className={
          page
            ? "flex flex-col gap-[18px]"
            : "flex flex-col gap-[18px] [&>div:first-child]:mb-0"
        }
      >
        {/* ---------------------------------------------------------- */}
        {/* a. Hours                                                    */}
        {/* ---------------------------------------------------------- */}
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex min-w-0 items-baseline gap-3">
            <span className="min-w-0 flex-1 truncate text-[13px] text-muted">
              Max hours per week
            </span>
            <span className="shrink-0 font-mono text-[13px] font-medium text-ink tabular-nums">
              {hours} h
            </span>
          </div>
          <input
            type="range"
            min={MIN_HOURS}
            max={MAX_HOURS}
            step={1}
            value={hours}
            aria-label="Max hours per week"
            onChange={(e) => patch({ maxHoursPerWeek: clampHours(Number(e.target.value)) })}
            style={{
              background: `linear-gradient(to right, var(--color-ink) 0 ${fillStop}, rgba(255,255,255,0.14) ${fillStop} 100%)`,
              backgroundSize: "100% 3px",
              backgroundPosition: "center",
              backgroundRepeat: "no-repeat",
            }}
            className="h-4 w-full cursor-pointer appearance-none rounded-full focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[rgba(255,255,255,0.35)] [&::-moz-range-progress]:bg-transparent [&::-moz-range-thumb]:size-4 [&::-moz-range-thumb]:cursor-pointer [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-ink [&::-moz-range-thumb]:shadow-[0_1px_3px_rgba(0,0,0,0.6)] [&::-moz-range-track]:h-4 [&::-moz-range-track]:bg-transparent [&::-webkit-slider-runnable-track]:h-4 [&::-webkit-slider-runnable-track]:bg-transparent [&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-ink [&::-webkit-slider-thumb]:shadow-[0_1px_3px_rgba(0,0,0,0.6)]"
          />
          <div className="flex items-center justify-between font-mono text-[10.5px] text-faint">
            <span>{MIN_HOURS}</span>
            <span>{MAX_HOURS}</span>
          </div>
          <p className="text-[12px] text-faint [text-wrap:pretty]">
            {departmentCapNote ?? DEFAULT_CAP_NOTE}
          </p>
        </div>

        {/* ---------------------------------------------------------- */}
        {/* b. Duty types — flat multi-select, click order = ranking     */}
        {/* ---------------------------------------------------------- */}
        <div className="flex min-w-0 flex-col gap-2">
          <span className="text-[13px] text-muted">I'd like to do</span>
          {dutyTypes.length === 0 ? (
            <p className="text-[12.5px] text-faint">
              Duty types appear here once your coordinator sets them up.
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {dutyTypes.map((dt) => {
                const id = String(dt._id);
                const on = dutySelected.has(id);
                return (
                  <button
                    key={id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggleDuty(id)}
                    className={
                      "inline-flex min-w-0 cursor-pointer items-center gap-1.5 rounded-[7px] border px-2.5 py-1.5 text-[13px] transition-colors duration-100 " +
                      (on
                        ? "border-transparent bg-[#ededef] font-medium text-[#0b0b0e]"
                        : "border-line bg-[rgba(255,255,255,0.02)] text-muted hover:bg-[rgba(255,255,255,0.05)] hover:text-ink")
                    }
                  >
                    <span
                      aria-hidden
                      className="size-2 shrink-0 rounded-full"
                      style={{ background: dt.color || "#6B6B75" }}
                    />
                    <span className="min-w-0 truncate">{dt.name}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* ---------------------------------------------------------- */}
        {/* c. Ranked sections                                          */}
        {/* ---------------------------------------------------------- */}
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex min-w-0 items-baseline gap-3">
            <span className="min-w-0 flex-1 truncate text-[13px] text-muted">
              Discussion sections, ranked
            </span>
            {ranked.length > 1 ? (
              <span className="shrink-0 text-[12px] text-faint">drag to reorder</span>
            ) : null}
          </div>

          {sections.length === 0 ? (
            <p className="text-[12.5px] text-faint [text-wrap:pretty]">
              Your coordinator hasn't added discussion sections yet.
            </p>
          ) : (
            <>
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={onDragEnd}
              >
                <div className="flex min-w-0 flex-col gap-1.5">
                  {ranked.map((id, i) => {
                    const s = sectionById.get(id);
                    return (
                      <RankedSectionRow
                        key={id}
                        id={id}
                        index={i}
                        sectionNumber={s?.sectionNumber ?? "Section"}
                        meetings={meetingsLabel(s?.meetings ?? [])}
                        conflict={conflictById.get(id)}
                        onRemove={() => setRanked(ranked.filter((x) => x !== id))}
                      />
                    );
                  })}
                </div>
              </DndContext>

              {unranked.length > 0 ? (
                <div
                  className="relative min-w-0"
                  onKeyDown={(e) => {
                    if (e.key === "Escape") setPickerOpen(false);
                  }}
                >
                  <button
                    type="button"
                    aria-expanded={pickerOpen}
                    aria-haspopup="listbox"
                    onClick={() => setPickerOpen((o) => !o)}
                    className="flex h-9 w-full cursor-pointer items-center gap-1.5 rounded-[7px] border border-dashed border-line-strong px-2.5 text-[13px] text-faint transition-colors duration-100 hover:border-[rgba(255,255,255,0.22)] hover:text-muted"
                  >
                    <Plus size={14} strokeWidth={1.5} aria-hidden />
                    Add a section
                  </button>

                  {pickerOpen ? (
                    <>
                      <div
                        aria-hidden
                        className="fixed inset-0 z-20"
                        onClick={() => setPickerOpen(false)}
                      />
                      <div
                        role="listbox"
                        aria-label="Sections you have not ranked"
                        className="absolute top-full left-0 z-30 mt-1.5 max-h-[220px] w-full min-w-0 overflow-y-auto rounded-[10px] border border-line-strong bg-popover p-1 shadow-[0_18px_40px_rgba(0,0,0,0.55)]"
                      >
                        {available.map((s) => (
                          <button
                            key={String(s._id)}
                            type="button"
                            role="option"
                            aria-selected={false}
                            onClick={() => {
                              setRanked([...ranked, String(s._id)]);
                              setPickerOpen(false);
                            }}
                            className="flex h-8 w-full min-w-0 cursor-pointer items-center gap-2 rounded-[6px] px-2 text-left transition-colors duration-100 hover:bg-[rgba(255,255,255,0.06)]"
                          >
                            <span className="w-12 shrink-0 truncate font-mono text-[12.5px] text-ink">
                              {s.sectionNumber}
                            </span>
                            <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-muted">
                              {meetingsLabel(s.meetings)}
                            </span>
                          </button>
                        ))}

                        {available.length === 0 ? (
                          <p className="px-2 py-1.5 text-[12px] text-faint [text-wrap:pretty]">
                            {
                              "Every remaining section runs during one of your classes."
                            }
                          </p>
                        ) : null}

                        {blocked.length > 0 ? (
                          <>
                            <p
                              role="presentation"
                              className="mt-1 truncate px-2 pt-1.5 pb-1 text-[11px] text-faint"
                            >
                              Conflicts with your classes
                            </p>
                            {blocked.map(({ section: s, conflict }) => (
                              <button
                                key={String(s._id)}
                                type="button"
                                role="option"
                                aria-selected={false}
                                aria-disabled
                                disabled
                                title={`${s.sectionNumber} meets during your ${conflict.courseId} class`}
                                className="flex h-8 w-full min-w-0 cursor-not-allowed items-center gap-2 rounded-[6px] px-2 text-left opacity-55"
                              >
                                <span className="w-12 shrink-0 truncate font-mono text-[12.5px] text-muted">
                                  {s.sectionNumber}
                                </span>
                                {/* The reason already names the meeting that
                                    clashes, so the full list only earns its
                                    space when there is more than one. */}
                                {s.meetings.length > 1 ? (
                                  <span className="min-w-0 truncate font-mono text-[11.5px] text-faint">
                                    {meetingsLabel(s.meetings)}
                                  </span>
                                ) : null}
                                <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-faint">
                                  {conflictLabel(conflict)}
                                </span>
                              </button>
                            ))}
                          </>
                        ) : null}
                      </div>
                    </>
                  ) : null}
                </div>
              ) : null}
            </>
          )}
        </div>
      </Card>

      {/* ------------------------------------------------------------ */}
      {/* Advisory conflicts — never blocking, nothing disabled         */}
      {/* ------------------------------------------------------------ */}
      {conflicts.length > 0 ? (
        <div
          role="status"
          className="flex min-w-0 items-start gap-2.5 rounded-[12px] border border-[rgba(226,24,51,0.30)] bg-[rgba(226,24,51,0.10)] px-4 py-3.5 text-[12.5px] leading-[1.5] text-[#F4A3AE]"
        >
          <TriangleAlert
            size={16}
            strokeWidth={1.5}
            className="mt-px shrink-0 text-umd"
            aria-hidden
          />
          <ul className="flex min-w-0 flex-1 flex-col gap-1">
            {conflicts.map((c) => (
              <li
                key={`${c.sectionNumber}-${c.day}-${c.startMin}`}
                className="[text-wrap:pretty]"
              >
                <span className="font-mono">
                  {DAY_SHORT[c.day]} {formatTime(c.startMin)}
                </span>{" "}
                conflicts with <span className="font-mono">{c.courseId}</span>. Section{" "}
                <span className="font-mono">{c.sectionNumber}</span> is{" "}
                {c.ranked ? "still ranked" : "unranked"} for you.
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
