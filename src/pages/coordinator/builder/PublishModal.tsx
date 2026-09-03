import { useState } from "react";
import { Modal, Button } from "../../../components/ui";
import type { BuilderModel } from "./model";

export interface PublishModalProps {
  open: boolean;
  onClose: () => void;
  model: BuilderModel;
  courseLabel: string;
  publishing: boolean;
  onPublish: (notify: boolean) => void;
}

/** Publish confirmation: live draft summary, notify toggle, red confirm. */
export function PublishModal({
  open,
  onClose,
  model,
  courseLabel,
  publishing,
  onPublish,
}: PublishModalProps) {
  const [notify, setNotify] = useState(true);

  const assignedCount = (id: string) =>
    model.assignmentsByShift.get(id)?.length ?? 0;

  const sections = model.weekly.filter((s) => s.sectionRef !== undefined);
  const sectionsFilled = sections.filter(
    (s) => assignedCount(s._id as string) >= s.requiredCount,
  ).length;
  const other = model.weekly.filter((s) => s.sectionRef === undefined);
  const otherSeats = other.reduce((n, s) => n + s.requiredCount, 0);
  const otherStaffed = other.reduce((n, s) => n + assignedCount(s._id as string), 0);
  const eventSeats = model.events.reduce((n, s) => n + s.requiredCount, 0);
  const eventStaffed = model.events.reduce(
    (n, s) => n + assignedCount(s._id as string),
    0,
  );
  let asyncGot = 0;
  let asyncReq = 0;
  for (const shift of model.asyncShifts) {
    asyncReq += (shift.hoursRequired ?? 0) * shift.requiredCount;
    for (const a of model.assignmentsByShift.get(shift._id as string) ?? []) {
      asyncGot += a.hoursAllocated ?? shift.hoursRequired ?? 0;
    }
  }
  const activeTaIds = new Set<string>();
  for (const list of model.assignmentsByShift.values()) {
    for (const a of list) activeTaIds.add(a.taProfileRef as string);
  }
  let conflictCount = 0;
  for (const list of model.conflictsByAssignment.values()) conflictCount += list.length;

  const rows: { label: string; value: string; color: string }[] = [
    {
      label: "Discussion sections filled",
      value: `${sectionsFilled} / ${sections.length}`,
      color: "#EDEDEF",
    },
    {
      label: "Office-hour seats filled",
      value: `${otherStaffed} / ${otherSeats}`,
      color: "#EDEDEF",
    },
    {
      label: "Event seats staffed",
      value: `${eventStaffed} / ${eventSeats}`,
      color: eventStaffed === eventSeats ? "#EDEDEF" : "#F7C566",
    },
    {
      label: "Async hours allocated",
      value: `${asyncGot} / ${asyncReq}h`,
      color: asyncGot === asyncReq ? "#EDEDEF" : "#F7C566",
    },
    {
      label: "TAs with assignments",
      value: `${activeTaIds.size} / ${model.rosterByTa.size}`,
      color: "#EDEDEF",
    },
    {
      label: "Conflicts",
      value: conflictCount ? `${conflictCount} · review first` : "0",
      color: conflictCount ? "#F4A3AE" : "#7FE3B1",
    },
  ];

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Publish schedule"
      width={480}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={publishing}
            onClick={() => onPublish(notify)}
          >
            {conflictCount > 0 ? "Publish anyway" : "Publish"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-[18px]">
        <div className="text-[12.5px] leading-normal text-muted">
          {courseLabel}. TAs see their assignments immediately; later edits go to
          the changelog.
        </div>
        <div className="overflow-hidden rounded-[10px] border border-line">
          {rows.map((row) => (
            <div
              key={row.label}
              className="flex h-[38px] items-center gap-[10px] border-b border-[rgba(255,255,255,0.05)] px-[14px] text-[12.5px] last:border-b-0"
            >
              <span className="flex-1 text-[#C9C9CF]">{row.label}</span>
              <span className="font-mono" style={{ color: row.color }}>
                {row.value}
              </span>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setNotify((n) => !n)}
          className="flex cursor-pointer items-center gap-3 text-left"
        >
          <span
            className="relative h-5 w-[34px] rounded-[10px] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.10)] transition-colors duration-150"
            style={{ background: notify ? "#3DD68C" : "rgba(255,255,255,0.10)" }}
          >
            <span
              className="absolute top-[2px] h-4 w-4 rounded-full bg-white transition-[left] duration-150"
              style={{ left: notify ? 16 : 2 }}
            />
          </span>
          <span className="flex flex-col gap-[1px]">
            <span className="text-[13px]">Notify TAs by email</span>
            <span className="text-[11.5px] text-faint">
              {notify
                ? `${activeTaIds.size} TAs get an email with their assignments`
                : "TAs will only see the schedule when they open TerpTA"}
            </span>
          </span>
        </button>
      </div>
    </Modal>
  );
}
