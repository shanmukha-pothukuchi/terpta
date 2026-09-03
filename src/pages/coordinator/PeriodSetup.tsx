import { Settings2 } from "lucide-react";
import { PageHeader, EmptyState } from "../../components/ui";

export default function PeriodSetup() {
  return (
    <div>
      <PageHeader
        title="Period Setup"
        description="Create a staffing period for a course and term, set the availability deadline, and open collection."
      />
      <EmptyState
        icon={Settings2}
        title="No staffing period yet"
        hint="Course/term picker (backed by umd.io), collection deadline, and status controls land here."
      />
    </div>
  );
}
