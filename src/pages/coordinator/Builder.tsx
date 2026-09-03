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
import { RefreshCw, Send, TriangleAlert, Undo2, Wand2 } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { usePeriod } from "../../lib/period";
import {
  Badge,
  Button,
  EmptyState,
  FullPageSpinner,
  toast,
} from "../../components/ui";
import {
  buildModel,
  firstName,
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
import { TaDrawer } from "./builder/TaDrawer";
import { PublishModal } from "./builder/PublishModal";

/** Fixture bundle so a DEV preview harness can render without auth/Convex. */
export interface BuilderFixture {
  shifts: ShiftRow[];
  dutyTypes: DutyType[];
  roster: RosterRow[];
  board: BoardData;
  status: "draft" | "collecting" | "generated" | "published";
  courseLabel: string;
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
  initialPublishOpen = false,
}: {
  periodRef: Id<"staffingPeriods">;
  fixture?: BuilderFixture;
  /** DEV harness: TA drawer payload, skips the api.builder.taDetail query. */
  fixtureDetail?: TaDetailData;
  /** DEV harness: open the TA drawer for this profile on mount. */
  initialDrawerTa?: Id<"taProfiles"> | null;
  /** DEV harness: open the publish modal on mount. */
  initialPublishOpen?: boolean;
}) {
  const skip = fixture !== undefined;
  const shifts = useQuery(api.shifts.list, skip ? "skip" : { periodRef });
  const dutyTypes = useQuery(api.dutyTypes.list, skip ? "skip" : { periodRef });
  const roster = useQuery(api.roster.list, skip ? "skip" : { periodRef });
  const board = useQuery(api.builder.board, skip ? "skip" : { periodRef });
  const periodInfo = useQuery(api.periods.get, skip ? "skip" : { periodRef });

  const overrideAssignment = useMutation(api.builder.overrideAssignment);
  const removeAssignment = useMutation(api.builder.removeAssignment);
  const toggleLockMut = useMutation(api.builder.toggleLock);
  const generateAction = useAction(api.builder.generate);
  const publishMut = useMutation(api.periods.publish);

  const [highlight, setHighlight] = useState<Highlight>(null);
  const [drawerTa, setDrawerTa] = useState<Id<"taProfiles"> | null>(initialDrawerTa);
  const [publishOpen, setPublishOpen] = useState(initialPublishOpen);
  const [publishing, setPublishing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [addedTaIds, setAddedTaIds] = useState<string[]>([]);
  const [dragName, setDragName] = useState<string | null>(null);

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
      ? `${periodInfo.course.courseId} · ${periodInfo.period.term}`
      : "",
  };

  const model: BuilderModel | null = useMemo(() => {
    if (!data.shifts || !data.dutyTypes || !data.roster || !data.board) return null;
    return buildModel(data.shifts, data.dutyTypes, data.roster, data.board);
  }, [data.shifts, data.dutyTypes, data.roster, data.board]);

  if (model === null || data.status === undefined) {
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
        toast(`${firstName(model.taName(taProfileRef))} assigned`, {
          tone: "success",
        });
      }
    } catch (e) {
      err(e, "Assignment failed");
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
      toast(
        unfilled > 0
          ? `Generated · ${unfilled} seats still unfilled · locks kept`
          : "Generated · all shifts filled · locks kept",
        { tone: unfilled > 0 ? "info" : "success" },
      );
    } catch (e) {
      err(e, "Generate failed");
    } finally {
      setGenerating(false);
    }
  };

  const onPublish = async (notify: boolean) => {
    setPublishing(true);
    try {
      await publishMut({ periodRef });
      setPublishOpen(false);
      toast(notify ? "Schedule published · TAs can now see it" : "Schedule published", {
        tone: "success",
      });
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
    if (!overId.startsWith("shift:")) return;
    const payload = e.active.data.current as DragPayload | undefined;
    if (!payload) return;
    const source = payload.fromAssignmentRef
      ? data.board!.assignments.find((a) => a._id === payload.fromAssignmentRef)
      : undefined;
    void doAssign(
      payload.taProfileRef,
      overId.slice("shift:".length) as Id<"shifts">,
      source,
    );
  };

  let conflictCount = 0;
  for (const list of model.conflictsByAssignment.values()) {
    conflictCount += list.length;
  }
  const published = data.status === "published";

  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
      <div className="flex min-w-0 flex-col gap-4">
        <div className="flex items-center gap-3">
          <div className="text-xl font-semibold tracking-[-0.02em]">Builder</div>
          {published ? (
            <Badge tone="green">Published</Badge>
          ) : (
            <Badge tone="neutral" dot={false}>
              Draft
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
                onOpenTa={setDrawerTa}
                onToggleLock={(ref) => void onToggleLock(ref)}
              />
              <EventsStrip
                model={model}
                highlight={highlight}
                onOpenTa={setDrawerTa}
                onToggleLock={(ref) => void onToggleLock(ref)}
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
                onToggle={(key) => setHighlight((h) => (h === key ? null : key))}
                onClear={() => setHighlight(null)}
              />
              <RosterPanel model={model} highlight={highlight} onOpenTa={setDrawerTa} />
            </div>
          </div>
        )}
      </div>

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
        model={model}
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
