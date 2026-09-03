/**
 * TA onboarding: two steps.
 *   1. Courses — import a course (api.umd.importCourse, with a manual-entry
 *      fallback message when the action fails), pick your sections, and watch
 *      the mini week preview fill with locked blue-gray class blocks.
 *   2. Preferences — max-hours stepper, sync↔async slider, drag-to-rank duty
 *      types (dnd-kit) and discussion sections.
 * Everything persists through api.ta.saveProfile.
 *
 * `OnboardingView` is the pure inner component (fixture-friendly for the DEV
 * preview harness); the default export wires Convex.
 */
import { useMemo, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAction, useMutation, useQuery } from "convex/react";
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
  Check,
  ChevronDown,
  ChevronUp,
  Download,
  GraduationCap,
  GripVertical,
  Lock,
  Minus,
  Plus,
  TriangleAlert,
  UserRoundPlus,
} from "lucide-react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { usePeriod } from "../../lib/period";
import {
  DAY_CODES,
  formatDate,
  formatMeeting,
  formatTime,
  type DayCode,
} from "../../lib/format";
import {
  Button,
  Card,
  EmptyState,
  Input,
  PageHeader,
  Spinner,
  Stepper,
  Surface,
  toast,
} from "../../components/ui";

/* ------------------------------------------------------------------ */
/* Types (plain strings for ids so fixtures don't need Convex)         */
/* ------------------------------------------------------------------ */

export interface SectionMeeting {
  day: DayCode;
  startMin: number;
  endMin: number;
}

export interface SectionOption {
  /** Id<"sections"> as a plain string. */
  id: string;
  /** e.g. "Discussion 0101". */
  label: string;
  type: "lecture" | "discussion" | "lab";
  meetings: SectionMeeting[];
}

export interface OnboardingDutyType {
  /** Id<"dutyTypes"> as a plain string. */
  id: string;
  name: string;
  mode: "sync" | "async";
  color: string;
}

export interface ClassBlock extends SectionMeeting {
  label?: string;
}

export interface OnboardingProfileData {
  maxHoursPerWeek: number;
  syncAsyncPreference: number;
  enrolledSectionRefs: string[];
  dutyTypePrefs: string[];
  sectionPrefs: string[];
}

export interface OnboardingViewProps {
  courseLabel: string;
  /** Term code for imports, e.g. "202608". */
  term: string;
  termLabel: string;
  deadline?: string;
  profile: OnboardingProfileData;
  dutyTypes: OnboardingDutyType[];
  sectionOptions: SectionOption[];
  /** Locked class blocks already imported on the availability grid. */
  importedBlocks: ClassBlock[];
  onImportCourse?: (
    courseId: string,
  ) => Promise<{ sectionsImported: number; source: string }>;
  onSave: (fields: OnboardingProfileData) => Promise<void>;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** "202608" -> "Fall 2026" (best effort). */
function termName(term: string): string {
  const y = term.slice(0, 4);
  const season =
    { "01": "Spring", "05": "Summer", "08": "Fall", "12": "Winter" }[term.slice(4)] ?? "";
  return season ? `${season} ${y}` : term;
}

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

const SECTION_GROUPS: Array<{ type: SectionOption["type"]; title: string }> = [
  { type: "lecture", title: "Lectures" },
  { type: "discussion", title: "Discussions" },
  { type: "lab", title: "Labs" },
];

/* ------------------------------------------------------------------ */
/* Week preview — locked blue-gray class blocks (board recipe)         */
/* ------------------------------------------------------------------ */

const PREVIEW_START = 8 * 60;
const PREVIEW_END = 20 * 60;
const PREVIEW_SLOT_PX = 9; // px per 30 min

function WeekPreview({ blocks }: { blocks: ClassBlock[] }) {
  const slots = (PREVIEW_END - PREVIEW_START) / 30;
  const byDay = new Map<DayCode, ClassBlock[]>();
  for (const d of DAY_CODES) byDay.set(d, []);
  for (const b of blocks) byDay.get(b.day)?.push(b);

  return (
    <div>
      <div className="overflow-hidden rounded-[10px] border border-line bg-page">
        <div className="grid h-6 grid-cols-[34px_repeat(5,1fr)] items-center border-b border-line">
          <div />
          {DAY_CODES.map((d) => (
            <div
              key={d}
              className="border-l border-[rgba(255,255,255,0.06)] pl-1.5 font-mono text-[10px] text-faint"
            >
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-[34px_repeat(5,1fr)]">
          <div>
            {Array.from({ length: slots / 4 }, (_, i) => (
              <div
                key={i}
                className="box-border pt-px pr-1.5 text-right font-mono text-[9px] text-faint"
                style={{ height: PREVIEW_SLOT_PX * 4 }}
              >
                {formatTime(PREVIEW_START + i * 120, { compact: true })}
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
                    height: PREVIEW_SLOT_PX,
                    borderBottom:
                      s % 4 === 3
                        ? "1px solid rgba(255,255,255,0.06)"
                        : "1px solid transparent",
                  }}
                />
              ))}
              {(byDay.get(d) ?? []).map((b) => {
                const top = ((b.startMin - PREVIEW_START) / 30) * PREVIEW_SLOT_PX;
                const height = ((b.endMin - b.startMin) / 30) * PREVIEW_SLOT_PX - 1;
                return (
                  <div
                    key={`${b.day}:${b.startMin}:${b.endMin}`}
                    className="absolute right-px left-px box-border overflow-hidden rounded-[4px] bg-[rgba(125,147,178,0.16)] shadow-[inset_0_0_0_1px_rgba(125,147,178,0.35)]"
                    style={{ top, height: Math.max(height, 4) }}
                    title={b.label}
                  >
                    {height >= 16 ? (
                      <div className="flex items-center gap-1 px-1 pt-0.5">
                        <Lock size={8} strokeWidth={1.5} className="shrink-0 text-classblue" aria-hidden />
                        <span className="truncate font-mono text-[9px] text-[#B7C6DC]">
                          {b.label ?? ""}
                        </span>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      <div className="mt-2 flex items-center gap-1.5 text-[11.5px] text-muted">
        <span
          aria-hidden
          className="size-[9px] rounded-[3px] bg-[rgba(125,147,178,0.35)] shadow-[inset_0_0_0_1px_rgba(125,147,178,0.8)]"
        />
        Imported class · locked
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Drag-to-rank list (dnd-kit core)                                    */
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
          <GripVertical size={13} strokeWidth={1.5} />
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
            <ChevronUp size={13} strokeWidth={1.5} />
          </button>
          <button
            type="button"
            aria-label="Move down"
            disabled={index === count - 1}
            onClick={() => onMove(1)}
            className="grid size-6 cursor-pointer place-items-center rounded-[6px] text-faint hover:bg-[rgba(255,255,255,0.06)] hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent"
          >
            <ChevronDown size={13} strokeWidth={1.5} />
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
/* Pure view                                                           */
/* ------------------------------------------------------------------ */

export function OnboardingView({
  courseLabel,
  term,
  termLabel,
  deadline,
  profile,
  dutyTypes,
  sectionOptions,
  importedBlocks,
  onImportCourse,
  onSave,
}: OnboardingViewProps) {
  const [step, setStep] = useState(0);
  const [enrolled, setEnrolled] = useState<string[]>(profile.enrolledSectionRefs);
  const [maxHours, setMaxHours] = useState(profile.maxHoursPerWeek);
  const [syncAsync, setSyncAsync] = useState(profile.syncAsyncPreference);
  const [dutyRank, setDutyRank] = useState<string[]>(() =>
    initialRank(profile.dutyTypePrefs, dutyTypes.map((d) => d.id)),
  );
  const discussionOptions = sectionOptions.filter((o) => o.type === "discussion");
  const [sectionRank, setSectionRank] = useState<string[]>(() =>
    initialRank(profile.sectionPrefs, discussionOptions.map((o) => o.id)),
  );
  const [saving, setSaving] = useState(false);

  // Course import box
  const [courseInput, setCourseInput] = useState("");
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importSuccess, setImportSuccess] = useState<string | null>(null);

  const optionById = useMemo(
    () => new Map(sectionOptions.map((o) => [o.id, o])),
    [sectionOptions],
  );
  const dutyById = useMemo(() => new Map(dutyTypes.map((d) => [d.id, d])), [dutyTypes]);

  const previewBlocks = useMemo(() => {
    const seen = new Set(importedBlocks.map((b) => `${b.day}:${b.startMin}:${b.endMin}`));
    const extra: ClassBlock[] = [];
    for (const id of enrolled) {
      const opt = optionById.get(id);
      for (const m of opt?.meetings ?? []) {
        const key = `${m.day}:${m.startMin}:${m.endMin}`;
        if (seen.has(key)) continue;
        seen.add(key);
        extra.push({ ...m, label: opt?.label });
      }
    }
    return [...importedBlocks, ...extra];
  }, [importedBlocks, enrolled, optionById]);

  const runImport = async () => {
    const courseId = courseInput.trim().toUpperCase();
    if (!courseId || !onImportCourse) return;
    setImporting(true);
    setImportError(null);
    setImportSuccess(null);
    try {
      const res = await onImportCourse(courseId);
      setImportSuccess(
        `Imported ${res.sectionsImported} ${res.sectionsImported === 1 ? "section" : "sections"} for ${courseId} (${res.source}).`,
      );
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Import failed.");
    } finally {
      setImporting(false);
    }
  };

  const save = async (successMessage: string) => {
    setSaving(true);
    try {
      await onSave({
        maxHoursPerWeek: maxHours,
        syncAsyncPreference: syncAsync,
        enrolledSectionRefs: enrolled,
        dutyTypePrefs: dutyRank,
        sectionPrefs: sectionRank,
      });
      toast(successMessage);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Save failed", { tone: "error" });
    } finally {
      setSaving(false);
    }
  };

  const toggleEnrolled = (id: string) =>
    setEnrolled((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Courses & Preferences"
        description={
          courseLabel +
          (deadline ? ` · availability due ${formatDate(deadline)}` : "")
        }
      />
      <Stepper steps={["Courses", "Preferences"]} current={step} />

      {step === 0 ? (
        <>
          <div className="grid items-start gap-4 lg:grid-cols-[1fr_320px]">
            <div className="flex flex-col gap-4">
              <Card title="Import a course">
                <div className="flex items-center gap-2">
                  <Input
                    value={courseInput}
                    onChange={(e) => setCourseInput(e.target.value.toUpperCase())}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void runImport();
                    }}
                    placeholder="CMSC330"
                    aria-label="Course ID"
                    className="w-36 font-mono uppercase"
                  />
                  <span className="inline-flex h-8 items-center rounded-[9px] border border-line bg-[rgba(255,255,255,0.03)] px-2.5 font-mono text-[12px] text-muted">
                    {termLabel || term}
                  </span>
                  <Button
                    variant="secondary"
                    onClick={() => void runImport()}
                    loading={importing}
                    disabled={!courseInput.trim() || !onImportCourse}
                  >
                    <Download size={14} strokeWidth={1.5} aria-hidden />
                    Import sections
                  </Button>
                </div>
                {importSuccess ? (
                  <p className="mt-2.5 flex items-center gap-1.5 text-[12px] text-ok-text">
                    <Check size={13} strokeWidth={1.5} aria-hidden />
                    {importSuccess}
                  </p>
                ) : null}
                {importError ? (
                  <div className="mt-2.5 flex gap-2.5 rounded-[9px] border border-[rgba(245,165,36,0.30)] bg-[rgba(245,165,36,0.08)] px-3 py-2.5">
                    <TriangleAlert
                      size={14}
                      strokeWidth={1.5}
                      className="mt-0.5 shrink-0 text-warn"
                      aria-hidden
                    />
                    <div className="text-[12px] text-warn-text">
                      <p>{importError}</p>
                      <p className="mt-1 opacity-80">
                        Can't import? Enter your class times manually instead — open{" "}
                        <Link
                          to="/ta/availability"
                          className="underline underline-offset-2 hover:text-ink"
                        >
                          Availability
                        </Link>{" "}
                        and paint those times as Unavailable.
                      </p>
                    </div>
                  </div>
                ) : null}
              </Card>

              <Card
                title="Your sections"
                actions={
                  <span className="font-mono text-[12px] text-faint">
                    {enrolled.length} selected
                  </span>
                }
              >
                {sectionOptions.length === 0 ? (
                  <p className="text-[12.5px] text-faint">
                    No sections are available to pick yet. Import your course above, or
                    ask your coordinator — the course's discussion sections appear here
                    once shifts exist.
                  </p>
                ) : (
                  <div className="flex flex-col gap-3">
                    {SECTION_GROUPS.map(({ type, title }) => {
                      const group = sectionOptions.filter((o) => o.type === type);
                      if (group.length === 0) return null;
                      return (
                        <div key={type}>
                          <p className="mb-1.5 text-[11px] font-medium tracking-[0.06em] text-faint uppercase">
                            {title}
                          </p>
                          <div className="flex flex-col gap-1.5">
                            {group.map((opt) => {
                              const selected = enrolled.includes(opt.id);
                              return (
                                <button
                                  key={opt.id}
                                  type="button"
                                  onClick={() => toggleEnrolled(opt.id)}
                                  aria-pressed={selected}
                                  className={
                                    "flex h-9 cursor-pointer items-center gap-3 rounded-[9px] border px-2.5 text-left transition-colors duration-100 " +
                                    (selected
                                      ? "border-[rgba(125,147,178,0.35)] bg-[rgba(125,147,178,0.10)]"
                                      : "border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)] hover:bg-[rgba(255,255,255,0.05)]")
                                  }
                                >
                                  <span className="shrink-0 font-mono text-[12.5px] text-ink">
                                    {opt.label}
                                  </span>
                                  <span className="min-w-0 truncate font-mono text-[11.5px] text-muted">
                                    {opt.meetings
                                      .map((m) => formatMeeting(m.day, m.startMin, m.endMin))
                                      .join(" · ")}
                                  </span>
                                  {selected ? (
                                    <Check
                                      size={14}
                                      strokeWidth={1.5}
                                      className="ml-auto shrink-0 text-classblue"
                                      aria-hidden
                                    />
                                  ) : null}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </Card>
            </div>

            <Card title="Week preview">
              <WeekPreview blocks={previewBlocks} />
            </Card>
          </div>

          <div className="flex items-center gap-3">
            <p className="text-[12px] text-faint">
              Class times become locked, unavailable blocks on your availability grid.
            </p>
            <div className="ml-auto flex items-center gap-2">
              <Button variant="ghost" onClick={() => setStep(1)}>
                Continue to preferences
              </Button>
              <Button
                variant="primary"
                loading={saving}
                onClick={() => void save("Courses saved — class blocks locked on your grid")}
              >
                Save courses
              </Button>
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="grid items-start gap-4 lg:grid-cols-2">
            <Card title="Weekly hour cap">
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  aria-label="Decrease max hours"
                  onClick={() => setMaxHours((h) => Math.max(1, h - 1))}
                >
                  <Minus size={13} strokeWidth={1.5} />
                </Button>
                <span className="w-16 text-center font-mono text-[16px] font-medium text-ink">
                  {maxHours}h
                </span>
                <Button
                  variant="secondary"
                  size="sm"
                  aria-label="Increase max hours"
                  onClick={() => setMaxHours((h) => Math.min(40, h + 1))}
                >
                  <Plus size={13} strokeWidth={1.5} />
                </Button>
              </div>
              <p className="mt-2 text-[12px] text-faint">
                The builder never schedules you above this. Default is 10.
              </p>
            </Card>

            <Card title="Sync ↔ async balance">
              <div className="flex items-center gap-3">
                <span className="shrink-0 text-[12px] text-muted">All sync</span>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={syncAsync}
                  onChange={(e) => setSyncAsync(Number(e.target.value))}
                  aria-label="Sync versus async preference"
                  className="h-1 flex-1 cursor-pointer accent-[#EDEDEF]"
                />
                <span className="shrink-0 text-[12px] text-muted">All async</span>
                <span className="w-16 shrink-0 text-right font-mono text-[12px] text-ink">
                  {Math.round(syncAsync * 100)}%
                </span>
              </div>
              <p className="mt-2 text-[12px] text-faint">
                0% = office hours & labs only · 100% = grading only.
              </p>
            </Card>

            <Card title="Duty type preferences">
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
                            <span className="truncate text-[12.5px] text-ink">
                              {dt?.name ?? "Duty type"}
                            </span>
                            <span className="ml-auto shrink-0 font-mono text-[10.5px] tracking-[0.06em] text-faint uppercase">
                              {dt?.mode ?? ""}
                            </span>
                          </>
                        ),
                      };
                    })}
                    onReorder={setDutyRank}
                  />
                  <p className="mt-2 text-[12px] text-faint">
                    Drag to rank — top is most preferred.
                  </p>
                </>
              )}
            </Card>

            <Card title="Discussion section preferences">
              {sectionRank.length === 0 ? (
                <p className="text-[12.5px] text-faint">
                  Discussion sections appear here once the course is imported.
                </p>
              ) : (
                <>
                  <RankList
                    items={sectionRank.map((id) => {
                      const opt = optionById.get(id);
                      return {
                        id,
                        content: (
                          <>
                            <span className="shrink-0 font-mono text-[12.5px] text-ink">
                              {opt?.label ?? "Section"}
                            </span>
                            <span className="min-w-0 truncate font-mono text-[11.5px] text-muted">
                              {(opt?.meetings ?? [])
                                .map((m) => formatMeeting(m.day, m.startMin, m.endMin))
                                .join(" · ")}
                            </span>
                          </>
                        ),
                      };
                    })}
                    onReorder={setSectionRank}
                  />
                  <p className="mt-2 text-[12px] text-faint">
                    Drag to rank the sections you'd rather support.
                  </p>
                </>
              )}
            </Card>
          </div>

          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={() => setStep(0)}>
              Back to courses
            </Button>
            <div className="ml-auto">
              <Button
                variant="primary"
                loading={saving}
                onClick={() => void save("Preferences saved")}
              >
                Save preferences
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Wired page                                                          */
/* ------------------------------------------------------------------ */

const CONVEX_ID_RE = /^[a-z0-9]{20,40}$/;

export default function TaOnboarding() {
  const [params] = useSearchParams();
  const rawParam = params.get("period");
  const paramPeriod =
    rawParam && CONVEX_ID_RE.test(rawParam)
      ? (rawParam as Id<"staffingPeriods">)
      : null;

  const ctx = usePeriod();
  const mine = useQuery(api.periods.listMine, {});
  const fallbackRow =
    mine === undefined
      ? null
      : (mine.find((r) => r.taProfileId !== null) ?? mine[0] ?? null);
  const periodId: Id<"staffingPeriods"> | null =
    paramPeriod ?? ctx.periodId ?? fallbackRow?.period._id ?? null;

  const info = useQuery(api.periods.get, periodId ? { periodRef: periodId } : "skip");
  const profile = useQuery(api.ta.getProfile, periodId ? { periodRef: periodId } : "skip");
  const hasProfile = profile !== undefined && profile !== null;
  const dutyTypes = useQuery(
    api.dutyTypes.list,
    hasProfile && periodId ? { periodRef: periodId } : "skip",
  );
  const shifts = useQuery(
    api.shifts.list,
    hasProfile && periodId ? { periodRef: periodId } : "skip",
  );
  const availability = useQuery(
    api.ta.getAvailability,
    hasProfile ? { taProfileRef: profile._id } : "skip",
  );
  const importCourse = useAction(api.umd.importCourse);
  const saveProfile = useMutation(api.ta.saveProfile);
  const [joining, setJoining] = useState(false);

  // Discussion sections the API exposes to TAs: the ones referenced by the
  // period's shifts (there is no TA-visible sections query yet).
  const sectionOptions = useMemo<SectionOption[]>(() => {
    const map = new Map<string, SectionOption>();
    for (const s of shifts ?? []) {
      if (!s.sectionRef) continue;
      const meeting: SectionMeeting[] =
        s.recurrence === "weekly" &&
        s.day !== undefined &&
        s.startMin !== undefined &&
        s.endMin !== undefined
          ? [{ day: s.day as DayCode, startMin: s.startMin, endMin: s.endMin }]
          : [];
      const existing = map.get(s.sectionRef);
      if (existing) {
        for (const m of meeting) {
          if (
            !existing.meetings.some(
              (x) => x.day === m.day && x.startMin === m.startMin && x.endMin === m.endMin,
            )
          ) {
            existing.meetings.push(m);
          }
        }
      } else {
        map.set(s.sectionRef, {
          id: s.sectionRef,
          label: s.description ?? "Section",
          type: "discussion",
          meetings: [...meeting],
        });
      }
    }
    return [...map.values()].sort((a, b) => a.label.localeCompare(b.label));
  }, [shifts]);

  const importedBlocks = useMemo<ClassBlock[]>(
    () =>
      (availability?.blocks ?? [])
        .filter((b) => b.source === "imported_class")
        .map((b) => ({ day: b.day as DayCode, startMin: b.startMin, endMin: b.endMin })),
    [availability],
  );

  if (mine === undefined || (periodId && (info === undefined || profile === undefined))) {
    return (
      <div>
        <PageHeader title="Courses & Preferences" />
        <Spinner label="Loading your setup…" />
      </div>
    );
  }

  if (!periodId || info === null) {
    return (
      <div>
        <PageHeader title="Courses & Preferences" />
        <EmptyState
          icon={UserRoundPlus}
          title={info === null ? "Course not found" : "No course to set up"}
          hint={
            info === null
              ? "This invite link doesn't match a staffing period. Ask your coordinator for a fresh one."
              : "Ask your coordinator for an invite link to their course's staffing period."
          }
        />
      </div>
    );
  }

  // Redundant at runtime (covered by the first loading branch) but makes
  // TypeScript's narrowing of `info`/`profile` airtight below.
  if (info === undefined || profile === undefined) {
    return (
      <div>
        <PageHeader title="Courses & Preferences" />
        <Spinner label="Loading your setup…" />
      </div>
    );
  }

  const courseLabel = `${info.course?.courseId ?? "Course"} · ${termName(info.period.term)}`;

  if (profile === null) {
    const join = async () => {
      setJoining(true);
      try {
        await saveProfile({
          periodRef: periodId,
          maxHoursPerWeek: 10,
          enrolledSectionRefs: [],
          syncAsyncPreference: 0.5,
          dutyTypePrefs: [],
          sectionPrefs: [],
        });
        toast(`Joined ${info?.course?.courseId ?? "the course"} — set up your courses next`);
      } catch (err) {
        toast(err instanceof Error ? err.message : "Could not join", { tone: "error" });
      } finally {
        setJoining(false);
      }
    };
    return (
      <div>
        <PageHeader title="Courses & Preferences" description={courseLabel} />
        <Surface className="mx-auto mt-10 flex max-w-md flex-col items-center gap-3 px-6 py-10 text-center">
          <GraduationCap size={20} strokeWidth={1.5} className="text-faint" aria-hidden />
          <p className="text-[13px] font-medium text-ink">
            Join {info?.course?.courseId ?? "this course"} as a TA
          </p>
          <p className="text-[12.5px] text-muted">
            {info?.course?.name ?? ""} · {termName(info?.period.term ?? "")}
            {info?.period.collectionDeadline
              ? ` · availability due ${formatDate(info.period.collectionDeadline)}`
              : ""}
          </p>
          <Button variant="primary" className="mt-2" loading={joining} onClick={() => void join()}>
            Join course
          </Button>
        </Surface>
      </div>
    );
  }

  if (dutyTypes === undefined || shifts === undefined || availability === undefined) {
    return (
      <div>
        <PageHeader title="Courses & Preferences" description={courseLabel} />
        <Spinner label="Loading your setup…" />
      </div>
    );
  }

  return (
    <OnboardingView
      key={profile._id}
      courseLabel={courseLabel}
      term={info?.period.term ?? ""}
      termLabel={termName(info?.period.term ?? "")}
      deadline={info?.period.collectionDeadline}
      profile={{
        maxHoursPerWeek: profile.maxHoursPerWeek,
        syncAsyncPreference: profile.syncAsyncPreference,
        enrolledSectionRefs: profile.enrolledSectionRefs,
        dutyTypePrefs: profile.dutyTypePrefs,
        sectionPrefs: profile.sectionPrefs,
      }}
      dutyTypes={dutyTypes.map((d) => ({
        id: d._id,
        name: d.name,
        mode: d.mode,
        color: d.color,
      }))}
      sectionOptions={sectionOptions}
      importedBlocks={importedBlocks}
      onImportCourse={async (courseId) => {
        const res = await importCourse({ courseId, term: info?.period.term ?? "" });
        return { sectionsImported: res.sectionsImported, source: res.source };
      }}
      onSave={async (fields) => {
        await saveProfile({
          periodRef: periodId,
          maxHoursPerWeek: fields.maxHoursPerWeek,
          syncAsyncPreference: fields.syncAsyncPreference,
          enrolledSectionRefs: fields.enrolledSectionRefs as Id<"sections">[],
          dutyTypePrefs: fields.dutyTypePrefs as Id<"dutyTypes">[],
          sectionPrefs: fields.sectionPrefs as Id<"sections">[],
        });
      }}
    />
  );
}
