import { CalendarClock } from "lucide-react";
import { PageHeader, EmptyState } from "../../components/ui";

export default function TaSchedule() {
  return (
    <div>
      <PageHeader
        title="My Schedule"
        description="Your assigned shifts and async duties for the current period, plus swap requests."
      />
      <EmptyState
        icon={CalendarClock}
        title="No assignments yet"
        hint="Once the schedule is published, your weekly shifts and async duties appear here."
      />
    </div>
  );
}
