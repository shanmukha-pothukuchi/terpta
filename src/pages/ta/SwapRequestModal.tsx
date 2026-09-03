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
import { Button, Label, Modal, Select, Textarea, toast } from "../../components/ui";

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
}

export interface SwapRequestModalViewProps {
  open: boolean;
  onClose: () => void;
  target: SwapModalTarget | null;
  /** TAs the requester may suggest. Empty/omitted hides the selector. */
  suggestableTas?: SwapSuggestion[];
  onSubmit: (fields: { reason: string; suggestedTaId?: string }) => Promise<void>;
}

export function SwapRequestModalView({
  open,
  onClose,
  target,
  suggestableTas = [],
  onSubmit,
}: SwapRequestModalViewProps) {
  const [reason, setReason] = useState("");
  const [suggested, setSuggested] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setReason("");
      setSuggested("");
      setError(null);
      setBusy(false);
    }
  }, [open, target?.assignmentRef]);

  const submit = async () => {
    if (reason.trim().length === 0) {
      setError("A reason is required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSubmit({
        reason: reason.trim(),
        suggestedTaId: suggested || undefined,
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
  /** Called after the mutation succeeds (e.g. to append to a pending list). */
  onRequested?: (fields: { reason: string; suggestedTaId?: string }) => void;
}) {
  const requestSwap = useMutation(api.ta.requestSwap);
  return (
    <SwapRequestModalView
      open={open}
      onClose={onClose}
      target={target}
      suggestableTas={suggestableTas}
      onSubmit={async ({ reason, suggestedTaId }) => {
        if (!target) return;
        await requestSwap({
          assignmentRef: target.assignmentRef as Id<"assignments">,
          reason,
          suggestedTaRef: suggestedTaId
            ? (suggestedTaId as Id<"taProfiles">)
            : undefined,
        });
        toast("Swap requested — your coordinator will review");
        onRequested?.({ reason, suggestedTaId });
      }}
    />
  );
}
