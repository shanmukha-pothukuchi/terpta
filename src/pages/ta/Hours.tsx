import { Clock3 } from "lucide-react";
import { PageHeader, EmptyState } from "../../components/ui";

export default function TaHours() {
  return (
    <div>
      <PageHeader
        title="Hours"
        description="Log hours against your assignments and track weekly totals against your cap."
      />
      <EmptyState
        icon={Clock3}
        title="No hours logged"
        hint="Hour logging (draft, submit, approval status) lands here once you have assignments."
      />
    </div>
  );
}
