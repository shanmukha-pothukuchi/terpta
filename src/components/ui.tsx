/* TerpTA shared UI kit — dark-only design system from the design board.
   Every component here follows the board recipes exactly; screen agents
   compose these instead of re-deriving styles. */
import {
  forwardRef,
  useEffect,
  useSyncExternalStore,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
  type HTMLAttributes,
  type ThHTMLAttributes,
  type TdHTMLAttributes,
} from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { Check, Loader2, Lock, X, type LucideIcon } from "lucide-react";

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

/* ------------------------------------------------------------------ */
/* Button — 32px tall, radius 9px, 13px text                           */
/* ------------------------------------------------------------------ */

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: "md" | "sm";
  loading?: boolean;
}

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-umd text-white border border-[rgba(255,255,255,0.10)] hover:bg-[#f22239] active:bg-[#c9152d]",
  secondary:
    "bg-[rgba(255,255,255,0.04)] text-ink border border-[rgba(255,255,255,0.08)] hover:bg-[rgba(255,255,255,0.07)]",
  ghost:
    "bg-transparent text-muted border border-transparent hover:bg-[rgba(255,255,255,0.05)] hover:text-ink",
  danger:
    "bg-[rgba(226,24,51,0.12)] text-[#ff8b9b] border border-[rgba(226,24,51,0.35)] hover:bg-[rgba(226,24,51,0.18)]",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    { variant = "secondary", size = "md", loading, className, children, disabled, ...rest },
    ref,
  ) {
    return (
      <button
        ref={ref}
        type={rest.type ?? "button"}
        disabled={disabled || loading}
        className={cx(
          "inline-flex items-center justify-center gap-1.5 rounded-[9px] text-[13px] font-medium",
          "cursor-pointer select-none whitespace-nowrap transition-colors duration-100",
          "focus-visible:outline-none focus-visible:shadow-[0_0_0_3px_rgba(255,255,255,0.08)]",
          "disabled:opacity-50 disabled:cursor-not-allowed",
          size === "md" ? "h-8 px-3.5" : "h-7 px-2.5 text-[12.5px]",
          BUTTON_VARIANTS[variant],
          className,
        )}
        {...rest}
      >
        {loading ? <Loader2 size={14} strokeWidth={1.5} className="animate-spin" aria-hidden /> : null}
        {children}
      </button>
    );
  },
);

/* ------------------------------------------------------------------ */
/* Inputs — focus: border white/28 + 3px white/5 halo                  */
/* ------------------------------------------------------------------ */

const FIELD_BASE = cx(
  "w-full rounded-[9px] bg-page text-[12.5px] text-ink",
  "border border-[rgba(255,255,255,0.10)] placeholder:text-faint",
  "transition-[border-color,box-shadow] duration-100 outline-none",
  "focus:border-[rgba(255,255,255,0.28)] focus:shadow-[0_0_0_3px_rgba(255,255,255,0.05)]",
  "disabled:opacity-50 disabled:cursor-not-allowed",
);

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...rest }, ref) {
    return <input ref={ref} className={cx(FIELD_BASE, "h-8 px-2.5", className)} {...rest} />;
  },
);

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, children, ...rest }, ref) {
    return (
      <select
        ref={ref}
        className={cx(FIELD_BASE, "h-8 px-2 appearance-auto bg-page", className)}
        {...rest}
      >
        {children}
      </select>
    );
  },
);

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...rest }, ref) {
    return <textarea ref={ref} className={cx(FIELD_BASE, "min-h-16 px-2.5 py-2", className)} {...rest} />;
  },
);

export function Label({ className, ...rest }: HTMLAttributes<HTMLLabelElement> & { htmlFor?: string }) {
  return <label className={cx("block text-[12px] font-medium text-muted mb-1.5", className)} {...rest} />;
}

/* ------------------------------------------------------------------ */
/* Badge — 26px pill with 6px dot (Submitted / Not submitted / etc.)   */
/* ------------------------------------------------------------------ */

export type BadgeTone = "green" | "amber" | "red" | "neutral" | "blue";

const BADGE_TONES: Record<BadgeTone, { box: string; dot: string }> = {
  green: {
    box: "bg-[rgba(61,214,140,0.12)] border-[rgba(61,214,140,0.30)] text-[#7fe3b1]",
    dot: "bg-ok",
  },
  amber: {
    box: "bg-[rgba(245,165,36,0.10)] border-[rgba(245,165,36,0.30)] text-[#f7c566]",
    dot: "bg-warn",
  },
  red: {
    box: "bg-[rgba(226,24,51,0.12)] border-[rgba(226,24,51,0.35)] text-[#ff8b9b]",
    dot: "bg-umd",
  },
  blue: {
    box: "bg-[rgba(125,147,178,0.14)] border-[rgba(125,147,178,0.35)] text-[#a9bcd6]",
    dot: "bg-classblue",
  },
  neutral: {
    box: "bg-[rgba(255,255,255,0.05)] border-[rgba(255,255,255,0.10)] text-muted",
    dot: "bg-faint",
  },
};

export function Badge({
  tone = "neutral",
  dot = true,
  className,
  children,
}: {
  tone?: BadgeTone;
  dot?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const t = BADGE_TONES[tone];
  return (
    <span
      className={cx(
        "inline-flex h-[26px] items-center gap-1.5 rounded-[7px] border px-[9px]",
        "text-[12px] font-medium whitespace-nowrap",
        t.box,
        className,
      )}
    >
      {dot ? <span className={cx("size-1.5 rounded-full", t.dot)} aria-hidden /> : null}
      {children}
    </span>
  );
}

/** Submitted / Not submitted, exactly per the board. */
export function StatusBadge({ submitted, className }: { submitted: boolean; className?: string }) {
  return (
    <Badge tone={submitted ? "green" : "amber"} className={className}>
      {submitted ? "Submitted" : "Not submitted"}
    </Badge>
  );
}

/* ------------------------------------------------------------------ */
/* Chip — 22px TA chip (normal / conflict / overcap), optional lock    */
/* ------------------------------------------------------------------ */

export type ChipState = "normal" | "conflict" | "overcap";

const CHIP_STATES: Record<ChipState, string> = {
  normal:
    "bg-[rgba(255,255,255,0.07)] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.10)] text-ink",
  conflict:
    "bg-[rgba(226,24,51,0.14)] shadow-[inset_0_0_0_1px_rgba(226,24,51,0.7),0_0_10px_rgba(226,24,51,0.25)] text-ink",
  overcap:
    "bg-[rgba(245,165,36,0.10)] shadow-[inset_0_0_0_1px_rgba(245,165,36,0.6)] text-ink",
};

export function Chip({
  state = "normal",
  locked,
  onRemove,
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLSpanElement> & {
  state?: ChipState;
  locked?: boolean;
  onRemove?: () => void;
}) {
  return (
    <span
      className={cx(
        "inline-flex h-[22px] items-center gap-1 rounded-[6px] px-2",
        "text-[12px] whitespace-nowrap select-none",
        CHIP_STATES[state],
        className,
      )}
      {...rest}
    >
      {children}
      {locked ? <Lock size={10} strokeWidth={1.5} className="text-faint shrink-0" aria-label="Locked" /> : null}
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          aria-label="Remove"
          className="ml-0.5 -mr-1 grid size-3.5 place-items-center rounded text-faint hover:text-ink cursor-pointer"
        >
          <X size={10} strokeWidth={1.5} />
        </button>
      ) : null}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Surface / Card                                                      */
/* ------------------------------------------------------------------ */

export function Surface({
  level = "surface",
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLDivElement> & { level?: "surface" | "raised" | "popover" }) {
  return (
    <div
      className={cx(
        "rounded-[10px] border border-line",
        level === "surface" && "bg-surface",
        level === "raised" && "bg-raised",
        level === "popover" && "bg-popover",
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

export function Card({
  title,
  actions,
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLDivElement> & { title?: ReactNode; actions?: ReactNode }) {
  return (
    <Surface className={cx("p-4", className)} {...rest}>
      {title !== undefined || actions !== undefined ? (
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-[13px] font-medium text-ink">{title}</h2>
          {actions}
        </div>
      ) : null}
      {children}
    </Surface>
  );
}

/** Legacy name kept for existing pages. */
export function SectionCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card title={title}>
      <div className="text-[12.5px] text-muted">{children}</div>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Table primitives                                                    */
/* ------------------------------------------------------------------ */

export function Table({ className, children, ...rest }: HTMLAttributes<HTMLTableElement>) {
  return (
    <table className={cx("w-full border-collapse text-left text-[12.5px]", className)} {...rest}>
      {children}
    </table>
  );
}

export function THead({ className, children, ...rest }: HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <thead className={cx("border-b border-line", className)} {...rest}>
      {children}
    </thead>
  );
}

export function TBody({ className, children, ...rest }: HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <tbody className={className} {...rest}>
      {children}
    </tbody>
  );
}

export function TR({ className, children, ...rest }: HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      className={cx("border-b border-line last:border-b-0 hover:bg-[rgba(255,255,255,0.02)]", className)}
      {...rest}
    >
      {children}
    </tr>
  );
}

export function TH({ className, children, ...rest }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={cx(
        "px-3 py-2 text-[11px] font-medium uppercase tracking-[0.06em] text-faint",
        className,
      )}
      {...rest}
    >
      {children}
    </th>
  );
}

export function TD({ className, children, ...rest }: TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td className={cx("px-3 py-2.5 text-ink align-middle", className)} {...rest}>
      {children}
    </td>
  );
}

/* ------------------------------------------------------------------ */
/* Modal — centered, popover surface, Escape/overlay closes            */
/* ------------------------------------------------------------------ */

export function Modal({
  open,
  onClose,
  title,
  footer,
  width = 440,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  footer?: ReactNode;
  width?: number;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 grid place-items-center p-6" role="dialog" aria-modal="true">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/60 cursor-default"
      />
      <div
        className="relative flex max-h-[85vh] flex-col rounded-[14px] border border-line-strong bg-popover shadow-[0_20px_60px_rgba(0,0,0,0.55)]"
        style={{ width, maxWidth: "100%" }}
      >
        {title !== undefined ? (
          <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
            <h2 className="text-[13px] font-semibold text-ink">{title}</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close dialog"
              className="grid size-6 place-items-center rounded-[6px] text-faint hover:bg-[rgba(255,255,255,0.06)] hover:text-ink cursor-pointer"
            >
              <X size={14} strokeWidth={1.5} />
            </button>
          </div>
        ) : null}
        <div className="overflow-y-auto px-4 py-3.5">{children}</div>
        {footer !== undefined ? (
          <div className="flex items-center justify-end gap-2 border-t border-line px-4 py-3">{footer}</div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}

/* ------------------------------------------------------------------ */
/* Drawer — slides in from the right                                   */
/* ------------------------------------------------------------------ */

export function Drawer({
  open,
  onClose,
  title,
  footer,
  width = 400,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  footer?: ReactNode;
  width?: number;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/50 cursor-default"
      />
      <div
        className="absolute inset-y-0 right-0 flex flex-col border-l border-line-strong bg-surface shadow-[-20px_0_60px_rgba(0,0,0,0.45)]"
        style={{ width, maxWidth: "92vw" }}
      >
        <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <h2 className="text-[13px] font-semibold text-ink">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close drawer"
            className="grid size-6 place-items-center rounded-[6px] text-faint hover:bg-[rgba(255,255,255,0.06)] hover:text-ink cursor-pointer"
          >
            <X size={14} strokeWidth={1.5} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-3.5">{children}</div>
        {footer !== undefined ? (
          <div className="flex items-center justify-end gap-2 border-t border-line px-4 py-3">{footer}</div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}

/* ------------------------------------------------------------------ */
/* Toast system — bottom-right, one line, optional link, ~4s dismiss   */
/* Mount <Toaster /> once (app root); call toast(...) from anywhere.   */
/* ------------------------------------------------------------------ */

export type ToastTone = "success" | "error" | "info";

export interface ToastOptions {
  tone?: ToastTone;
  /** Optional inline link at the end of the toast line. */
  link?: { label: string; to?: string; onClick?: () => void };
  /** Auto-dismiss delay in ms (default 4000). */
  duration?: number;
}

interface ToastItem extends ToastOptions {
  id: number;
  message: string;
}

let toastSeq = 0;
let toastItems: ToastItem[] = [];
const toastListeners = new Set<() => void>();

function emitToasts() {
  for (const l of toastListeners) l();
}

export function toast(message: string, options: ToastOptions = {}) {
  const item: ToastItem = { id: ++toastSeq, message, tone: "success", ...options };
  toastItems = [...toastItems, item];
  emitToasts();
  const ms = options.duration ?? 4000;
  window.setTimeout(() => dismissToast(item.id), ms);
  return item.id;
}

export function dismissToast(id: number) {
  if (!toastItems.some((t) => t.id === id)) return;
  toastItems = toastItems.filter((t) => t.id !== id);
  emitToasts();
}

/** Hook form for components that prefer it; same function, stable identity. */
export function useToast() {
  return toast;
}

const TOAST_DOTS: Record<ToastTone, string> = {
  success: "bg-ok",
  error: "bg-umd",
  info: "bg-classblue",
};

export function Toaster() {
  const items = useSyncExternalStore(
    (cb) => {
      toastListeners.add(cb);
      return () => toastListeners.delete(cb);
    },
    () => toastItems,
  );
  if (items.length === 0) return null;
  return createPortal(
    <div className="fixed bottom-4 right-4 z-[60] flex flex-col items-end gap-2">
      {items.map((t) => (
        <div
          key={t.id}
          className="flex h-9 items-center gap-2 rounded-[10px] border border-line-strong bg-popover pl-3 pr-2 text-[12.5px] text-ink shadow-[0_12px_40px_rgba(0,0,0,0.5)] whitespace-nowrap"
        >
          <span className={cx("size-1.5 rounded-full shrink-0", TOAST_DOTS[t.tone ?? "success"])} aria-hidden />
          <span>{t.message}</span>
          {t.link ? (
            t.link.to ? (
              <Link
                to={t.link.to}
                onClick={() => dismissToast(t.id)}
                className="font-medium text-ink underline underline-offset-2 hover:text-white"
              >
                {t.link.label}
              </Link>
            ) : (
              <button
                type="button"
                onClick={() => {
                  t.link?.onClick?.();
                  dismissToast(t.id);
                }}
                className="font-medium text-ink underline underline-offset-2 hover:text-white cursor-pointer"
              >
                {t.link.label}
              </button>
            )
          ) : null}
          <button
            type="button"
            onClick={() => dismissToast(t.id)}
            aria-label="Dismiss"
            className="ml-1 grid size-5 place-items-center rounded-[5px] text-faint hover:bg-[rgba(255,255,255,0.06)] hover:text-ink cursor-pointer"
          >
            <X size={12} strokeWidth={1.5} />
          </button>
        </div>
      ))}
    </div>,
    document.body,
  );
}

/* ------------------------------------------------------------------ */
/* Tooltip — pure CSS hover, popover surface                           */
/* ------------------------------------------------------------------ */

export function Tooltip({
  label,
  side = "top",
  children,
  className,
}: {
  label: ReactNode;
  side?: "top" | "bottom";
  children: ReactNode;
  className?: string;
}) {
  return (
    <span className={cx("group/tt relative inline-flex", className)}>
      {children}
      <span
        role="tooltip"
        className={cx(
          "pointer-events-none absolute left-1/2 z-50 -translate-x-1/2 whitespace-nowrap",
          "rounded-[7px] border border-line-strong bg-popover px-2 py-1 text-[11.5px] text-ink",
          "shadow-[0_8px_24px_rgba(0,0,0,0.5)] opacity-0 transition-opacity duration-100",
          "group-hover/tt:opacity-100",
          side === "top" ? "bottom-full mb-1.5" : "top-full mt-1.5",
        )}
      >
        {label}
      </span>
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Kbd                                                                 */
/* ------------------------------------------------------------------ */

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cx(
        "inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[5px]",
        "border border-line-strong bg-[rgba(255,255,255,0.06)] px-1",
        "font-mono text-[10.5px] text-muted",
        className,
      )}
    >
      {children}
    </kbd>
  );
}

/* ------------------------------------------------------------------ */
/* Spinners                                                            */
/* ------------------------------------------------------------------ */

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 py-8 text-[12.5px] text-muted">
      <Loader2 size={16} strokeWidth={1.5} className="animate-spin" aria-hidden />
      <span>{label ?? "Loading…"}</span>
    </div>
  );
}

export function FullPageSpinner({ label }: { label?: string }) {
  return (
    <div className="flex h-full min-h-screen items-center justify-center bg-page">
      <Spinner label={label} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* EmptyState                                                          */
/* ------------------------------------------------------------------ */

export function EmptyState({
  icon: Icon,
  title,
  hint,
  children,
}: {
  icon?: LucideIcon;
  title: string;
  hint?: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-[10px] border border-dashed border-line-strong bg-surface px-6 py-12 text-center">
      {Icon ? <Icon size={20} strokeWidth={1.5} className="text-faint" aria-hidden /> : null}
      <p className="mt-3 text-[13px] font-medium text-ink">{title}</p>
      {hint ? <p className="mt-1 max-w-sm text-[12.5px] text-muted">{hint}</p> : null}
      {children ? <div className="mt-4">{children}</div> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* PageHeader (legacy name kept)                                       */
/* ------------------------------------------------------------------ */

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-5 flex items-start justify-between gap-4">
      <div>
        <h1 className="text-[17px] font-semibold tracking-[-0.01em] text-ink">{title}</h1>
        {description ? <p className="mt-0.5 text-[12.5px] text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* ProgressBar — TA load bar (green under cap, amber at/over cap)      */
/* ------------------------------------------------------------------ */

export function ProgressBar({
  value,
  max,
  tone,
  className,
}: {
  value: number;
  max: number;
  /** Defaults to "ok", flips to "warn" automatically when value > max. */
  tone?: "ok" | "warn" | "red" | "neutral";
  className?: string;
}) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  const auto = tone ?? (value > max ? "warn" : "ok");
  const fill =
    auto === "ok" ? "bg-ok" : auto === "warn" ? "bg-warn" : auto === "red" ? "bg-umd" : "bg-faint";
  return (
    <div className={cx("h-1 w-full overflow-hidden rounded-full bg-[rgba(255,255,255,0.08)]", className)}>
      <div className={cx("h-full rounded-full", fill)} style={{ width: `${pct}%` }} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* SegmentedControl                                                    */
/* ------------------------------------------------------------------ */

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
  icon?: LucideIcon;
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  className,
}: {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      className={cx(
        "inline-flex h-8 items-center gap-0.5 rounded-[9px] border border-line bg-[rgba(255,255,255,0.03)] p-0.5",
        className,
      )}
    >
      {options.map((o) => {
        const active = o.value === value;
        const Icon = o.icon;
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(o.value)}
            className={cx(
              "inline-flex h-full items-center gap-1.5 rounded-[7px] px-2.5 text-[12.5px] cursor-pointer transition-colors duration-100",
              active
                ? "bg-[rgba(255,255,255,0.09)] font-medium text-ink shadow-[inset_0_0_0_1px_rgba(255,255,255,0.10)]"
                : "text-muted hover:text-ink",
            )}
          >
            {Icon ? <Icon size={14} strokeWidth={1.5} aria-hidden /> : null}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Stepper — onboarding steps                                          */
/* ------------------------------------------------------------------ */

export function Stepper({ steps, current, className }: { steps: string[]; current: number; className?: string }) {
  return (
    <ol className={cx("flex items-center gap-2", className)}>
      {steps.map((label, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li key={label} className="flex items-center gap-2">
            {i > 0 ? <span className="h-px w-6 bg-line-strong" aria-hidden /> : null}
            <span
              className={cx(
                "grid size-5 place-items-center rounded-full font-mono text-[10.5px]",
                done && "bg-[rgba(61,214,140,0.15)] text-ok shadow-[inset_0_0_0_1px_rgba(61,214,140,0.38)]",
                active && "bg-umd text-white",
                !done && !active && "bg-[rgba(255,255,255,0.05)] text-faint shadow-[inset_0_0_0_1px_rgba(255,255,255,0.10)]",
              )}
            >
              {done ? <Check size={11} strokeWidth={2} aria-hidden /> : i + 1}
            </span>
            <span className={cx("text-[12.5px]", active ? "font-medium text-ink" : done ? "text-muted" : "text-faint")}>
              {label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
