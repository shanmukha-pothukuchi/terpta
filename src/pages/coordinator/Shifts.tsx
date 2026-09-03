import { useQuery } from "convex/react";
import { LayoutGrid } from "lucide-react";
import { PageHeader, EmptyState, Spinner } from "../../components/ui";
import { usePeriod } from "../../lib/period";
import { shiftsListByPeriod, type ShiftRow } from "../../lib/api";

function formatMinutes(min?: number): string {
  if (min === undefined) return "";
  const h = Math.floor(min / 60);
  const m = min % 60;
  const suffix = h >= 12 ? "pm" : "am";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${m.toString().padStart(2, "0")}${suffix}`;
}

function shiftWhen(shift: ShiftRow): string {
  if (shift.recurrence === "weekly" && shift.day) {
    return `${shift.day} ${formatMinutes(shift.startMin)}–${formatMinutes(shift.endMin)}`;
  }
  if (shift.recurrence === "once" && shift.date) {
    return `${shift.date} ${formatMinutes(shift.startMin)}–${formatMinutes(shift.endMin)}`;
  }
  if (shift.hoursRequired !== undefined) {
    return `Async · ${shift.hoursRequired}h`;
  }
  return "—";
}

export default function Shifts() {
  const { periodId } = usePeriod();
  const shifts = useQuery(
    shiftsListByPeriod,
    periodId ? { periodRef: periodId } : "skip",
  );

  return (
    <div>
      <PageHeader
        title="Shifts"
        description="Weekly and one-off shifts plus async duty pools for this period."
      />
      {!periodId ? (
        <EmptyState
          icon={LayoutGrid}
          title="No staffing period selected"
          hint="Create a staffing period first, then define shifts from your duty types."
        />
      ) : shifts === undefined ? (
        <Spinner label="Loading shifts…" />
      ) : shifts.length === 0 ? (
        <EmptyState
          icon={LayoutGrid}
          title="No shifts yet"
          hint="Add weekly office hours, one-off review sessions, or async grading pools."
        />
      ) : (
        <table className="w-full max-w-2xl text-left text-sm">
          <thead>
            <tr className="border-b border-neutral-200 text-xs uppercase tracking-wide text-neutral-400">
              <th className="py-2 pr-4 font-medium">Duty</th>
              <th className="py-2 pr-4 font-medium">When</th>
              <th className="py-2 font-medium">TAs needed</th>
            </tr>
          </thead>
          <tbody>
            {shifts.map((shift) => (
              <tr key={shift._id} className="border-b border-neutral-100">
                <td className="py-2 pr-4">
                  {shift.description ?? "Shift"}
                </td>
                <td className="py-2 pr-4 text-neutral-500">
                  {shiftWhen(shift)}
                </td>
                <td className="py-2">{shift.requiredCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
