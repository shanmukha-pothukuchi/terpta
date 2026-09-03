import { useState, type FormEvent } from "react";
import { CalendarDays, Plus, Trash2 } from "lucide-react";
import { useToast } from "../../../components/ui";
import { formatDate } from "../../../lib/format";
import type { ExceptionItem } from "./model";

const dateInputCls =
  "h-[30px] w-[130px] rounded-lg border border-white/10 bg-page px-[10px] font-mono text-[12px] text-ink outline-none transition-colors focus:border-white/[0.28] focus:shadow-[0_0_0_3px_rgba(255,255,255,0.05)]";

export interface DateExceptionsProps {
  exceptions: ExceptionItem[];
  onAdd?: (x: { startDate: string; endDate: string; reason: string }) => Promise<void>;
  onRemove?: (id: string) => Promise<void>;
}

/** "Date exceptions" card: inline add form (from, to, reason) + removable list. */
export function DateExceptions({ exceptions, onAdd, onRemove }: DateExceptionsProps) {
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);

  const handleAdd = async (e: FormEvent) => {
    e.preventDefault();
    if (!from || busy) return;
    const endDate = to || from;
    const [startDate, finalEnd] = endDate < from ? [endDate, from] : [from, endDate];
    setBusy(true);
    try {
      await onAdd?.({ startDate, endDate: finalEnd, reason: reason.trim() });
      setAdding(false);
      setFrom("");
      setTo("");
      setReason("");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't add exception", {
        tone: "error",
      });
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async (id: string) => {
    setRemoving(id);
    try {
      await onRemove?.(id);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't remove exception", {
        tone: "error",
      });
    } finally {
      setRemoving(null);
    }
  };

  return (
    <div className="flex flex-col gap-[10px] rounded-[12px] border border-line bg-surface p-3 sm:px-4 sm:py-[14px]">
      <div className="flex items-center gap-[10px]">
        <div className="text-[13px] font-medium sm:text-[13.5px]">Date exceptions</div>
        <div className="hidden text-[12px] text-faint md:block">
          One-off days you can't be scheduled, on top of the weekly grid
        </div>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => setAdding((a) => !a)}
          className="flex h-7 items-center gap-[6px] rounded-lg border border-line bg-white/[0.04] px-[10px] text-[12.5px] transition-colors hover:bg-white/[0.08]"
        >
          <Plus size={14} strokeWidth={1.5} />
          <span className="hidden sm:inline">Add exception</span>
          <span className="sm:hidden">Add</span>
        </button>
      </div>

      {adding && (
        <form
          onSubmit={handleAdd}
          className="flex flex-wrap items-center gap-2 rounded-[10px] border border-line bg-white/[0.03] p-[10px]"
        >
          <input
            type="date"
            aria-label="From date"
            required
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className={dateInputCls}
          />
          <input
            type="date"
            aria-label="To date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className={dateInputCls}
          />
          <input
            type="text"
            placeholder="Reason (optional)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="h-[30px] min-w-[140px] flex-1 rounded-lg border border-white/10 bg-page px-[10px] text-[12.5px] text-ink outline-none transition-colors focus:border-white/[0.28] focus:shadow-[0_0_0_3px_rgba(255,255,255,0.05)]"
          />
          <button
            type="submit"
            disabled={busy || !from}
            className="flex h-[30px] items-center rounded-lg bg-ink px-3 text-[12.5px] font-medium text-[#0B0B0E] transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            Add
          </button>
        </form>
      )}

      {exceptions.map((ex) => (
        <div
          key={ex.id}
          className="flex h-9 items-center gap-3 rounded-[9px] border border-white/[0.06] bg-white/[0.02] px-[10px]"
        >
          <CalendarDays size={14} strokeWidth={1.5} className="flex-none text-muted" />
          <span className="whitespace-nowrap font-mono text-[12.5px] text-ink">
            {ex.startDate === ex.endDate
              ? formatDate(ex.startDate)
              : `${formatDate(ex.startDate)} – ${formatDate(ex.endDate)}`}
          </span>
          {ex.reason && (
            <span className="truncate text-[12.5px] text-muted">{ex.reason}</span>
          )}
          <div className="flex-1" />
          <button
            type="button"
            aria-label="Remove exception"
            disabled={removing === ex.id}
            onClick={() => void handleRemove(ex.id)}
            className="flex h-[26px] w-[26px] flex-none items-center justify-center rounded-[7px] text-faint transition-colors hover:bg-[rgba(226,24,51,0.12)] hover:text-[#F4A3AE] disabled:opacity-50"
          >
            <Trash2 size={14} strokeWidth={1.5} />
          </button>
        </div>
      ))}
      {exceptions.length === 0 && (
        <div className="px-[2px] py-1 text-[12.5px] text-faint">No exceptions yet.</div>
      )}
    </div>
  );
}
