/* Done screen — the confirmation after step 4. Read-only summary of what
   the TA just submitted, plus the two things they're likely to want next. */
import type { ReactNode } from "react";
import { CircleCheck } from "lucide-react";
import { Button, Card } from "../../../components/ui";
import { formatHourCount } from "../../../lib/format";

export interface DoneScreenProps {
  /** Already-formatted, e.g. "Oct 3". */
  publishDateLabel: string;
  coursesAdded: number;
  hoursMarked: number;
  maxHoursPerWeek: number;
  /** Already-formatted preference labels, most-preferred first. */
  topPreferences: string[];
  onGoToSchedule: () => void;
  onEditAvailability: () => void;
}

function SummaryRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-line py-2.5 last:border-b-0 last:pb-0 first:pt-0">
      <span className="shrink-0 text-[12.5px] text-muted">{label}</span>
      {children}
    </div>
  );
}

export function DoneScreen({
  publishDateLabel,
  coursesAdded,
  hoursMarked,
  maxHoursPerWeek,
  topPreferences,
  onGoToSchedule,
  onEditAvailability,
}: DoneScreenProps): JSX.Element {
  const prefs = topPreferences.join(" · ");

  return (
    <div className="mx-auto flex w-full max-w-[440px] flex-col items-center gap-6 px-5 py-12 sm:py-16">
      <div className="flex flex-col items-center gap-2 text-center">
        <CircleCheck size={20} strokeWidth={1.5} className="text-ok" aria-hidden />
        <h1 className="text-[22px] font-semibold leading-[1.2] tracking-[-0.02em] text-ink">
          You&rsquo;re set.
        </h1>
        <p className="text-[12.5px] text-muted [text-wrap:pretty]">
          Your coordinator will publish assignments after{" "}
          <span className="font-mono text-ink">{publishDateLabel}</span>.
        </p>
      </div>

      <Card className="w-full">
        <SummaryRow label="Courses added">
          <span className="shrink-0 font-mono text-[12.5px] text-ink">{coursesAdded}</span>
        </SummaryRow>
        <SummaryRow label="Hours marked">
          <span className="shrink-0 font-mono text-[12.5px] text-ink">
            {formatHourCount(hoursMarked)}
          </span>
        </SummaryRow>
        <SummaryRow label="Weekly cap">
          <span className="shrink-0 font-mono text-[12.5px] text-ink">
            {formatHourCount(maxHoursPerWeek)}
          </span>
        </SummaryRow>
        <SummaryRow label="Top preferences">
          {prefs ? (
            <span className="min-w-0 truncate text-right text-[12.5px] text-ink" title={prefs}>
              {prefs}
            </span>
          ) : (
            <span className="min-w-0 truncate text-right text-[12.5px] text-faint">
              No preference
            </span>
          )}
        </SummaryRow>
      </Card>

      <div className="flex w-full items-center justify-center gap-2">
        <Button variant="primary" onClick={onGoToSchedule}>
          Go to My Schedule
        </Button>
        <Button variant="secondary" onClick={onEditAvailability}>
          Edit availability
        </Button>
      </div>
    </div>
  );
}
