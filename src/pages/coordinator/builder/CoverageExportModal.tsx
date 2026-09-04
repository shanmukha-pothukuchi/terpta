import { useMemo, useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button, Modal, toast } from "../../../components/ui";
import type { DayCode } from "../../../lib/format";
import { formatCoverage, type CoverageGroup } from "../../../lib/coverageExport";
import type { BuilderModel } from "./model";

export interface CoverageExportModalProps {
  open: boolean;
  onClose: () => void;
  model: BuilderModel;
}

/**
 * The staffed week as text, for pasting into a syllabus or a course post.
 *
 * Built from the whole board rather than what is on screen: hiding office
 * hours while assigning discussions should not quietly hide them from the
 * page students end up reading.
 */
export function CoverageExportModal({ open, onClose, model }: CoverageExportModalProps) {
  const [copied, setCopied] = useState(false);

  const text = useMemo(() => {
    const byDuty = new Map<string, CoverageGroup>();
    for (const shift of model.weekly) {
      if (shift.day === undefined || shift.startMin === undefined || shift.endMin === undefined) {
        continue;
      }
      // Nobody is on it, so nobody should be told to turn up to it.
      if ((model.assignmentsByShift.get(shift._id as string)?.length ?? 0) === 0) continue;
      const duty = model.dutyById.get(shift.dutyTypeRef as string);
      const name = duty?.name ?? "Shifts";
      const group = byDuty.get(name) ?? { name, blocks: [] };
      group.blocks.push({
        day: shift.day as DayCode,
        startMin: shift.startMin,
        endMin: shift.endMin,
      });
      byDuty.set(name, group);
    }
    return formatCoverage([...byDuty.values()]);
  }, [model]);

  const copy = () => {
    navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => toast("Could not reach the clipboard — select the text instead", { tone: "error" }));
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Hours to publish"
      width={480}
      footer={
        <>
          <Button onClick={onClose}>Close</Button>
          <Button variant="primary" onClick={copy} disabled={text.length === 0}>
            {copied ? (
              <Check size={14} strokeWidth={1.5} aria-hidden />
            ) : (
              <Copy size={14} strokeWidth={1.5} aria-hidden />
            )}
            {copied ? "Copied" : "Copy"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-2.5">
        <p className="text-[12.5px] leading-[1.5] text-muted">
          Every stretch of the week somebody is on, by kind of work. Blocks
          that run into each other — or that two TAs hold at the same hour —
          are one line, because that is one stretch to turn up in.
        </p>
        {text.length === 0 ? (
          <p className="text-[12.5px] text-faint">
            Nothing is staffed yet. Generate or assign somebody first.
          </p>
        ) : (
          <textarea
            readOnly
            value={text}
            rows={Math.min(18, text.split("\n").length + 1)}
            aria-label="Hours to publish"
            onFocus={(e) => e.currentTarget.select()}
            className="w-full resize-y rounded-[10px] border border-line bg-page p-3 font-mono text-[12.5px] leading-[1.6] text-ink outline-none"
          />
        )}
      </div>
    </Modal>
  );
}
