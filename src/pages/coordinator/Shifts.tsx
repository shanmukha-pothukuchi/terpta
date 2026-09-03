import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { Link } from "react-router-dom";
import { AlertTriangle, LayoutGrid, Plus } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import {
  Button,
  EmptyState,
  Input,
  Label,
  Modal,
  PageHeader,
  SegmentedControl,
  Select,
  Spinner,
  Surface,
  toast,
} from "../../components/ui";
import { usePeriod } from "../../lib/period";
import {
  DAY_CODES,
  DAY_LABELS,
  DAY_SHORT,
  formatDate,
  formatTimeRange,
  type DayCode,
} from "../../lib/format";
import { errorMessage } from "../../lib/errorMessage";

export type ShiftRow = FunctionReturnType<typeof api.shifts.list>[number];
export type DutyTypeRow = FunctionReturnType<typeof api.dutyTypes.list>[number];

/** Mirrors the backend's Fall 2026 defaults for new weekly shifts. */
const DEFAULT_START_DATE = "2026-08-31";
const DEFAULT_END_DATE = "2026-12-11";

const toTimeInput = (min?: number) =>
  min === undefined
    ? ""
    : `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

const fromTimeInput = (s: string): number | undefined => {
  const m = s.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return undefined;
  return Number(m[1]) * 60 + Number(m[2]);
};

/* ------------------------------------------------------------------ */
/* Availability hint — amber warning when fewer TAs than required      */
/* ------------------------------------------------------------------ */

export function AvailabilityHint({ available, required }: { available: number; required: number }) {
  if (available >= required) {
    return (
      <span className="font-mono text-[10.5px] text-faint">
        {available} TA{available === 1 ? "" : "s"} available
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 font-mono text-[10.5px] text-warn-text">
      <AlertTriangle size={11} strokeWidth={1.5} aria-hidden />
      {available === 0 ? "no TAs available" : `only ${available} available`} · needs {required}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Shift form modal — adapts to duty type mode                         */
/* ------------------------------------------------------------------ */

export interface ShiftFormFields {
  requiredCount: number;
  description?: string;
  recurrence?: "weekly" | "once";
  day?: DayCode;
  startMin?: number;
  endMin?: number;
  date?: string;
  startDate?: string;
  endDate?: string;
  hoursRequired?: number;
  dueDate?: string;
}

function ShiftFormModal({
  open,
  onClose,
  dutyType,
  initial,
  onSubmit,
  onDelete,
}: {
  open: boolean;
  onClose: () => void;
  dutyType: DutyTypeRow;
  initial: ShiftRow | null;
  onSubmit: (fields: ShiftFormFields) => void;
  onDelete?: () => void;
}) {
  const [recurrence, setRecurrence] = useState<"weekly" | "once">("weekly");
  const [day, setDay] = useState<DayCode>("M");
  const [startTime, setStartTime] = useState("10:00");
  const [endTime, setEndTime] = useState("11:00");
  const [date, setDate] = useState("");
  const [startDate, setStartDate] = useState(DEFAULT_START_DATE);
  const [endDate, setEndDate] = useState(DEFAULT_END_DATE);
  const [hoursRequired, setHoursRequired] = useState("4");
  const [dueDate, setDueDate] = useState("");
  const [requiredCount, setRequiredCount] = useState("1");
  const [description, setDescription] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  useEffect(() => {
    if (!open) return;
    setConfirmingDelete(false);
    setRecurrence(initial?.recurrence ?? "weekly");
    setDay(initial?.day ?? "M");
    setStartTime(initial?.startMin !== undefined ? toTimeInput(initial.startMin) : "10:00");
    setEndTime(initial?.endMin !== undefined ? toTimeInput(initial.endMin) : "11:00");
    setDate(initial?.date ?? "");
    setStartDate(initial?.startDate ?? DEFAULT_START_DATE);
    setEndDate(initial?.endDate ?? DEFAULT_END_DATE);
    setHoursRequired(initial?.hoursRequired !== undefined ? String(initial.hoursRequired) : "4");
    setDueDate(initial?.dueDate ?? "");
    setRequiredCount(initial ? String(initial.requiredCount) : "1");
    setDescription(initial?.description ?? "");
  }, [open, initial]);

  const submit = () => {
    const count = Math.max(1, Math.round(Number(requiredCount) || 1));
    const common = {
      requiredCount: count,
      description: description.trim() === "" ? undefined : description.trim(),
    };
    if (dutyType.mode === "async") {
      onSubmit({ ...common, hoursRequired: Number(hoursRequired) || 0, dueDate });
      return;
    }
    const startMin = fromTimeInput(startTime);
    const endMin = fromTimeInput(endTime);
    if (recurrence === "weekly") {
      onSubmit({ ...common, recurrence, day, startMin, endMin, startDate, endDate });
    } else {
      onSubmit({ ...common, recurrence, date, startMin, endMin });
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={initial ? `Edit ${dutyType.name} shift` : `Add ${dutyType.name} shift`}
      footer={
        <>
          {initial && onDelete ? (
            <Button
              variant="danger"
              className="mr-auto"
              onClick={() => {
                if (!confirmingDelete) {
                  setConfirmingDelete(true);
                  return;
                }
                onDelete();
              }}
            >
              {confirmingDelete ? "Confirm delete" : "Delete"}
            </Button>
          ) : null}
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit}>
            {initial ? "Save changes" : "Add shift"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3.5">
        {dutyType.mode === "sync" ? (
          <SegmentedControl
            options={[
              { value: "weekly", label: "Weekly" },
              { value: "once", label: "One-time" },
            ]}
            value={recurrence}
            onChange={setRecurrence}
          />
        ) : null}

        {dutyType.mode === "sync" && recurrence === "weekly" ? (
          <div className="flex items-end gap-2.5">
            <div className="w-32">
              <Label htmlFor="sf-day">Day</Label>
              <Select id="sf-day" value={day} onChange={(e) => setDay(e.target.value as DayCode)}>
                {DAY_CODES.map((d) => (
                  <option key={d} value={d}>
                    {DAY_LABELS[d]}
                  </option>
                ))}
              </Select>
            </div>
            <div className="w-28">
              <Label htmlFor="sf-start">Start</Label>
              <Input
                id="sf-start"
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="font-mono"
              />
            </div>
            <div className="w-28">
              <Label htmlFor="sf-end">End</Label>
              <Input
                id="sf-end"
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="font-mono"
              />
            </div>
          </div>
        ) : null}

        {dutyType.mode === "sync" && recurrence === "weekly" ? (
          <div className="flex items-end gap-2.5">
            <div className="w-40">
              <Label htmlFor="sf-from">First week</Label>
              <Input
                id="sf-from"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="font-mono"
              />
            </div>
            <div className="w-40">
              <Label htmlFor="sf-to">Last week</Label>
              <Input
                id="sf-to"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="font-mono"
              />
            </div>
          </div>
        ) : null}

        {dutyType.mode === "sync" && recurrence === "once" ? (
          <div className="flex items-end gap-2.5">
            <div className="w-40">
              <Label htmlFor="sf-date">Date (weekday)</Label>
              <Input
                id="sf-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="font-mono"
              />
            </div>
            <div className="w-28">
              <Label htmlFor="sf-start1">Start</Label>
              <Input
                id="sf-start1"
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="font-mono"
              />
            </div>
            <div className="w-28">
              <Label htmlFor="sf-end1">End</Label>
              <Input
                id="sf-end1"
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="font-mono"
              />
            </div>
          </div>
        ) : null}

        {dutyType.mode === "async" ? (
          <div className="flex items-end gap-2.5">
            <div className="w-32">
              <Label htmlFor="sf-hours">Hours per TA</Label>
              <Input
                id="sf-hours"
                type="number"
                min={0.5}
                step={0.5}
                value={hoursRequired}
                onChange={(e) => setHoursRequired(e.target.value)}
                className="text-right font-mono"
              />
            </div>
            <div className="w-40">
              <Label htmlFor="sf-due">Due date</Label>
              <Input
                id="sf-due"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="font-mono"
              />
            </div>
          </div>
        ) : null}

        <div className="flex items-end gap-2.5">
          <div className="w-32">
            <Label htmlFor="sf-count">TAs needed</Label>
            <Input
              id="sf-count"
              type="number"
              min={1}
              step={1}
              value={requiredCount}
              onChange={(e) => setRequiredCount(e.target.value)}
              className="text-right font-mono"
            />
          </div>
          <div className="flex-1">
            <Label htmlFor="sf-desc">Description</Label>
            <Input
              id="sf-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={dutyType.mode === "async" ? "e.g. Project 1 grading" : "e.g. Discussion 0101"}
            />
          </div>
        </div>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Blocks                                                              */
/* ------------------------------------------------------------------ */

function WeeklyBlock({ shift, name, onClick }: { shift: ShiftRow; name: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full cursor-pointer flex-col gap-1 rounded-[8px] border border-line bg-[rgba(255,255,255,0.035)] px-2 py-1.5 text-left transition-colors duration-100 hover:bg-[rgba(255,255,255,0.06)]"
    >
      <span className="flex items-baseline gap-1.5 whitespace-nowrap">
        <span className="truncate font-mono text-[11px] font-medium text-[#C9C9CF]">{name}</span>
        <span className="font-mono text-[10.5px] text-faint">
          {shift.startMin !== undefined && shift.endMin !== undefined
            ? formatTimeRange(shift.startMin, shift.endMin, { compact: true })
            : ""}
        </span>
      </span>
      <span className="flex items-center gap-1.5 text-[10.5px] text-muted">
        <span className="font-mono">needs {shift.requiredCount}</span>
        <AvailabilityHint available={shift.availableTaCount} required={shift.requiredCount} />
      </span>
    </button>
  );
}

function OnceCard({ shift, name, onClick }: { shift: ShiftRow; name: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-w-[200px] cursor-pointer flex-col gap-1.5 rounded-[10px] border border-line bg-[rgba(255,255,255,0.03)] p-2.5 text-left transition-colors duration-100 hover:bg-[rgba(255,255,255,0.06)]"
    >
      <span className="text-[12.5px] font-medium">{name}</span>
      <span className="font-mono text-[11.5px] text-muted">
        {shift.day ? `${DAY_SHORT[shift.day]} ` : ""}
        {shift.date ? formatDate(shift.date) : "—"}
        {shift.startMin !== undefined && shift.endMin !== undefined
          ? ` · ${formatTimeRange(shift.startMin, shift.endMin)}`
          : ""}
      </span>
      <span className="flex items-center gap-1.5 text-[10.5px] text-muted">
        <span className="font-mono">needs {shift.requiredCount}</span>
        <AvailabilityHint available={shift.availableTaCount} required={shift.requiredCount} />
      </span>
    </button>
  );
}

function AsyncCard({ shift, name, onClick }: { shift: ShiftRow; name: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex cursor-pointer flex-col gap-1.5 rounded-[10px] border border-line bg-[rgba(255,255,255,0.03)] p-2.5 text-left transition-colors duration-100 hover:bg-[rgba(255,255,255,0.06)]"
    >
      <span className="text-[12.5px] font-medium">{name}</span>
      <span className="font-mono text-[11.5px] text-muted">
        {shift.hoursRequired ?? 0}h per TA · {shift.requiredCount} TA
        {shift.requiredCount === 1 ? "" : "s"}
        {shift.dueDate ? ` · due ${formatDate(shift.dueDate)}` : ""}
      </span>
      <AvailabilityHint available={shift.availableTaCount} required={shift.requiredCount} />
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Pure view                                                           */
/* ------------------------------------------------------------------ */

export interface ShiftsViewProps {
  periodSelected: boolean;
  /** undefined = loading */
  dutyTypes: DutyTypeRow[] | undefined;
  shifts: ShiftRow[] | undefined;
  onCreate: (dutyTypeRef: Id<"dutyTypes">, fields: ShiftFormFields) => void;
  onUpdate: (shiftRef: Id<"shifts">, fields: ShiftFormFields) => void;
  onRemove: (shiftRef: Id<"shifts">) => void;
}

export function ShiftsView({
  periodSelected,
  dutyTypes,
  shifts,
  onCreate,
  onUpdate,
  onRemove,
}: ShiftsViewProps) {
  const [modal, setModal] = useState<{ dutyType: DutyTypeRow; shift: ShiftRow | null } | null>(null);

  if (!periodSelected) {
    return (
      <div>
        <PageHeader
          title="Shifts"
          description="Weekly and one-off shifts plus async duty pools for this period."
        />
        <EmptyState
          icon={LayoutGrid}
          title="No staffing period selected"
          hint="Create a staffing period first, then define shifts from your duty types."
        />
      </div>
    );
  }

  if (dutyTypes === undefined || shifts === undefined) {
    return (
      <div>
        <PageHeader
          title="Shifts"
          description="Weekly and one-off shifts plus async duty pools for this period."
        />
        <Spinner label="Loading shifts…" />
      </div>
    );
  }

  const scarce = shifts.filter((s) => s.availableTaCount < s.requiredCount).length;

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Shifts"
        description={
          `${shifts.length} shift${shifts.length === 1 ? "" : "s"} across ${dutyTypes.length} duty type${dutyTypes.length === 1 ? "" : "s"}` +
          (scarce > 0 ? ` · ${scarce} short on available TAs` : "")
        }
      />
      {dutyTypes.length === 0 ? (
        <EmptyState
          icon={LayoutGrid}
          title="No duty types yet"
          hint="Shifts hang off duty types — define those first."
        >
          <Link
            to="/coordinator/duty-types"
            className="text-[12.5px] font-medium text-ink underline underline-offset-2 hover:text-white"
          >
            Define duty types
          </Link>
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-4">
          {dutyTypes.map((dt) => {
            const own = shifts.filter((s) => s.dutyTypeRef === dt._id);
            const weekly = own
              .filter((s) => s.recurrence === "weekly")
              .sort((a, b) => (a.startMin ?? 0) - (b.startMin ?? 0));
            const once = own
              .filter((s) => s.recurrence === "once")
              .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
            const asyncShifts = own.filter((s) => s.recurrence === undefined);
            const nameOf = (s: ShiftRow) => s.description ?? dt.name;

            // Month grouping for the semester calendar strip.
            const onceByMonth: Array<{ month: string; items: ShiftRow[] }> = [];
            for (const s of once) {
              const month = s.date
                ? new Date(`${s.date}T00:00:00`).toLocaleDateString("en-US", {
                    month: "long",
                  })
                : "Undated";
              const last = onceByMonth[onceByMonth.length - 1];
              if (last && last.month === month) last.items.push(s);
              else onceByMonth.push({ month, items: [s] });
            }

            return (
              <Surface key={dt._id} className="overflow-hidden">
                <div className="flex h-10 items-center gap-2.5 border-b border-line px-3.5">
                  <span
                    className="size-2.5 rounded-[3px] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.15)]"
                    style={{ background: dt.color }}
                    aria-hidden
                  />
                  <span className="text-[13px] font-medium text-ink">{dt.name}</span>
                  <span className="text-[12px] text-faint">
                    {dt.mode === "sync"
                      ? `sync · ${weekly.length} weekly · ${once.length} one-time`
                      : `async · ${asyncShifts.length} pool${asyncShifts.length === 1 ? "" : "s"}`}
                  </span>
                  <span className="flex-1" />
                  <Button size="sm" onClick={() => setModal({ dutyType: dt, shift: null })}>
                    <Plus size={13} strokeWidth={1.5} aria-hidden />
                    Add shift
                  </Button>
                </div>

                {own.length === 0 ? (
                  <p className="px-3.5 py-4 text-[12.5px] text-faint">
                    No {dt.name.toLowerCase()} shifts yet.
                  </p>
                ) : null}

                {/* Weekly grid */}
                {weekly.length > 0 ? (
                  <div className="grid grid-cols-5">
                    {DAY_CODES.map((day) => {
                      const blocks = weekly.filter((s) => s.day === day);
                      return (
                        <div
                          key={day}
                          className="border-l border-[rgba(255,255,255,0.06)] first:border-l-0"
                        >
                          <div className="flex h-[30px] items-center border-b border-[rgba(255,255,255,0.06)] px-2 text-[12px] font-medium text-[#C9C9CF]">
                            {DAY_SHORT[day]}
                          </div>
                          <div className="flex min-h-14 flex-col gap-1.5 p-1.5">
                            {blocks.map((s) => (
                              <WeeklyBlock
                                key={s._id}
                                shift={s}
                                name={nameOf(s)}
                                onClick={() => setModal({ dutyType: dt, shift: s })}
                              />
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : null}

                {/* Semester calendar strip for one-time events */}
                {once.length > 0 ? (
                  <div
                    className={
                      "flex gap-4 overflow-x-auto p-3 " +
                      (weekly.length > 0 ? "border-t border-[rgba(255,255,255,0.06)]" : "")
                    }
                  >
                    {onceByMonth.map(({ month, items }) => (
                      <div key={month} className="flex shrink-0 flex-col gap-1.5">
                        <span className="text-[10.5px] font-medium uppercase tracking-[0.06em] text-faint">
                          {month}
                        </span>
                        <div className="flex gap-2">
                          {items.map((s) => (
                            <OnceCard
                              key={s._id}
                              shift={s}
                              name={nameOf(s)}
                              onClick={() => setModal({ dutyType: dt, shift: s })}
                            />
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}

                {/* Async pools */}
                {asyncShifts.length > 0 ? (
                  <div className="grid grid-cols-2 gap-2.5 p-3 lg:grid-cols-3">
                    {asyncShifts.map((s) => (
                      <AsyncCard
                        key={s._id}
                        shift={s}
                        name={nameOf(s)}
                        onClick={() => setModal({ dutyType: dt, shift: s })}
                      />
                    ))}
                  </div>
                ) : null}
              </Surface>
            );
          })}
        </div>
      )}

      {modal ? (
        <ShiftFormModal
          open
          onClose={() => setModal(null)}
          dutyType={modal.dutyType}
          initial={modal.shift}
          onSubmit={(fields) => {
            if (modal.shift) onUpdate(modal.shift._id, fields);
            else onCreate(modal.dutyType._id, fields);
            setModal(null);
          }}
          onDelete={
            modal.shift
              ? () => {
                  onRemove(modal.shift!._id);
                  setModal(null);
                }
              : undefined
          }
        />
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Wired page                                                          */
/* ------------------------------------------------------------------ */

export default function Shifts() {
  const { periodId } = usePeriod();
  const dutyTypes = useQuery(api.dutyTypes.list, periodId ? { periodRef: periodId } : "skip");
  const shifts = useQuery(api.shifts.list, periodId ? { periodRef: periodId } : "skip");
  const create = useMutation(api.shifts.create);
  const update = useMutation(api.shifts.update);
  const remove = useMutation(api.shifts.remove);

  return (
    <ShiftsView
      periodSelected={periodId !== null}
      dutyTypes={periodId ? dutyTypes : undefined}
      shifts={periodId ? shifts : undefined}
      onCreate={(dutyTypeRef, fields) => {
        if (!periodId) return;
        create({ periodRef: periodId, dutyTypeRef, ...fields })
          .then(() => toast("Shift added"))
          .catch((e) => toast(errorMessage(e), { tone: "error" }));
      }}
      onUpdate={(shiftRef, fields) => {
        update({ shiftRef, ...fields })
          .then(() => toast("Shift updated"))
          .catch((e) => toast(errorMessage(e), { tone: "error" }));
      }}
      onRemove={(shiftRef) => {
        remove({ shiftRef })
          .then(() => toast("Shift deleted"))
          .catch((e) => toast(errorMessage(e), { tone: "error" }));
      }}
    />
  );
}
