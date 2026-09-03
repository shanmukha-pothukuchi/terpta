import type { ReactNode } from "react";
import { Loader2, type LucideIcon } from "lucide-react";

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex items-start justify-between gap-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-1 text-sm text-neutral-500">{description}</p>
      </div>
      {actions}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 py-8 text-sm text-neutral-500">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
      <span>{label ?? "Loading…"}</span>
    </div>
  );
}

export function FullPageSpinner({ label }: { label?: string }) {
  return (
    <div className="flex h-full min-h-screen items-center justify-center">
      <Spinner label={label} />
    </div>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  hint,
  children,
}: {
  icon: LucideIcon;
  title: string;
  hint?: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-neutral-300 px-6 py-12 text-center">
      <Icon className="h-6 w-6 text-neutral-400" aria-hidden />
      <p className="mt-3 text-sm font-medium text-neutral-700">{title}</p>
      {hint ? <p className="mt-1 text-sm text-neutral-500">{hint}</p> : null}
      {children}
    </div>
  );
}

export function SectionCard({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-neutral-200 p-4">
      <h2 className="text-sm font-medium text-neutral-800">{title}</h2>
      <div className="mt-2 text-sm text-neutral-500">{children}</div>
    </section>
  );
}
