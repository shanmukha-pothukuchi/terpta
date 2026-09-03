import { useQuery } from "convex/react";
import { Users } from "lucide-react";
import { PageHeader, EmptyState, Spinner } from "../../components/ui";
import { usePeriod } from "../../lib/period";
import { rosterListByPeriod } from "../../lib/api";

export default function Roster() {
  const { periodId } = usePeriod();
  const rows = useQuery(
    rosterListByPeriod,
    periodId ? { periodRef: periodId } : "skip",
  );

  return (
    <div>
      <PageHeader
        title="Roster"
        description="TAs in this staffing period, their weekly hour caps, and whether they've submitted availability."
      />
      {!periodId ? (
        <EmptyState
          icon={Users}
          title="No staffing period selected"
          hint="Create a staffing period in Period Setup, then invite TAs here."
        />
      ) : rows === undefined ? (
        <Spinner label="Loading roster…" />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No TAs yet"
          hint="Invite TAs by email; they appear here once added."
        />
      ) : (
        <table className="w-full max-w-2xl text-left text-sm">
          <thead>
            <tr className="border-b border-neutral-200 text-xs uppercase tracking-wide text-neutral-400">
              <th className="py-2 pr-4 font-medium">Name</th>
              <th className="py-2 pr-4 font-medium">Email</th>
              <th className="py-2 pr-4 font-medium">Max hrs/wk</th>
              <th className="py-2 font-medium">Availability</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.taProfileRef} className="border-b border-neutral-100">
                <td className="py-2 pr-4">
                  {row.name}
                  {row.invitePending ? (
                    <span className="ml-2 text-xs text-neutral-400">
                      (invited)
                    </span>
                  ) : null}
                </td>
                <td className="py-2 pr-4 text-neutral-500">{row.email}</td>
                <td className="py-2 pr-4">{row.maxHoursPerWeek}</td>
                <td className="py-2">
                  {row.status === "submitted" ? "Submitted" : "Missing"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
