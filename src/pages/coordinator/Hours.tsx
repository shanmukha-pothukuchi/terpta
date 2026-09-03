import { Clock3 } from "lucide-react";
import { PageHeader, EmptyState } from "../../components/ui";

export default function CoordinatorHours() {
  return (
    <div>
      <PageHeader
        title="Hours"
        description="Review, approve, or flag TA hour logs, and watch weekly totals against caps."
      />
      <EmptyState
        icon={Clock3}
        title="No hour logs"
        hint="Submitted TA hour logs appear here for approval once the schedule is live."
      />
    </div>
  );
}
