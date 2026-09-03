/**
 * Step 4 — Preferences.
 *
 * Extracted from the preferences half of the original `Onboarding.tsx` so the
 * same UI serves both the wizard and the standing Preferences page. The
 * hour stepper, the sync↔async slider and the @dnd-kit drag-to-rank rows keep
 * their original visual treatment; only the plumbing changed (controlled
 * `value` + `onChange` over {@link PreferencesValue} instead of local state).
 */
import { useMemo, type ReactNode } from "react";
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
import {
  CalendarOff,
  Check,
  ChevronDown,
  ChevronUp,
  GripVertical,
  Minus,
  Plus,
  X,
} from "lucide-react";
import type { Id } from "../../../../convex/_generated/dataModel";
import { formatMeeting, type DayCode } from "../../../lib/format";
import { Card, EmptyState } from "../../../components/ui";
import { DEFAULT_HOURS, MAX_HOURS, MIN_HOURS, type PreferencesValue } from "./model";

/* ------------------------------------------------------------------ */
/* Props                                                               */
/* ------------------------------------------------------------------ */

export interface Step4DutyType {
  _id: Id<"dutyTypes">;
  name: string;
  mode: "sync" | "async";
  color: string;
}

export interface Step4Section {
  _id: Id<"sections">;
  sectionNumber: string;
  meetings: Array<{ day: DayCode; startMin: number; endMin: number }>;
  instructors?: string[];
}

export interface Step4PreferencesProps {
  value: PreferencesValue;
  onChange: (next: PreferencesValue) => void;
  dutyTypes: Step4DutyType[];
  /** Discussion sections of the STAFFED course the TA may be assigned to. */
  sections: Step4Section[];
  departmentCapNote?: string;
}

const DEFAULT_CAP_NOTE =
  "The department caps most TA appointments at 20 hours a week.";

/* ------------------------------------------------------------------ */
/* Helpers (verbatim from Onboarding.tsx)                              */
/* ------------------------------------------------------------------ */

function reorder(ids: string[], from: number, to: number): string[] {
  if (to < 0 || to >= ids.length || from === to) return ids;
  const next = [...ids];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/** Ranked prefs first (kept in saved order), then any unranked leftovers. */
function initialRank(saved: string[], all: string[]): string[] {
  const known = new Set(all);
  const ranked = saved.filter((id) => known.has(id));
  return [...ranked, ...all.filter((id) => !ranked.includes(id))];
}

function clampHours(hours: number): number {
  if (!Number.isFinite(hours)) return DEFAULT_HOURS;
  return Math.min(MAX_HOURS, Math.max(MIN_HOURS, Math.round(hours)));
}

function meetingsLabel(meetings: Step4Section["meetings"]): string {
  return meetings.map((m) => formatMeeting(m.day, m.startMin, m.endMin)).join(" · ");
}

/* ------------------------------------------------------------------ */
/* Drag-to-rank list (dnd-kit core) — carried over from Onboarding.tsx */
/* ------------------------------------------------------------------ */

function RankRow({
  id,
  index,
  count,
  onMove,
  children,
}: {
  id: string;
  index: number;
  count: number;
  onMove: (delta: number) => void;
  children: ReactNode;
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
          ? "rounded-[9px] shadow-[0_-2px_0_0_rgba(255,255,255,0.28)]"
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
          "relative flex h-9 items-center gap-2 rounded-[9px] border px-2 " +
          (isDragging
            ? "z-10 border-line-strong bg-raised shadow-[0_10px_30px_rgba(0,0,0,0.5)]"
            : "border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)]")
        }
      >
        <button
          type="button"
          aria-label="Drag to reorder"
          className="grid size-6 shrink-0 cursor-grab place-items-center rounded-[6px] text-faint hover:text-ink active:cursor-grabbing"
          {...listeners}
          {...attributes}
        >
          <GripVertical size={14} strokeWidth={1.5} />
        </button>
        <span className="w-4 shrink-0 text-center font-mono text-[11px] text-faint">
          {index + 1}
        </span>
        <div className="flex min-w-0 flex-1 items-center gap-2">{children}</div>
        <div className="flex shrink-0 items-center">
          <button
            type="button"
            aria-label="Move up"
            disabled={index === 0}
            onClick={() => onMove(-1)}
            className="grid size-6 cursor-pointer place-items-center rounded-[6px] text-faint hover:bg-[rgba(255,255,255,0.06)] hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent"
          >
            <ChevronUp size={14} strokeWidth={1.5} />
          </button>
          <button
            type="button"
            aria-label="Move down"
            disabled={index === count - 1}
            onClick={() => onMove(1)}
            className="grid size-6 cursor-pointer place-items-center rounded-[6px] text-faint hover:bg-[rgba(255,255,255,0.06)] hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent"
          >
            <ChevronDown size={14} strokeWidth={1.5} />
          </button>
        </div>
      </div>
    </div>
  );
}

function RankList({
  items,
  onReorder,
}: {
  items: Array<{ id: string; content: ReactNode }>;
  onReorder: (ids: string[]) => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );
  const ids = items.map((i) => i.id);

  const onDragEnd = (e: DragEndEvent) => {
    const overId = e.over?.id;
    if (overId === undefined || overId === e.active.id) return;
    onReorder(reorder(ids, ids.indexOf(String(e.active.id)), ids.indexOf(String(overId))));
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <div className="flex flex-col gap-1.5">
        {items.map((item, i) => (
          <RankRow
            key={item.id}
            id={item.id}
            index={i}
            count={items.length}
            onMove={(delta) => onReorder(reorder(ids, i, i + delta))}
          >
            {item.content}
          </RankRow>
        ))}
      </div>
    </DndContext>
  );
}

/* ------------------------------------------------------------------ */
/* Step 4                                                              */
/* ------------------------------------------------------------------ */

export function Step4Preferences({
  value,
  onChange,
  dutyTypes,
  sections,
  departmentCapNote,
}: Step4PreferencesProps) {
  const hours = clampHours(value.maxHoursPerWeek);
  const noPref = value.noSectionPreference;

  const sectionById = useMemo(
    () => new Map(sections.map((s) => [String(s._id), s])),
    [sections],
  );
  const dutyById = useMemo(
    () => new Map(dutyTypes.map((d) => [String(d._id), d])),
    [dutyTypes],
  );

  /** Every duty type, ranked prefs first — the ranking is over the whole set. */
  const dutyRank = useMemo(
    () => initialRank(value.dutyTypePrefs.map(String), dutyTypes.map((d) => String(d._id))),
    [value.dutyTypePrefs, dutyTypes],
  );

  /** Only the sections the TA opted into, in their ranked order. */
  const rankedSections = useMemo(
    () => value.sectionPrefs.map(String).filter((id) => sectionById.has(id)),
    [value.sectionPrefs, sectionById],
  );
  const rankedSet = useMemo(() => new Set(rankedSections), [rankedSections]);
  const unrankedSections = useMemo(
    () => sections.filter((s) => !rankedSet.has(String(s._id))),
    [sections, rankedSet],
  );

  const patch = (next: Partial<PreferencesValue>) => onChange({ ...value, ...next });

  const setHours = (h: number) => patch({ maxHoursPerWeek: clampHours(h) });

  const setSectionPrefs = (ids: string[]) =>
    patch({ sectionPrefs: ids as Id<"sections">[] });

  const toggleSection = (id: string) => {
    if (noPref) return;
    setSectionPrefs(
      rankedSet.has(id) ? rankedSections.filter((x) => x !== id) : [...rankedSections, id],
    );
  };

  return (
    <div className="flex flex-col gap-4">
      {/* ---------------------------------------------------------- */}
      {/* Hours                                                       */}
      {/* ---------------------------------------------------------- */}
      <Card title="Hours">
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label="Decrease max hours per week"
            disabled={hours <= MIN_HOURS}
            onClick={() => setHours(hours - 1)}
            className="grid size-8 shrink-0 cursor-pointer place-items-center rounded-[9px] border border-transparent text-muted transition-colors duration-100 hover:bg-[rgba(255,255,255,0.05)] hover:text-ink disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
          >
            <Minus size={16} strokeWidth={1.5} aria-hidden />
          </button>
          <span
            role="spinbutton"
            aria-label="Max hours per week"
            aria-valuenow={hours}
            aria-valuemin={MIN_HOURS}
            aria-valuemax={MAX_HOURS}
            className="w-16 shrink-0 text-center font-mono text-[17px] font-medium text-ink tabular-nums"
          >
            {hours}h
          </span>
          <button
            type="button"
            aria-label="Increase max hours per week"
            disabled={hours >= MAX_HOURS}
            onClick={() => setHours(hours + 1)}
            className="grid size-8 shrink-0 cursor-pointer place-items-center rounded-[9px] border border-transparent text-muted transition-colors duration-100 hover:bg-[rgba(255,255,255,0.05)] hover:text-ink disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
          >
            <Plus size={16} strokeWidth={1.5} aria-hidden />
          </button>
          <span className="min-w-0 truncate text-[12.5px] text-muted">
            Most you want to work per week
          </span>
        </div>
        <p className="mt-2.5 text-[12px] text-faint">
          {departmentCapNote ?? DEFAULT_CAP_NOTE}
        </p>
      </Card>

      {/* ---------------------------------------------------------- */}
      {/* Type of work                                                */}
      {/* ---------------------------------------------------------- */}
      <Card title="Type of work">
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={value.syncAsyncPreference}
            onChange={(e) => patch({ syncAsyncPreference: Number(e.target.value) })}
            aria-label="Synchronous versus asynchronous work preference"
            className="h-1 flex-1 cursor-pointer accent-[#EDEDEF]"
          />
          <span className="w-12 shrink-0 text-right font-mono text-[12px] text-ink tabular-nums">
            {Math.round(value.syncAsyncPreference * 100)}%
          </span>
        </div>
        <div className="mt-1.5 flex items-start justify-between gap-4 text-[11.5px] text-faint">
          <span className="min-w-0 flex-1">
            Mostly synchronous (sections, office hours, proctoring)
          </span>
          <span className="min-w-0 flex-1 text-right">
            Mostly asynchronous (grading, projects)
          </span>
        </div>

        <div className="mt-4 border-t border-line pt-3.5">
          <p className="mb-2 text-[11px] font-medium tracking-[0.06em] text-faint uppercase">
            Rank the work you'd rather do
          </p>
          {dutyRank.length === 0 ? (
            <p className="text-[12.5px] text-faint">
              Duty types appear here once your coordinator sets them up.
            </p>
          ) : (
            <>
              <RankList
                items={dutyRank.map((id) => {
                  const dt = dutyById.get(id);
                  return {
                    id,
                    content: (
                      <>
                        <span
                          aria-hidden
                          className="size-2 shrink-0 rounded-full"
                          style={{ background: dt?.color ?? "#6B6B75" }}
                        />
                        <span className="min-w-0 truncate text-[12.5px] text-ink">
                          {dt?.name ?? "Duty type"}
                        </span>
                        <span className="ml-auto shrink-0 font-mono text-[10.5px] tracking-[0.06em] text-faint uppercase">
                          {dt?.mode ?? ""}
                        </span>
                      </>
                    ),
                  };
                })}
                onReorder={(ids) => patch({ dutyTypePrefs: ids as Id<"dutyTypes">[] })}
              />
              <p className="mt-2 text-[12px] text-faint">
                Drag to rank — top is most preferred.
              </p>
            </>
          )}
        </div>
      </Card>

      {/* ---------------------------------------------------------- */}
      {/* Sections                                                    */}
      {/* ---------------------------------------------------------- */}
      <Card
        title="Sections you'd like to teach"
        actions={
          sections.length > 0 ? (
            <button
              type="button"
              aria-pressed={noPref}
              onClick={() => patch({ noSectionPreference: !noPref })}
              className={
                "inline-flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-[9px] border px-2.5 text-[12.5px] transition-colors duration-100 " +
                (noPref
                  ? "border-[rgba(255,255,255,0.18)] bg-[rgba(255,255,255,0.09)] font-medium text-ink"
                  : "border-line bg-[rgba(255,255,255,0.03)] text-muted hover:text-ink")
              }
            >
              <Check
                size={14}
                strokeWidth={1.5}
                aria-hidden
                className={noPref ? "text-ink" : "text-faint opacity-40"}
              />
              No preference
            </button>
          ) : null
        }
      >
        {sections.length === 0 ? (
          <EmptyState
            icon={CalendarOff}
            title="Your coordinator hasn't added discussion sections yet."
            hint="They'll show up here as soon as the course's discussion sections exist."
          />
        ) : (
          <div
            className={
              noPref ? "pointer-events-none opacity-40 select-none" : undefined
            }
            aria-disabled={noPref || undefined}
          >
            {rankedSections.length > 0 ? (
              <div className="mb-3">
                <p className="mb-2 text-[11px] font-medium tracking-[0.06em] text-faint uppercase">
                  Ranked — top is most preferred
                </p>
                <RankList
                  items={rankedSections.map((id) => {
                    const s = sectionById.get(id);
                    return {
                      id,
                      content: (
                        <>
                          <span className="shrink-0 font-mono text-[12.5px] text-ink">
                            {s?.sectionNumber ?? "Section"}
                          </span>
                          <span className="min-w-0 shrink truncate font-mono text-[11.5px] text-muted">
                            {meetingsLabel(s?.meetings ?? [])}
                          </span>
                          {s?.instructors?.length ? (
                            <span className="min-w-0 truncate text-[11.5px] text-faint">
                              {s.instructors.join(", ")}
                            </span>
                          ) : null}
                          <button
                            type="button"
                            aria-label={`Remove ${s?.sectionNumber ?? "section"} from your preferences`}
                            onClick={() => toggleSection(id)}
                            className="ml-auto grid size-6 shrink-0 cursor-pointer place-items-center rounded-[6px] text-faint hover:bg-[rgba(255,255,255,0.06)] hover:text-ink"
                          >
                            <X size={14} strokeWidth={1.5} aria-hidden />
                          </button>
                        </>
                      ),
                    };
                  })}
                  onReorder={setSectionPrefs}
                />
              </div>
            ) : null}

            {unrankedSections.length > 0 ? (
              <>
                {rankedSections.length > 0 ? (
                  <p className="mb-2 text-[11px] font-medium tracking-[0.06em] text-faint uppercase">
                    Other sections
                  </p>
                ) : null}
                <div className="flex flex-col gap-1.5">
                  {unrankedSections.map((s) => (
                    <button
                      key={String(s._id)}
                      type="button"
                      aria-pressed={false}
                      disabled={noPref}
                      onClick={() => toggleSection(String(s._id))}
                      className="flex h-9 cursor-pointer items-center gap-3 rounded-[9px] border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)] px-2.5 text-left transition-colors duration-100 hover:bg-[rgba(255,255,255,0.05)]"
                    >
                      <span className="shrink-0 font-mono text-[12.5px] text-ink">
                        {s.sectionNumber}
                      </span>
                      <span className="min-w-0 shrink truncate font-mono text-[11.5px] text-muted">
                        {meetingsLabel(s.meetings)}
                      </span>
                      {s.instructors?.length ? (
                        <span className="min-w-0 truncate text-[11.5px] text-faint">
                          {s.instructors.join(", ")}
                        </span>
                      ) : null}
                      <Plus
                        size={14}
                        strokeWidth={1.5}
                        aria-hidden
                        className="ml-auto shrink-0 text-faint"
                      />
                    </button>
                  ))}
                </div>
              </>
            ) : null}

            <p className="mt-2.5 text-[12px] text-faint">
              Pick the sections you'd rather support, then drag to rank them.
            </p>
          </div>
        )}
      </Card>
    </div>
  );
}
