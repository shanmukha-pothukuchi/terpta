/* Wizard chrome — the frame every onboarding step renders inside.
   Owns the 4-step progress bar, the step label and the footer actions, so
   the step components stay pure (value + onChange over their own slice). */
import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { Button, Tooltip } from "../../../components/ui";
import { WIZARD_STEPS, stepLabel } from "./model";

export interface WizardChromeProps {
  /** 0-based index into {@link WIZARD_STEPS}. */
  stepIndex: number;
  children: ReactNode;
  /** Omitted (or ignored) on step 0 — there is nowhere to go back to. */
  onBack?: () => void;
  onContinue: () => void;
  continueLabel?: string;
  continueDisabled?: boolean;
  /** Tooltip copy explaining why Continue is disabled. */
  continueHint?: string;
  /** Renders the "Skip for now" text link when provided. */
  onSkip?: () => void;
  saving?: boolean;
}

export function WizardChrome({
  stepIndex,
  children,
  onBack,
  onContinue,
  continueLabel = "Continue",
  continueDisabled,
  continueHint,
  onSkip,
  saving,
}: WizardChromeProps): JSX.Element {
  const total = WIZARD_STEPS.length;
  const index = Math.min(Math.max(stepIndex, 0), total - 1);
  const pct = ((index + 1) / total) * 100;
  const label = stepLabel(index);
  const showBack = index > 0 && Boolean(onBack);

  const continueButton = (
    <Button
      variant="primary"
      onClick={onContinue}
      disabled={continueDisabled}
      loading={saving}
    >
      {continueLabel}
    </Button>
  );

  return (
    <div className="mx-auto flex w-full max-w-[880px] flex-col gap-7 px-5 py-8 sm:gap-8 sm:py-10">
      {/* Progress */}
      <div className="flex flex-col gap-2">
        <div
          role="progressbar"
          aria-label={label}
          aria-valuemin={1}
          aria-valuemax={total}
          aria-valuenow={index + 1}
          className="h-[3px] w-full overflow-hidden rounded-full bg-[rgba(255,255,255,0.08)]"
        >
          <div
            className="h-full rounded-full bg-umd transition-[width] duration-200 ease-out"
            style={{ width: `${pct}%` }}
          />
        </div>
        <p className="font-mono text-[11.5px] leading-none text-faint">{label}</p>
      </div>

      {/* Step body */}
      <div className="min-w-0">{children}</div>

      {/* Actions */}
      <div className="flex items-center gap-3 border-t border-line pt-5">
        {onSkip ? (
          <button
            type="button"
            onClick={onSkip}
            className="cursor-pointer text-[12.5px] text-muted underline underline-offset-[3px] transition-colors hover:text-ink"
          >
            Skip for now
          </button>
        ) : null}
        <div className="flex-1" />
        {showBack ? (
          <Button variant="secondary" onClick={onBack}>
            <ArrowLeft size={14} strokeWidth={1.5} aria-hidden />
            Back
          </Button>
        ) : null}
        {continueDisabled && continueHint ? (
          <Tooltip label={continueHint}>{continueButton}</Tooltip>
        ) : (
          continueButton
        )}
      </div>
    </div>
  );
}
