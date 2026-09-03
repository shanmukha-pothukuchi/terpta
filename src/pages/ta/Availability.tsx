import { CalendarDays } from "lucide-react";
import { PageHeader, EmptyState } from "../../components/ui";
import { usePeriod } from "../../lib/period";

export default function TaAvailability() {
  const { periodId } = usePeriod();

  return (
    <div>
      <PageHeader
        title="Availability"
        description="Paint the week with when you're available, would prefer not, or can't work. Add date exceptions for exams and travel."
      />
      {!periodId ? (
        <EmptyState
          icon={CalendarDays}
          title="No staffing period yet"
          hint="Once your coordinator opens a staffing period, the weekly availability grid appears here."
        />
      ) : (
        <EmptyState
          icon={CalendarDays}
          title="Availability grid"
          hint="M–F weekly paint grid (available / prefer not / unavailable) lands here."
        />
      )}
    </div>
  );
}
