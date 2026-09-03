/* Course autocomplete — debounced typeahead over the parent's search fn.
   Presentational only: it never talks to Convex or umd.io itself. */
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Loader2, Search } from "lucide-react";
import { Input } from "../../../components/ui";

export interface CourseSearchResult {
  courseId: string;
  name: string;
}

export interface CourseSearchProps {
  /** Debounced by this component; returns [] when the query is too short. */
  onSearch: (query: string) => Promise<CourseSearchResult[]>;
  onSelect: (result: CourseSearchResult) => void;
  disabled?: boolean;
  placeholder?: string;
}

const MIN_QUERY = 2;
const DEBOUNCE_MS = 250;
const MAX_RESULTS = 8;

export function CourseSearch({ onSearch, onSelect, disabled, placeholder }: CourseSearchProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CourseSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [settled, setSettled] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const wrapRef = useRef<HTMLDivElement>(null);
  const seq = useRef(0);
  // Held in a ref so an unmemoised parent prop can't restart the debounce.
  const searchRef = useRef(onSearch);
  useEffect(() => {
    searchRef.current = onSearch;
  });

  const listId = useId();
  const optionId = (i: number) => `${listId}-opt-${i}`;

  /* Debounced query -> results. Stale responses are dropped by sequence. */
  useEffect(() => {
    const q = query.trim();
    if (q.length < MIN_QUERY) {
      seq.current++;
      setResults([]);
      setLoading(false);
      setSettled(false);
      return;
    }
    setLoading(true);
    const mine = ++seq.current;
    const timer = window.setTimeout(() => {
      searchRef
        .current(q)
        .then((rows) => {
          if (seq.current !== mine) return;
          setResults(rows.slice(0, MAX_RESULTS));
          setActive(0);
          setSettled(true);
          setLoading(false);
          setOpen(true);
        })
        .catch(() => {
          if (seq.current !== mine) return;
          setResults([]);
          setSettled(true);
          setLoading(false);
        });
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [query]);

  /* Click outside closes the dropdown. */
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  const longEnough = query.trim().length >= MIN_QUERY;
  const showEmpty = longEnough && settled && !loading && results.length === 0;
  const showList = open && longEnough && (results.length > 0 || showEmpty);

  function pick(result: CourseSearchResult) {
    seq.current++;
    setQuery("");
    setResults([]);
    setSettled(false);
    setLoading(false);
    setOpen(false);
    onSelect(result);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      setOpen(false);
      return;
    }
    if (e.key === "ArrowDown" && !open) {
      if (results.length > 0) {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }
    if (!showList || results.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (i + 1) % results.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i - 1 + results.length) % results.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const hit = results[active];
      if (hit) pick(hit);
    }
  }

  return (
    <div ref={wrapRef} className="relative">
      <Search
        size={14}
        strokeWidth={1.5}
        aria-hidden
        className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-faint"
      />
      <Input
        type="text"
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList && results.length > 0 ? optionId(active) : undefined}
        autoComplete="off"
        spellCheck={false}
        disabled={disabled}
        value={query}
        placeholder={placeholder ?? "Search courses — e.g. CMSC216"}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        className="pl-8 pr-8"
      />
      {loading ? (
        <Loader2
          size={14}
          strokeWidth={1.5}
          aria-hidden
          className="absolute right-2.5 top-1/2 -translate-y-1/2 animate-spin text-faint"
        />
      ) : null}

      {showList ? (
        <div
          id={listId}
          role="listbox"
          aria-label="Course results"
          className="absolute left-0 right-0 top-[calc(100%+4px)] z-30 overflow-hidden rounded-[10px] border border-line-strong bg-popover shadow-[0_12px_40px_rgba(0,0,0,0.5)]"
        >
          {results.length === 0 ? (
            <div className="flex h-9 items-center px-3 text-[12.5px] text-faint">No matches</div>
          ) : (
            results.map((r, i) => (
              <button
                key={r.courseId}
                id={optionId(i)}
                type="button"
                role="option"
                aria-selected={i === active}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(r)}
                className={`flex h-9 w-full cursor-pointer items-center gap-2.5 border-b border-[rgba(255,255,255,0.04)] px-3 text-left last:border-b-0 ${
                  i === active ? "bg-[rgba(255,255,255,0.06)]" : "hover:bg-[rgba(255,255,255,0.04)]"
                }`}
              >
                <span className="w-[68px] shrink-0 font-mono text-[12.5px] font-medium text-ink">
                  {r.courseId}
                </span>
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-muted">{r.name}</span>
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
