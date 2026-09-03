import { Tags } from "lucide-react";
import { PageHeader, EmptyState } from "../../components/ui";
import { usePeriod } from "../../lib/period";

export default function DutyTypes() {
  const { periodId } = usePeriod();

  return (
    <div>
      <PageHeader
        title="Duty Types"
        description="Define the kinds of work in this period — office hours, labs, grading — with colors and default hour credits."
      />
      <EmptyState
        icon={Tags}
        title={periodId ? "No duty types yet" : "No staffing period selected"}
        hint={
          periodId
            ? "Add sync duty types (office hours, discussion) and async ones (grading)."
            : "Create a staffing period first; duty types belong to a period."
        }
      />
    </div>
  );
}
