/**
 * Swap-request modal (TA): reason (required) + optional suggested TA, calling
 * api.ta.requestSwap. `SwapRequestModalView` is the pure inner component the
 * DEV preview harness can render without auth (pass your own `onSubmit`);
 * the default export wires the Convex mutation.
 */
import { useEffect, useState } from "react";
import { useMutation } from "convex/react";
import { ArrowLeftRight } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { DAY_LABELS, type DayCode } from "../../lib/format";
import { dayOfIso, todayIso } from "../../lib/week";
import {
  Button,
  Input,
  Label,
  Modal,
  SegmentedControl,
  Select,
  Textarea,
  toast,
} from "../../components/ui";

/**
 * How long an approved swap lasts. "date" leaves the recurring assignment
 * alone and only needs cover for that one meeting; "permanent" hands the
 * shift over for the rest of the staffing period.
 */
export type SwapScope = "date" | "permanent";

export interface SwapSuggestion {
  /** Id<"taProfiles"> as a plain string. */
  id: string;
  name: string;
}

export interface SwapModalTarget {
  /** Id<"assignments"> as a plain string. */
  assignmentRef: string;
  /** e.g. "Office Hours" */
  label: string;
  /** e.g. "Tu 2:00p–4:00p" — rendered in mono. */
  detail?: string;
  /** Weekday a weekly shift meets; the only days a one-date swap can name. */
  day?: DayCode;
  /** The date of a one-off event, which is the only date it can be covered on. */
  onceDate?: string;
}

export interface SwapRequestModalViewProps {
  open: boolean;
  onClose: () => void;
  target: SwapModalTarget | null;
  /** TAs the requester may suggest. Empty/omitted hides the selector. */
  suggestableTas?: SwapSuggestion[];
  onSubmit: (fields: {
    reason: string;
    suggestedTaId?: string;
    scope: SwapScope;
    date?: string;
  }) => Promise<void>;
}

const SCOPE_OPTIONS = [
  { value: "date" as const, label: "Just one date" },
  { value: "permanent" as const, label: "Rest of the term" },
];

export function SwapRequestModalView({
  open,
  onClose,
  target,
  suggestableTas = [],
  onSubmit,
}: SwapRequestModalViewProps) {
  const [reason, setReason] = useState("");
  const [suggested, setSuggested] = useState("");
  const [scope, setScope] = useState<SwapScope>("date");
  const [date, setDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setReason("");
      setSuggested("");
      // One date is the common case and the reversible one, so it leads.
      setScope("date");
      setDate(target?.onceDate ?? "");
      setDate("");
      setError(null);
      setBusy(false);
    }
  }, [open, target?.assignmentRef]);

  const submit = async () => {
    if (reason.trim().length === 0) {
      setError("A reason is required.");
      return;
    }
    // Mirror the server's rule so the answer arrives before the round trip.
    if (scope === "date" && !date) {
      setError("Pick the date you need covered.");
      return;
    }
    if (scope === "date" && target?.day && dayOfIso(date) !== target.day) {
      setError(`This shift meets on ${DAY_LABELS[target.day]}s — pick a ${DAY_LABELS[target.day]}.`);
      return;
    }
    if (scope === "date" && date < todayIso()) {
      setError("That date has already passed.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSubmit({
        reason: reason.trim(),
        suggestedTaId: suggested || undefined,
        scope,
        date: scope === "date" ? date : undefined,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Swap request failed.");
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Request a swap"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void submit()} loading={busy}>
            <ArrowLeftRight size={14} strokeWidth={1.5} aria-hidden />
            Request swap
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3.5">
        {target ? (
          <div className="flex items-center gap-2.5 rounded-[9px] border border-line bg-[rgba(255,255,255,0.03)] px-3 py-2.5">
            <ArrowLeftRight size={14} strokeWidth={1.5} className="shrink-0 text-faint" aria-hidden />
            <span className="text-[12.5px] font-medium text-ink">{target.label}</span>
            {target.detail ? (
              <span className="font-mono text-[12px] text-muted">{target.detail}</span>
            ) : null}
          </div>
        ) : null}

        <div>
          <Label htmlFor="swap-scope">How long?</Label>
          <div id="swap-scope" className="flex flex-wrap items-center gap-2.5">
            <SegmentedControl
              options={SCOPE_OPTIONS}
              value={scope}
              onChange={setScope}
            />
            {scope === "date" ? (
              <Input
                type="date"
                aria-label="Date to cover"
                value={date}
                min={todayIso()}
                readOnly={target?.onceDate !== undefined}
                onChange={(e) => setDate(e.target.value)}
                className="w-[168px]"
              />
            ) : null}
          </div>
          {scope === "date" && target?.day ? (
            <p className="mt-1 text-[12px] text-faint">
              Meets on {DAY_LABELS[target.day]}s.
            </p>
          ) : null}
          {/* The old flow said nothing about duration, and approving always
              handed the shift over for good — spell out which one this is. */}
          <p className="mt-1.5 text-[12px] text-faint">
            {scope === "date"
              ? "Someone covers this one meeting. You keep the shift every other week."
              : "This hands the shift off for the rest of the term. You will not be scheduled for it again."}
          </p>
        </div>

        <div>
          <Label htmlFor="swap-reason">Reason</Label>
          <Textarea
            id="swap-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why can't you cover this shift?"
            autoFocus
          />
        </div>

        {suggestableTas.length > 0 ? (
          <div>
            <Label htmlFor="swap-suggested">Suggest a TA (optional)</Label>
            <Select
              id="swap-suggested"
              value={suggested}
              onChange={(e) => setSuggested(e.target.value)}
            >
              <option value="">No suggestion</option>
              {suggestableTas.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </div>
        ) : (
          <p className="text-[12px] text-faint">
            Your coordinator will pick a replacement when they review this request.
          </p>
        )}

        {error ? <p className="text-[12px] text-[#ff8b9b]">{error}</p> : null}
      </div>
    </Modal>
  );
}

export default function SwapRequestModal({
  open,
  onClose,
  target,
  suggestableTas,
  onRequested,
}: {
  open: boolean;
  onClose: () => void;
  target: SwapModalTarget | null;
  suggestableTas?: SwapSuggestion[];
  /** Called after the mutation succeeds. */
  onRequested?: (fields: {
    reason: string;
    suggestedTaId?: string;
    scope: SwapScope;
    date?: string;
  }) => void;
}) {
  const requestSwap = useMutation(api.ta.requestSwap);
  return (
    <SwapRequestModalView
      open={open}
      onClose={onClose}
      target={target}
      suggestableTas={suggestableTas}
      onSubmit={async (fields) => {
        if (!target) return;
        await requestSwap({
          assignmentRef: target.assignmentRef as Id<"assignments">,
          reason: fields.reason,
          suggestedTaRef: fields.suggestedTaId
            ? (fields.suggestedTaId as Id<"taProfiles">)
            : undefined,
          scope: fields.scope,
          date: fields.date,
        });
        toast("Swap requested — your coordinator will review");
        onRequested?.(fields);
      }}
    />
  );
}
