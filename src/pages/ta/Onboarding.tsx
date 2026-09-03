import { PageHeader, SectionCard } from "../../components/ui";

export default function TaOnboarding() {
  return (
    <div>
      <PageHeader
        title="Courses & Preferences"
        description="Tell us which sections you're enrolled in and how you'd like to work."
      />
      <div className="grid max-w-2xl gap-4">
        <SectionCard title="Enrolled sections">
          Import your class schedule so shift conflicts are blocked
          automatically. Section picker lands here.
        </SectionCard>
        <SectionCard title="Sync vs. async balance">
          A slider from all-synchronous duties (office hours, labs) to
          all-asynchronous (grading). Lands here.
        </SectionCard>
        <SectionCard title="Duty type preferences">
          Rank the duty types you'd rather be assigned to. Drag-to-rank list
          lands here.
        </SectionCard>
        <SectionCard title="Section preferences">
          Rank the sections you'd prefer to support. Drag-to-rank list lands
          here.
        </SectionCard>
      </div>
    </div>
  );
}
