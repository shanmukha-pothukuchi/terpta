/**
 * Which kinds of work a screen is currently showing.
 *
 * A view preference, not data: it belongs to the person looking at the
 * screen, not to the period, so it lives in localStorage rather than Convex
 * and never travels to another user. The pure parts are separated from the
 * hook so they can be tested without a DOM.
 */
import { useCallback, useEffect, useState } from "react";

/** Add or drop an id, kept sorted so the stored value is stable. */
export function toggleHidden(hidden: readonly string[], id: string): string[] {
  return hidden.includes(id)
    ? hidden.filter((h) => h !== id)
    : [...hidden, id].sort();
}

/** Parse a stored value, tolerating anything that is not our array. */
export function parseHidden(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === "string").sort();
  } catch {
    return [];
  }
}

function read(key: string): string[] {
  try {
    return parseHidden(window.localStorage.getItem(key));
  } catch {
    return []; // private mode, or storage disabled
  }
}

function write(key: string, value: readonly string[]): void {
  try {
    if (value.length === 0) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Losing the preference is not worth failing a render over.
  }
}

export interface HiddenIds {
  hidden: Set<string>;
  isHidden: (id: string) => boolean;
  toggle: (id: string) => void;
  showAll: () => void;
  /** Hide everything except this one — the "only this" gesture. */
  showOnly: (id: string, all: readonly string[]) => void;
}

/**
 * Hidden ids for one screen, remembered across visits.
 *
 * `key` is null while the screen has nothing to scope the preference to (no
 * period picked yet); nothing is hidden and nothing is stored in that case.
 */
export function useHiddenIds(key: string | null): HiddenIds {
  const [hidden, setHidden] = useState<string[]>(() => (key ? read(key) : []));

  // Switching period (or user) swaps the whole preference.
  useEffect(() => {
    setHidden(key ? read(key) : []);
  }, [key]);

  const commit = useCallback(
    (next: string[]) => {
      setHidden(next);
      if (key) write(key, next);
    },
    [key],
  );

  const toggle = useCallback(
    (id: string) => commit(toggleHidden(hidden, id)),
    [commit, hidden],
  );
  const showAll = useCallback(() => commit([]), [commit]);
  const showOnly = useCallback(
    (id: string, all: readonly string[]) => commit(all.filter((x) => x !== id).sort()),
    [commit],
  );

  return {
    hidden: new Set(hidden),
    isHidden: (id: string) => hidden.includes(id),
    toggle,
    showAll,
    showOnly,
  };
}
