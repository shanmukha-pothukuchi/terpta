import { Component, useMemo, useRef, useState, type ReactNode } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { CalendarOff, RefreshCw, Send, TriangleAlert, Undo2, Wand2 } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { formatDate, termName } from "../../lib/format";
import { thisMonday } from "../../lib/week";
import { WeekNav } from "../../components/WeekNav";
import { usePeriod } from "../../lib/period";
import { useHiddenIds } from "../../lib/viewFilter";
import { DutyFilterBar, type DutyFilterItem } from "../../components/DutyFilterBar";
import {
  Badge,
  Button,
  EmptyState,
  FullPageSpinner,
  toast,
} from "../../components/ui";
import {
  buildModel,
  type BoardAssignment,
  type BoardData,
  type BuilderModel,
  type DutyType,
  type Highlight,
  type RosterRow,
  type ShiftRow,
  type TaDetailData,
} from "./builder/model";
import { ChipGhost, type DragPayload } from "./builder/AssignChip";
import { WeekGrid } from "./builder/WeekGrid";
import { EventsStrip } from "./builder/EventsStrip";
import { AsyncTable } from "./builder/AsyncTable";
import { DiagnosticsPanel } from "./builder/DiagnosticsPanel";
import { RosterPanel } from "./builder/RosterPanel";
import { CoveragePanel } from "./builder/CoveragePanel";
import {
  awayTaIds,
  buildWeekOverlay,
  coverageDropTarget,
  coverageFor,
  type WeekCoverage,
  type WeekOverlayInput,
} from "./builder/weekOverlay";
import { TaDrawer } from "./builder/TaDrawer";
import { ShiftDrawer, type ShiftCandidate } from "./builder/ShiftDrawer";
import { PublishModal } from "./builder/PublishModal";

/** Fixture bundle so a DEV preview harness can render without auth/Convex. */
export interface BuilderFixture {
  shifts: ShiftRow[];
  dutyTypes: DutyType[];
  roster: RosterRow[];
  board: BoardData;
  status: "draft" | "collecting" | "generated" | "published";
  courseLabel: string;
  /** DEV harness: week overlay, since the week query is skipped under a fixture. */
  week?: WeekOverlayInput;
}

class BuilderErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <EmptyState
          icon={TriangleAlert}
          title="The builder hit an error"
          hint={this.state.error.message}
        >
          <Button variant="secondary" onClick={() => this.setState({ error: null })}>
            Try again
          </Button>
        </EmptyState>
      );
    }
    return this.props.children;
  }
}

export default function Builder() {
  const { periodId } = usePeriod();
  if (!periodId) {
    return (
      <EmptyState
        icon={Wand2}
        title="No course selected"
        hint="Pick a course and term from the switcher in the top bar to open its builder."
      />
    );
  }
  return (
    <BuilderErrorBoundary>
      <BuilderScreen periodRef={periodId} />
    </BuilderErrorBoundary>
  );
}

/** Data wiring + interaction state. Exported for the DEV preview harness. */
export function BuilderScreen({
  periodRef,
  fixture,
  fixtureDetail,
  initialDrawerTa = null,
  initialDrawerShift = null,
  fixtureCandidates,
  initialPublishOpen = false,
}: {
  periodRef: Id<"staffingPeriods">;
  fixture?: BuilderFixture;
  /** DEV harness: TA drawer payload, skips the api.builder.taDetail query. */
  fixtureDetail?: TaDetailData;
  /** DEV harness: open the TA drawer for this profile on mount. */
  initialDrawerTa?: Id<"taProfiles"> | null;
  /** DEV harness: open the shift panel for this shift on mount. */
  initialDrawerShift?: Id<"shifts"> | null;
  /** DEV harness: shift-panel candidate list, skips the Convex query. */
  fixtureCandidates?: ShiftCandidate[];
  /** DEV harness: open the publish modal on mount. */
  initialPublishOpen?: boolean;
}) {
  const skip = fixture !== undefined;
  const shifts = useQuery(api.shifts.list, skip ? "skip" : { periodRef });
  const dutyTypes = useQuery(api.dutyTypes.list, skip ? "skip" : { periodRef });
  const roster = useQuery(api.roster.list, skip ? "skip" : { periodRef });
  const board = useQuery(api.builder.board, skip ? "skip" : { periodRef });
  const periodInfo = useQuery(api.periods.get, skip ? "skip" : { periodRef });

  const setCoverMut = useMutation(api.coverage.setCover);
  const overrideAssignment = useMutation(api.builder.overrideAssignment);
  const removeAssignment = useMutation(api.builder.removeAssignment);
  const toggleLockMut = useMutation(api.builder.toggleLock);
  const generateAction = useAction(api.builder.generate);
  const publishAndNotify = useAction(api.periods.publishAndNotify);

  const [highlight, setHighlight] = useState<Highlight>(null);
  const [drawerTa, setDrawerTa] = useState<Id<"taProfiles"> | null>(initialDrawerTa);
  const [drawerShift, setDrawerShift] = useState<Id<"shifts"> | null>(initialDrawerShift);
  const [publishOpen, setPublishOpen] = useState(initialPublishOpen);
  const [publishing, setPublishing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [addedTaIds, setAddedTaIds] = useState<string[]>([]);
  const [dragName, setDragName] = useState<string | null>(null);
  const [weekStart, setWeekStart] = useState(
    () => fixture?.week?.weekStart ?? thisMonday(),
  );

  // Scoped to the period so two courses do not share one filter.
  const hiddenDuties = useHiddenIds(`terpta:builder-hidden-duties:${periodRef}`);

  const undoStack = useRef<Array<() => Promise<void>>>([]);
  const [undoCount, setUndoCount] = useState(0);
  const pushUndo = (fn: () => Promise<void>) => {
    undoStack.current = [...undoStack.current, fn].slice(-30);
    setUndoCount(undoStack.current.length);
  };
  const undo = async () => {
    const fn = undoStack.current.pop();
    setUndoCount(undoStack.current.length);
    if (!fn) return;
    try {
      await fn();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Undo failed", { tone: "error" });
    }
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  const data = fixture ?? {
    shifts,
    dutyTypes,
    roster,
    board,
    status: periodInfo?.period.status,
    courseLabel: periodInfo?.course
      ? `${periodInfo.course.courseId} · ${termName(periodInfo.period.term)}`
      : "",
  };

  // The board is a repeating template; this is what is different about
  // the selected week. Skipped under a fixture so previews stay pure.
  const weekData = useQuery(
    api.weeks.builderWeek,
    skip ? "skip" : { periodRef, weekStart },
  );
  const fixtureWeek = fixture?.week;
  const week = useMemo(() => {
    const input = fixtureWeek ?? weekData;
    return input ? buildWeekOverlay(input) : null;
  }, [fixtureWeek, weekData]);

  // The whole board, whatever is being shown of it. Publishing reads this
  // one: a filtered summary of what is about to go out to TAs would be a lie.
  const fullModel: BuilderModel | null = useMemo(() => {
    if (!data.shifts || !data.dutyTypes || !data.roster || !data.board) return null;
    return buildModel(data.shifts, data.dutyTypes, data.roster, data.board);
  }, [data.shifts, data.dutyTypes, data.roster, data.board]);

  // What the board itself draws. Hiding a duty type is a view preference —
  // the shifts keep their assignments and still publish.
  const model: BuilderModel | null = useMemo(() => {
    if (!fullModel) return null;
    if (hiddenDuties.hidden.size === 0) return fullModel;
    const visible = data.shifts!.filter(
      (s) => !hiddenDuties.hidden.has(s.dutyTypeRef as string),
    );
    return buildModel(visible, data.dutyTypes!, data.roster!, data.board!);
  }, [fullModel, hiddenDuties.hidden, data.shifts, data.dutyTypes, data.roster, data.board]);

  if (model === null || fullModel === null || data.status === undefined) {
    return <FullPageSpinner label="Loading builder…" />;
  }

  const shiftById = (id: string): ShiftRow | undefined =>
    data.shifts!.find((s) => (s._id as string) === id);

  const err = (e: unknown, fallback: string) =>
    toast(e instanceof Error ? e.message : fallback, { tone: "error" });

  /** Assign (or move) a TA into a sync slot / event, replacing an unlocked
      chip when the slot is already at capacity. Records an inverse op. */
  const doAssign = async (
    taProfileRef: Id<"taProfiles">,
    targetShiftRef: Id<"shifts">,
    source?: BoardAssignment,
    announce = false,
  ) => {
    const shift = shiftById(targetShiftRef as string);
    if (!shift) return;
    if (source && source.shiftRef === targetShiftRef) return;
    const assigned = model.assignmentsByShift.get(targetShiftRef as string) ?? [];
    if (assigned.some((a) => a.taProfileRef === taProfileRef)) return;

    let victim: BoardAssignment | undefined;
    if (assigned.length >= shift.requiredCount) {
      victim = assigned.find((a) => !a.locked);
      if (!victim) {
        toast("All assignments in that slot are locked", { tone: "error" });
        return;
      }
    }
    try {
      if (victim) await removeAssignment({ assignmentRef: victim._id });
      const res = await overrideAssignment({
        shiftRef: targetShiftRef,
        taProfileRef,
      });
      if (source) await removeAssignment({ assignmentRef: source._id });

      const replaced = victim;
      pushUndo(async () => {
        await removeAssignment({ assignmentRef: res.assignmentRef });
        if (source) {
          await overrideAssignment({
            shiftRef: source.shiftRef,
            taProfileRef,
            ...(source.hoursAllocated !== undefined
              ? { hoursAllocated: source.hoursAllocated }
              : {}),
          });
        }
        if (replaced) {
          await overrideAssignment({
            shiftRef: targetShiftRef,
            taProfileRef: replaced.taProfileRef,
            ...(replaced.hoursAllocated !== undefined
              ? { hoursAllocated: replaced.hoursAllocated }
              : {}),
          });
        }
      });

      if (res.conflicts.length > 0) {
        toast(res.conflicts[0].detail, { tone: "error" });
      } else if (announce) {
        toast(`${model.taShort(taProfileRef)} assigned`, {
          tone: "success",
        });
      }
    } catch (e) {
      err(e, "Assignment failed");
    }
  };

  const shiftLabel = (shiftRef: Id<"shifts">): string => {
    const shift = shiftById(shiftRef as string);
    if (!shift) return "that shift";
    const section = shift.sectionRef
      ? model.sectionById.get(shift.sectionRef as string)
      : undefined;
    return section
      ? section.sectionNumber
      : (model.dutyById.get(shift.dutyTypeRef as string)?.name ?? "that shift");
  };

  /**
   * Fill an open one-off hole for a single date.
   *
   * Dropping someone onto a slot that is short for one meeting means "stand
   * in that day", not "join this shift every week for the rest of term" — the
   * absent TA keeps the standing assignment. Making it recurring is a
   * deliberate second choice, offered on the toast rather than assumed.
   */
  const doCover = async (cov: WeekCoverage, taProfileRef: Id<"taProfiles">) => {
    const name = model.taShort(taProfileRef);
    try {
      await setCoverMut({ coverageRef: cov._id, coverTaRef: taProfileRef });
      pushUndo(async () => {
        await setCoverMut({ coverageRef: cov._id });
      });
      toast(
        `${name} covers ${shiftLabel(cov.shiftRef)} on ${formatDate(cov.date)} — that date only`,
        {
          tone: "success",
          duration: 8000,
          link: {
            label: "Make it permanent",
            onClick: () => void makeCoverPermanent(cov, taProfileRef),
          },
        },
      );
    } catch (e) {
      err(e, "Could not set the cover");
    }
  };

  /** Promote a one-date stand-in to the standing assignment for the shift. */
  const makeCoverPermanent = async (
    cov: WeekCoverage,
    taProfileRef: Id<"taProfiles">,
  ) => {
    try {
      await setCoverMut({ coverageRef: cov._id });
      await doAssign(taProfileRef, cov.shiftRef);
      toast(
        `${model.taShort(taProfileRef)} now has ${shiftLabel(cov.shiftRef)} every week`,
      );
    } catch (e) {
      err(e, "Could not make that permanent");
    }
  };

  /** Take a TA off a slot, with the inverse op recorded for Undo. */
  const doUnassign = async (assignmentRef: Id<"assignments">) => {
    const existing = data.board?.assignments.find((a) => a._id === assignmentRef);
    if (!existing) return;
    if (existing.locked) {
      toast("Unlock the assignment first", { tone: "error" });
      return;
    }
    try {
      await removeAssignment({ assignmentRef });
      pushUndo(async () => {
        await overrideAssignment({
          shiftRef: existing.shiftRef,
          taProfileRef: existing.taProfileRef,
          ...(existing.hoursAllocated !== undefined
            ? { hoursAllocated: existing.hoursAllocated }
            : {}),
        });
      });
      toast(`${model.taShort(existing.taProfileRef)} removed`);
    } catch (e) {
      err(e, "Could not remove that assignment");
    }
  };

  const onChangeHours = async (
    shift: ShiftRow,
    taProfileRef: Id<"taProfiles">,
    n: number,
    existing: BoardAssignment | undefined,
  ) => {
    try {
      if (n <= 0) {
        if (!existing) return;
        const prev = existing.hoursAllocated ?? shift.hoursRequired ?? 0;
        await removeAssignment({ assignmentRef: existing._id });
        pushUndo(async () => {
          await overrideAssignment({
            shiftRef: shift._id,
            taProfileRef,
            hoursAllocated: prev,
          });
        });
        return;
      }
      const prev = existing
        ? (existing.hoursAllocated ?? shift.hoursRequired ?? 0)
        : undefined;
      const res = await overrideAssignment({
        shiftRef: shift._id,
        taProfileRef,
        hoursAllocated: n,
      });
      pushUndo(async () => {
        if (prev === undefined) {
          await removeAssignment({ assignmentRef: res.assignmentRef });
        } else {
          await overrideAssignment({
            shiftRef: shift._id,
            taProfileRef,
            hoursAllocated: prev,
          });
        }
      });
      if (res.conflicts.length > 0) toast(res.conflicts[0].detail, { tone: "error" });
    } catch (e) {
      err(e, "Could not update hours");
    }
  };

  const onToggleLock = async (assignmentRef: Id<"assignments">) => {
    try {
      await toggleLockMut({ assignmentRef });
      pushUndo(async () => {
        await toggleLockMut({ assignmentRef });
      });
    } catch (e) {
      err(e, "Could not toggle lock");
    }
  };

  const lockCount = data.board!.assignments.filter((a) => a.locked).length;
  const hasAssignments = data.board!.assignments.length > 0;

  const onGenerate = async () => {
    setGenerating(true);
    try {
      const diag = await generateAction({ periodRef });
      undoStack.current = [];
      setUndoCount(0);
      const unfilled = diag.unfilledShifts.reduce((n, u) => n + u.missing, 0);
      const unplacedOh = diag.unfilledWindowHours.reduce((n, u) => n + u.missingHours, 0);
      const parts = [
        unfilled > 0 ? `${unfilled} seats still unfilled` : "all shifts filled",
        unplacedOh > 0
          ? `${unplacedOh}h of office hours could not be placed for ${diag.unfilledWindowHours.length} TA${diag.unfilledWindowHours.length === 1 ? "" : "s"}`
          : null,
        "locks kept",
      ].filter(Boolean);
      toast(`Generated · ${parts.join(" · ")}`, {
        tone: unfilled > 0 || unplacedOh > 0 ? "info" : "success",
        duration: unplacedOh > 0 ? 9000 : 4000,
      });
    } catch (e) {
      err(e, "Generate failed");
    } finally {
      setGenerating(false);
    }
  };

  const onPublish = async (notify: boolean) => {
    setPublishing(true);
    try {
      const mail = await publishAndNotify({ periodRef, notify });
      setPublishOpen(false);
      // The notice is only worth announcing if it actually went somewhere.
      if (!mail) {
        toast("Schedule published", { tone: "success" });
      } else if (mail.failures.length === 0) {
        toast(`Schedule published · ${mail.delivered} TA${mail.delivered === 1 ? "" : "s"} emailed`, {
          tone: "success",
        });
      } else {
        toast(
          `Schedule published, but ${mail.failures.length} of ${mail.attempted} emails failed — ${mail.failures[0].error}`,
          { tone: "error", duration: 10000 },
        );
      }
    } catch (e) {
      err(e, "Publish failed");
    } finally {
      setPublishing(false);
    }
  };

  const onDragStart = (e: DragStartEvent) => {
    const payload = e.active.data.current as DragPayload | undefined;
    setDragName(payload?.name ?? null);
  };
  const onDragEnd = (e: DragEndEvent) => {
    setDragName(null);
    if (!e.over) return;
    const overId = String(e.over.id);
    const payload = e.active.data.current as DragPayload | undefined;
    if (!payload) return;
    // Dragging a chip back to the roster takes the TA off the slot. Without
    // this the only droppables were shifts, so a drag meant to remove someone
    // landed on nothing and looked like the drag itself had failed.
    if (overId === "unassign") {
      if (payload.fromAssignmentRef) void doUnassign(payload.fromAssignmentRef);
      return;
    }
    if (!overId.startsWith("shift:")) return;
    const targetShiftRef = overId.slice("shift:".length) as Id<"shifts">;
    const source = payload.fromAssignmentRef
      ? data.board!.assignments.find((a) => a._id === payload.fromAssignmentRef)
      : undefined;

    // A name dragged from the roster onto a slot with an open hole this week
    // fills that one meeting. Moving an existing chip is left alone: that
    // gesture already means "change the standing roster", and quietly turning
    // it into a one-date stand-in would strand the TA's other shift.
    const target = shiftById(targetShiftRef as string);
    const open = coverageDropTarget(week, targetShiftRef, target?.day, payload.taProfileRef, {
      isMove: source !== undefined,
    });
    if (open) {
      void doCover(open, payload.taProfileRef);
      return;
    }

    void doAssign(payload.taProfileRef, targetShiftRef, source);
  };

  // One chip per duty type that has anything on the board, counted from the
  // unfiltered model so a chip never reads 0 just because it is hidden.
  const dutyFilterItems: DutyFilterItem[] = data.dutyTypes!.map((d) => ({
    id: d._id as string,
    name: d.name,
    color: d.color,
    count: data.shifts!.filter(
      (s) => (s.dutyTypeRef as string) === (d._id as string) && s.windowRef === undefined,
    ).length,
  })).filter((d) => d.count > 0);
  const openShift =
    drawerShift !== null ? shiftById(drawerShift as string) : undefined;
  // Only offer "this date only" when there is a hole to fill on it; otherwise
  // the panel would quietly write a one-week cover nobody asked for.
  const coverageOfOpenShift = openShift
    ? coverageFor(week, openShift._id, openShift.day)
    : undefined;
  const openShiftCoverage =
    coverageOfOpenShift && coverageOfOpenShift.coverTaRef === null
      ? coverageOfOpenShift
      : undefined;

  let conflictCount = 0;
  for (const list of model.conflictsByAssignment.values()) {
    conflictCount += list.length;
  }
  const published = data.status === "published";

  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
      <div className="flex min-w-0 flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="text-xl font-semibold tracking-[-0.02em]">Builder</div>
          {published ? (
            <Badge tone="green">Published</Badge>
          ) : (
            <Badge tone="neutral" dot={false}>
              Draft
            </Badge>
          )}
          {/* The board is a repeating template. Paging to a week reveals what
              is actually true of it: who is away, who is standing in, which
              shifts are out of term. */}
          {(!fixture || fixture.week) && (
            <WeekNav weekStart={weekStart} onChange={setWeekStart} compact />
          )}
          {week && week.absences.length > 0 && (
            <Badge tone="amber">
              <CalendarOff size={11} strokeWidth={1.5} aria-hidden />
              {week.absences.length} away
            </Badge>
          )}
          <div className="text-[12.5px] text-faint">
            {conflictCount} conflict{conflictCount === 1 ? "" : "s"} ·{" "}
            {model.overTaIds.size} over cap
          </div>
          <div className="flex-1" />
          <Button
            variant="secondary"
            onClick={() => void undo()}
            disabled={undoCount === 0}
            className={undoCount === 0 ? "opacity-45" : undefined}
          >
            <Undo2 size={14} strokeWidth={1.5} className="text-muted" />
            Undo
          </Button>
          <Button variant="secondary" loading={generating} onClick={() => void onGenerate()}>
            <RefreshCw size={14} strokeWidth={1.5} className="text-muted" />
            {hasAssignments ? "Regenerate" : "Generate"}
            <span className="text-faint">· keeps {lockCount} locks</span>
          </Button>
          <Button variant="primary" onClick={() => setPublishOpen(true)}>
            <Send size={14} strokeWidth={1.5} />
            Publish
          </Button>
        </div>

        {dutyFilterItems.length > 1 ? (
          <DutyFilterBar
            items={dutyFilterItems}
            hidden={hiddenDuties.hidden}
            onToggle={hiddenDuties.toggle}
            onShowAll={hiddenDuties.showAll}
          />
        ) : null}

        {data.shifts!.length === 0 ? (
          <EmptyState
            icon={Wand2}
            title="Nothing to build yet"
            hint="Create shifts (and invite TAs to submit availability) first — then generate a draft schedule here."
          />
        ) : (
          <div className="grid items-start gap-4 [grid-template-columns:minmax(0,1fr)_312px]">
            <div className="flex min-w-0 flex-col gap-4">
              <WeekGrid
                model={model}
                highlight={highlight}
                week={week}
                onOpenTa={setDrawerTa}
                onOpenShift={(shift) => setDrawerShift(shift._id)}
                onToggleLock={(ref) => void onToggleLock(ref)}
                onRemoveAssignment={(ref) => void doUnassign(ref)}
              />
              <EventsStrip
                model={model}
                highlight={highlight}
                onOpenTa={setDrawerTa}
                onOpenShift={(shift) => setDrawerShift(shift._id)}
                onToggleLock={(ref) => void onToggleLock(ref)}
                onRemoveAssignment={(ref) => void doUnassign(ref)}
              />
              <AsyncTable
                model={model}
                addedTaIds={addedTaIds}
                onAddTa={(id) => setAddedTaIds((prev) => [...prev, id])}
                onOpenTa={setDrawerTa}
                onChangeHours={(shift, ta, n, existing) =>
                  void onChangeHours(shift, ta, n, existing)
                }
              />
            </div>
            <div className="sticky top-4 flex flex-col gap-4">
              <DiagnosticsPanel
                model={model}
                highlight={highlight}
                week={week}
                onToggle={(key) => setHighlight((h) => (h === key ? null : key))}
                onClear={() => setHighlight(null)}
              />
              <RosterPanel
                model={model}
                highlight={highlight}
                awayTaIds={awayTaIds(week)}
                onOpenTa={setDrawerTa}
              />
              {/* Approved single-date swaps land here as fill-in slots. */}
              {!fixture && <CoveragePanel periodRef={periodRef} />}
            </div>
          </div>
        )}
      </div>

      {/* The shift panel is the long form of a board block: every field it
          truncates, plus the roster ranked against the slot. A TA opened from
          inside it stacks on top and closes back to it. */}
      {openShift !== undefined && (
        <ShiftDrawer
          shift={openShift}
          model={model}
          week={week}
          // A preview must never reach Convex: an empty list is the honest
          // answer for a fixture that did not supply one.
          fixtureCandidates={fixture ? (fixtureCandidates ?? []) : undefined}
          onClose={() => setDrawerShift(null)}
          onOpenTa={setDrawerTa}
          onAssign={(ta) => void doAssign(ta, openShift._id, undefined, true)}
          onCoverDate={
            openShiftCoverage
              ? (ta) => void doCover(openShiftCoverage, ta)
              : undefined
          }
          onToggleLock={(ref) => void onToggleLock(ref)}
          onRemoveAssignment={(ref) => void doUnassign(ref)}
        />
      )}

      {drawerTa !== null && (
        <TaDrawer
          taProfileRef={drawerTa}
          fixtureDetail={fixtureDetail}
          model={model}
          onClose={() => setDrawerTa(null)}
          onAssign={(shiftRef) => void doAssign(drawerTa, shiftRef, undefined, true)}
        />
      )}

      <PublishModal
        open={publishOpen}
        onClose={() => setPublishOpen(false)}
        model={fullModel}
        courseLabel={data.courseLabel || "This course"}
        publishing={publishing}
        onPublish={(notify) => void onPublish(notify)}
      />

      <DragOverlay dropAnimation={null}>
        {dragName ? <ChipGhost name={dragName} /> : null}
      </DragOverlay>
    </DndContext>
  );
}
