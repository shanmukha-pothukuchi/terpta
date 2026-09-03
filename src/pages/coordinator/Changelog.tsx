import { History } from "lucide-react";
import { PageHeader, EmptyState } from "../../components/ui";

export default function Changelog() {
  return (
    <div>
      <PageHeader
        title="Changelog"
        description="Every change to this period — assignments, swaps, hour approvals — with who did what, when."
      />
      <EmptyState
        icon={History}
        title="No changes yet"
        hint="Audit entries appear here as you and your TAs make changes."
      />
    </div>
  );
}
