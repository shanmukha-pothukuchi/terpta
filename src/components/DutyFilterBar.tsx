import { Eye, EyeOff } from "lucide-react";

export interface DutyFilterItem {
  id: string;
  name: string;
  color: string;
  /** How many things of this kind the screen would show. */
  count: number;
}

export interface DutyFilterBarProps {
  items: DutyFilterItem[];
  hidden: Set<string>;
  onToggle: (id: string) => void;
  onShowAll: () => void;
  /** Leading word, e.g. "Showing". */
  label?: string;
  className?: string;
}

/**
 * Chips for hiding kinds of work while you work on one of them.
 *
 * A view filter, never a data change: hidden shifts are still assigned, still
 * published and still counted where the count is a fact rather than a view
 * (a TA's weekly hours, the publish summary). The bar always says how many
 * are hidden so a filtered screen can never be mistaken for an empty one.
 */
export function DutyFilterBar({
  items,
  hidden,
  onToggle,
  onShowAll,
  label = "Showing",
  className = "",
}: DutyFilterBarProps) {
  if (items.length <= 1) return null;
  const hiddenCount = items.filter((i) => hidden.has(i.id)).length;

  return (
    <div className={`flex flex-wrap items-center gap-x-2 gap-y-1.5 ${className}`}>
      <span className="shrink-0 text-[11.5px] text-faint">{label}</span>
      {items.map((item) => {
        const off = hidden.has(item.id);
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onToggle(item.id)}
            aria-pressed={!off}
            title={`${off ? "Show" : "Hide"} ${item.name}`}
            className={
              "flex h-7 shrink-0 cursor-pointer items-center gap-[6px] whitespace-nowrap rounded-[7px] border px-2 text-[12px] transition-colors duration-100 " +
              (off
                ? "border-dashed border-line text-faint hover:text-muted"
                : "border-line bg-[rgba(255,255,255,0.04)] text-ink hover:bg-[rgba(255,255,255,0.07)]")
            }
          >
            <span
              className="size-[9px] shrink-0 rounded-[3px]"
              style={
                off
                  ? { boxShadow: `inset 0 0 0 1.5px ${item.color}`, opacity: 0.7 }
                  : { background: item.color }
              }
              aria-hidden
            />
            {item.name}
            <span className={off ? "text-faint" : "text-muted"}>{item.count}</span>
          </button>
        );
      })}
      {hiddenCount > 0 ? (
        <button
          type="button"
          onClick={onShowAll}
          className="flex h-7 shrink-0 cursor-pointer items-center gap-[6px] whitespace-nowrap rounded-[7px] px-1.5 text-[11.5px] text-muted transition-colors hover:bg-[rgba(255,255,255,0.06)] hover:text-ink"
        >
          <Eye size={12} strokeWidth={1.5} aria-hidden />
          Show all
        </button>
      ) : null}
      {hiddenCount > 0 ? (
        <span className="flex shrink-0 items-center gap-[5px] text-[11.5px] text-warn">
          <EyeOff size={12} strokeWidth={1.5} aria-hidden />
          {hiddenCount} hidden
        </span>
      ) : null}
    </div>
  );
}
