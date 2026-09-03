import { Wand2 } from "lucide-react";
import { PageHeader, EmptyState } from "../../components/ui";

export default function Builder() {
  return (
    <div>
      <PageHeader
        title="Builder"
        description="Generate a draft schedule from availability and preferences, then drag, lock, and publish."
      />
      <EmptyState
        icon={Wand2}
        title="Nothing to build yet"
        hint="Once TAs submit availability and shifts exist, run the solver here and refine assignments by hand."
      />
    </div>
  );
}
