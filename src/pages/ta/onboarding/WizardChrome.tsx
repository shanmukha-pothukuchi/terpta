import { ArrowRight } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "../../../components/ui";
import { WIZARD_STEPS } from "./model";

export interface WizardChromeProps {
  /** 0-based. */
  stepIndex: number;
  children: ReactNode;
  onContinue: () => void;
  saving?: boolean;
  /** Shown top-right, e.g. "Priya S. · pshah@umd.edu". */
  identity?: string;
}

/**
 * Onboarding frame per design/terpta-onboarding-ref/onboarding-spec.md: a top
 * bar carrying the wordmark, a centred numbered stepper and the signed-in
 * identity, over a generously padded body. No sidebar, no Back, no Skip and
 * nothing gates Continue — the reference deliberately keeps the path forward
 * unobstructed, and finishing lands the TA in the live app.
 */
export function WizardChrome({
  stepIndex,
  children,
  onContinue,
  saving,
  identity,
}: WizardChromeProps) {
  const step = WIZARD_STEPS[stepIndex];

  return (
    <div className="flex min-h-screen flex-col bg-page">
      <header className="flex h-[60px] shrink-0 items-center justify-between gap-4 border-b border-line px-5 sm:px-8">
        <div className="flex shrink-0 items-center gap-2.5">
          <span aria-hidden className="size-5 rounded-[5px] bg-umd" />
          <span className="text-[15px] font-semibold tracking-[-0.01em] text-ink">
            TerpTA
          </span>
        </div>

        <ol className="flex min-w-0 shrink items-center" aria-label="Setup progress">
          {WIZARD_STEPS.map((s, i) => {
            const active = i === stepIndex;
            const done = i < stepIndex;
            return (
              <li key={s.key} className="flex items-center">
                {i > 0 && (
                  <span
                    aria-hidden
                    className="mx-1.5 h-px w-4 bg-line-strong sm:mx-2 sm:w-8"
                  />
                )}
                <span
                  className="flex items-center gap-2"
                  aria-current={active ? "step" : undefined}
                >
                  <span
                    aria-hidden
                    className={
                      "flex size-5 items-center justify-center rounded-full font-mono text-[11px] " +
                      (active || done
                        ? "bg-ink text-page"
                        : "border border-line-strong text-faint")
                    }
                  >
                    {i + 1}
                  </span>
                  <span
                    className={
                      "whitespace-nowrap text-[13px] " +
                      // Below sm only the active label has room.
                      (active
                        ? "font-semibold text-ink"
                        : "hidden text-faint sm:inline")
                    }
                  >
                    {s.title}
                  </span>
                </span>
              </li>
            );
          })}
        </ol>

        <span className="hidden min-w-0 shrink truncate text-[13px] text-muted lg:block">
          {identity ?? ""}
        </span>
      </header>

      <div className="flex-1 px-6 py-10 lg:px-[120px] lg:py-[72px]">
        {children}
      </div>

      <div className="shrink-0 px-6 pb-10 lg:px-[120px] lg:pb-[72px]">
        <div className="flex items-center justify-end">
          <Button variant="neutral" onClick={onContinue} loading={saving}>
            {step.continueLabel}
            <ArrowRight size={14} strokeWidth={1.5} aria-hidden />
          </Button>
        </div>
      </div>
    </div>
  );
}
