/* Step 1 — welcome & basics. Preferred name and an optional phone; the
   course chip echoes the period the TA was invited to (read-only). */
import { BookOpen } from "lucide-react";
import { Card, Chip, Input, Label } from "../../../components/ui";
import type { BasicsValue } from "./model";

export interface Step1BasicsProps {
  value: BasicsValue;
  onChange: (next: BasicsValue) => void;
  /** Legal first name from the invite, e.g. "Priya". */
  firstName: string;
  /** e.g. "CMSC132 · Fall 2026". */
  courseLabel: string;
}

export function Step1Basics({
  value,
  onChange,
  firstName,
  courseLabel,
}: Step1BasicsProps): JSX.Element {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3">
        <h1 className="max-w-[36ch] text-[22px] font-semibold leading-[1.25] tracking-[-0.02em] text-ink [text-wrap:pretty]">
          Hi {firstName}, let&rsquo;s set up your TA profile for {courseLabel}.
        </h1>
        <Chip className="self-start" aria-label={`Invited to ${courseLabel}`}>
          <BookOpen size={14} strokeWidth={1.5} className="shrink-0 text-faint" aria-hidden />
          <span className="truncate">{courseLabel}</span>
        </Chip>
      </div>

      <Card>
        <div className="flex flex-col gap-4">
          <div className="min-w-0">
            <Label htmlFor="basics-preferred-name">Preferred name</Label>
            <Input
              id="basics-preferred-name"
              name="preferredName"
              autoComplete="given-name"
              placeholder={firstName}
              value={value.preferredName}
              onChange={(e) => onChange({ ...value, preferredName: e.target.value })}
            />
          </div>

          <div className="min-w-0">
            <Label htmlFor="basics-phone">
              <span className="inline-flex items-center gap-1.5">
                Phone number
                <span className="font-normal text-faint">Optional</span>
              </span>
            </Label>
            <Input
              id="basics-phone"
              name="phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="(301) 555-0142"
              className="font-mono"
              aria-describedby="basics-phone-hint"
              value={value.phone}
              onChange={(e) => onChange({ ...value, phone: e.target.value })}
            />
            <p id="basics-phone-hint" className="mt-1.5 text-[12px] text-faint">
              For exam-day reminders. Only your coordinator sees it.
            </p>
          </div>
        </div>
      </Card>

      <p className="max-w-[62ch] text-[12.5px] text-muted [text-wrap:pretty]">
        Next you&rsquo;ll add your classes, mark when you&rsquo;re free, and set your
        preferences — about three minutes.
      </p>
    </div>
  );
}
