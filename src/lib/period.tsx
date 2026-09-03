import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useCurrentUser } from "./useCurrentUser";

/**
 * Course/term (staffing period) selection, backed by api.periods.listMine.
 * The shell's top-bar switcher writes the selection; pages read it via
 * `usePeriod()`. The original `{ periodId, label }` shape is preserved for
 * existing consumers; the richer fields are additive.
 */

export type PeriodStatus = "draft" | "collecting" | "generated" | "published";

export interface PeriodEntry {
  periodId: Id<"staffingPeriods">;
  /** e.g. "CMSC132" (falls back to "Course" if the course row is missing). */
  courseId: string;
  courseName: string;
  /** e.g. "Fall 2026" */
  term: string;
  status: PeriodStatus;
  collectionDeadline: string;
  /** The caller's TA profile in this period, if they are a TA in it. */
  taProfileId: Id<"taProfiles"> | null;
  /** "CMSC132 · Fall 2026" */
  label: string;
}

export interface PeriodSelection {
  periodId: Id<"staffingPeriods"> | null;
  label: string;
  /** True while the user or their period list is still loading. */
  loading: boolean;
  entries: PeriodEntry[];
  selected: PeriodEntry | null;
  /** taProfileId of the selected period (null for coordinators). */
  taProfileId: Id<"taProfiles"> | null;
  selectPeriod: (id: Id<"staffingPeriods">) => void;
}

const EMPTY_SELECTION: PeriodSelection = {
  periodId: null,
  label: "No course selected",
  loading: false,
  entries: [],
  selected: null,
  taProfileId: null,
  selectPeriod: () => {},
};

const PeriodContext = createContext<PeriodSelection>(EMPTY_SELECTION);

export function usePeriod(): PeriodSelection {
  return useContext(PeriodContext);
}

const STORAGE_KEY = "terpta:periodId";

function readStoredPeriodId(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function storePeriodId(id: string) {
  try {
    window.localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // Private mode etc. — selection just won't persist.
  }
}

export function PeriodProvider({ children }: { children: ReactNode }) {
  const me = useCurrentUser();
  // Skip until the users row exists — listMine requires an authenticated row.
  const mine = useQuery(api.periods.listMine, me ? {} : "skip");
  const [chosenId, setChosenId] = useState<string | null>(readStoredPeriodId);

  const entries = useMemo<PeriodEntry[]>(() => {
    if (!mine) return [];
    return [...mine]
      .sort((a, b) => b.period._creationTime - a.period._creationTime)
      .map(({ period, course, taProfileId }) => {
        const courseId = course?.courseId ?? "Course";
        return {
          periodId: period._id,
          courseId,
          courseName: course?.name ?? "",
          term: period.term,
          status: period.status,
          collectionDeadline: period.collectionDeadline,
          taProfileId,
          label: `${courseId} · ${period.term}`,
        };
      });
  }, [mine]);

  const selected = useMemo(() => {
    if (entries.length === 0) return null;
    return entries.find((e) => e.periodId === chosenId) ?? entries[0];
  }, [entries, chosenId]);

  // Once real data resolves a selection, keep localStorage in sync (covers
  // the "stored id no longer in the list" fallback-to-first case).
  useEffect(() => {
    if (selected && selected.periodId !== chosenId) {
      setChosenId(selected.periodId);
      storePeriodId(selected.periodId);
    }
  }, [selected, chosenId]);

  const selectPeriod = useCallback((id: Id<"staffingPeriods">) => {
    setChosenId(id);
    storePeriodId(id);
  }, []);

  const loading = me === undefined || (me !== null && mine === undefined);

  const value = useMemo<PeriodSelection>(
    () => ({
      periodId: selected?.periodId ?? null,
      label: selected?.label ?? (loading ? "Loading…" : "No course selected"),
      loading,
      entries,
      selected,
      taProfileId: selected?.taProfileId ?? null,
      selectPeriod,
    }),
    [selected, entries, loading, selectPeriod],
  );

  return (
    <PeriodContext.Provider value={value}>{children}</PeriodContext.Provider>
  );
}

/**
 * Hook-free provider for previews/tests: supplies a fixed selection without
 * touching Convex. Pass any subset; the rest falls back to an empty state.
 */
export function StaticPeriodProvider({
  value,
  children,
}: {
  value: Partial<PeriodSelection>;
  children: ReactNode;
}) {
  const merged = useMemo<PeriodSelection>(
    () => ({ ...EMPTY_SELECTION, ...value }),
    [value],
  );
  return (
    <PeriodContext.Provider value={merged}>{children}</PeriodContext.Provider>
  );
}
