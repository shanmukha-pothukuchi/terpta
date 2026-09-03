import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { Id } from "../../convex/_generated/dataModel";

/**
 * Course/term (staffing period) selection. Stubbed for now: always null.
 * The real switcher lands with the coordinator period-setup flow; pages
 * already consume `usePeriod()` so only this file needs to change.
 */
export interface PeriodSelection {
  periodId: Id<"staffingPeriods"> | null;
  label: string;
}

const PeriodContext = createContext<PeriodSelection>({
  periodId: null,
  label: "No course selected",
});

export function usePeriod(): PeriodSelection {
  return useContext(PeriodContext);
}

export function PeriodProvider({ children }: { children: ReactNode }) {
  const value = useMemo<PeriodSelection>(
    () => ({ periodId: null, label: "No course selected" }),
    [],
  );
  return (
    <PeriodContext.Provider value={value}>{children}</PeriodContext.Provider>
  );
}
