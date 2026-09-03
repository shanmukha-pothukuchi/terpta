import { useMutation, useQuery } from "convex/react";
import { Link } from "react-router-dom";
import { CalendarDays, UserRoundPlus } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { EmptyState, FullPageSpinner, PageHeader } from "../../components/ui";
import { usePeriod } from "../../lib/period";
import { AvailabilityEditor } from "./availability/AvailabilityEditor";
import type { AvailabilityData } from "./availability/model";

/** TA Availability — weekly paint grid + date exceptions, autosaved to Convex. */
export default function TaAvailability() {
  const { periodId } = usePeriod();

  if (!periodId) {
    return (
      <div>
        <PageHeader
          title="Availability"
          description="Paint the week with when you're available, would prefer not, or can't work."
        />
        <EmptyState
          icon={CalendarDays}
          title="No staffing period yet"
          hint="Once your coordinator opens a staffing period, the weekly availability grid appears here."
        />
      </div>
    );
  }

  return <AvailabilityLoader periodId={periodId} />;
}

function AvailabilityLoader({ periodId }: { periodId: Id<"staffingPeriods"> }) {
  const info = useQuery(api.periods.get, { periodRef: periodId });
  const profile = useQuery(api.ta.getProfile, { periodRef: periodId });
  const availability = useQuery(
    api.ta.getAvailability,
    profile ? { taProfileRef: profile._id } : "skip",
  );

  const saveAvailability = useMutation(api.ta.saveAvailability);
  const addDateException = useMutation(api.ta.addDateException);
  const removeDateException = useMutation(api.ta.removeDateException);

  if (profile === undefined || info === undefined) {
    return <FullPageSpinner label="Loading availability…" />;
  }

  if (profile === null) {
    return (
      <div>
        <PageHeader
          title="Availability"
          description="Paint the week with when you're available, would prefer not, or can't work."
        />
        <EmptyState
          icon={UserRoundPlus}
          title="Set up your TA profile first"
          hint="Tell us your hour cap and enrolled classes, then paint your availability."
        >
          <Link
            to="/ta/onboarding"
            className="mt-4 inline-flex h-8 items-center rounded-[9px] border border-white/10 bg-umd px-3.5 text-[13px] font-medium text-white transition-colors hover:bg-[#F02A44]"
          >
            Start onboarding
          </Link>
        </EmptyState>
      </div>
    );
  }

  if (availability === undefined) {
    return <FullPageSpinner label="Loading availability…" />;
  }

  const data: AvailabilityData = {
    term: info?.period.term,
    deadline: info?.period.collectionDeadline,
    manualBlocks: availability.blocks
      .filter((b) => b.source === "manual")
      .map((b) => ({
        day: b.day,
        startMin: b.startMin,
        endMin: b.endMin,
        status: b.status,
      })),
    importedBlocks: availability.blocks
      .filter((b) => b.source === "imported_class")
      .map((b) => ({ day: b.day, startMin: b.startMin, endMin: b.endMin })),
    dateExceptions: availability.dateExceptions.map((x) => ({
      id: x._id,
      startDate: x.startDate,
      endDate: x.endDate,
      reason: x.reason,
    })),
    submittedAt: availability.availabilitySubmittedAt,
  };

  return (
    <AvailabilityEditor
      key={profile._id}
      data={data}
      onSave={async (blocks, submitted) => {
        await saveAvailability({
          taProfileRef: profile._id,
          blocks,
          submitted: submitted || undefined,
        });
      }}
      onAddException={async (x) => {
        await addDateException({ taProfileRef: profile._id, ...x });
      }}
      onRemoveException={async (id) => {
        await removeDateException({
          dateExceptionRef: id as Id<"dateExceptions">,
        });
      }}
    />
  );
}
