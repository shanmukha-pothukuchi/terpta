/* Course combobox — a token input, not a search box above a list.
   Committed courses live inside the same bordered row the user types in, and
   picking a result commits it in one click (the parent defaults the sections).
   Purely presentational: it never talks to Convex or umd.io itself.

   It reports the highlighted option upward so the parent can import that course
   and ghost its meetings into the preview card before anything is committed. */
import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Loader2, X } from "lucide-react";

export interface CourseSearchResult {
  courseId: string;
  name: string;
}

export interface CourseSearchProps {
  /** Committed courses, rendered as removable mono chips inside the input. */
  chips: Array<{ courseId: string }>;
  onRemoveChip: (courseId: string) => void;
  /** Debounced by this component; returns [] when the query is too short. */
  onSearch: (query: string) => Promise<CourseSearchResult[]>;
  /** Commits the course. The parent imports it and picks default sections. */
  onSelect: (result: CourseSearchResult) => void;
  /** Fires whenever the highlighted option changes; null when none is. */
  onHighlight?: (courseId: string | null) => void;
  /**
   * Right-hand meta for a result row — "Sec 0201 · TuTh 2:00p". Comes from
   * importing the highlighted course, so it is blank until that lands.
   */
  metaFor?: (courseId: string) => string;
  disabled?: boolean;
  placeholder?: string;
}

const MIN_QUERY = 2;
const DEBOUNCE_MS = 250;
const MAX_RESULTS = 6;

const FOOTER_HINT = "Don’t see it? Add a custom block on the next step.";

export function CourseSearch({
  chips,
  onRemoveChip,
  onSearch,
  onSelect,
  onHighlight,
  metaFor,
  disabled,
  placeholder,
}: CourseSearchProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CourseSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [settled, setSettled] = useState(false);
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const [active, setActive] = useState(0);

  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const seq = useRef(0);

  // Held in refs so unmemoised parent props can't restart the debounce or the
  // highlight effect on every render.
  const searchRef = useRef(onSearch);
  const highlightRef = useRef(onHighlight);
  useEffect(() => {
    searchRef.current = onSearch;
    highlightRef.current = onHighlight;
  });

  const listId = useId();
  const optionId = (i: number) => `${listId}-opt-${i}`;

  const taken = new Set(chips.map((c) => c.courseId));
  const visible = results.filter((r) => !taken.has(r.courseId)).slice(0, MAX_RESULTS);

  const longEnough = query.trim().length >= MIN_QUERY;
  const showEmpty = longEnough && settled && !loading && visible.length === 0;
  const showList = open && longEnough && (visible.length > 0 || showEmpty);

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
          setResults(rows);
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

  /* Tell the parent which course to preview. Keyed on the id, not the object,
     so re-fetching the same list doesn't re-trigger an import. */
  const highlightedId = showList ? (visible[active]?.courseId ?? null) : null;
  useEffect(() => {
    highlightRef.current?.(highlightedId);
  }, [highlightedId]);

  /* Clear the ghost when the control unmounts. */
  useEffect(() => () => highlightRef.current?.(null), []);

  /* Click outside closes the dropdown. */
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  function pick(result: CourseSearchResult) {
    seq.current++;
    setQuery("");
    setResults([]);
    setSettled(false);
    setLoading(false);
    setOpen(false);
    setActive(0);
    onSelect(result);
    inputRef.current?.focus();
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      setOpen(false);
      return;
    }
    if (e.key === "Backspace" && query.length === 0 && chips.length > 0) {
      e.preventDefault();
      onRemoveChip(chips[chips.length - 1]!.courseId);
      return;
    }
    if (e.key === "ArrowDown" && !open) {
      if (visible.length > 0) {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }
    if (!showList || visible.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (i + 1) % visible.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i - 1 + visible.length) % visible.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const hit = visible[active];
      if (hit) pick(hit);
    }
  }

  /* Clicking the padding of the box puts the caret back in the query. */
  function focusQuery(e: ReactPointerEvent<HTMLDivElement>) {
    if (e.target !== e.currentTarget) return;
    inputRef.current?.focus();
  }

  return (
    <div ref={wrapRef} className="relative">
      <div
        onPointerDown={focusQuery}
        className={[
          "flex flex-wrap items-center gap-2 rounded-[10px] border bg-surface px-2.5 py-2",
          "transition-[border-color,box-shadow] duration-100",
          focused
            ? "border-[rgba(255,255,255,0.28)] shadow-[0_0_0_3px_rgba(255,255,255,0.05)]"
            : "border-line",
          disabled ? "cursor-not-allowed opacity-60" : "",
        ].join(" ")}
      >
        {chips.map((chip) => (
          <span
            key={chip.courseId}
            className="flex shrink-0 items-center gap-1 rounded-[6px] bg-raised py-[5px] pl-2 pr-1.5 font-mono text-[13px] font-medium text-ink"
          >
            {chip.courseId}
            <button
              type="button"
              aria-label={`Remove ${chip.courseId}`}
              disabled={disabled}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => onRemoveChip(chip.courseId)}
              className="grid size-4 shrink-0 cursor-pointer place-items-center rounded-[4px] text-faint hover:bg-[rgba(255,255,255,0.08)] hover:text-ink disabled:cursor-not-allowed"
            >
              <X size={14} strokeWidth={1.5} aria-hidden />
            </button>
          </span>
        ))}

        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-label="Search courses"
          aria-activedescendant={
            showList && visible.length > 0 ? optionId(active) : undefined
          }
          autoComplete="off"
          spellCheck={false}
          disabled={disabled}
          value={query}
          placeholder={chips.length === 0 ? (placeholder ?? "Search courses — e.g. CMSC216") : ""}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => {
            setFocused(true);
            setOpen(true);
          }}
          onBlur={() => setFocused(false)}
          onKeyDown={onKeyDown}
          className="h-[26px] min-w-[120px] flex-1 bg-transparent font-mono text-[14px] font-medium text-ink outline-none placeholder:font-sans placeholder:text-[13px] placeholder:font-normal placeholder:text-faint disabled:cursor-not-allowed"
        />

        {loading ? (
          <Loader2
            size={14}
            strokeWidth={1.5}
            aria-hidden
            className="mr-0.5 shrink-0 animate-spin text-faint"
          />
        ) : null}
      </div>

      {showList ? (
        <div
          id={listId}
          role="listbox"
          aria-label="Course results"
          className="absolute left-0 right-0 top-[calc(100%+6px)] z-30 rounded-[10px] border border-line-strong bg-popover p-1.5 shadow-[0_12px_32px_-12px_rgba(0,0,0,0.75)]"
        >
          {visible.length === 0 ? (
            <div className="flex h-9 items-center px-2.5 text-[13px] text-faint">No matches</div>
          ) : (
            visible.map((r, i) => {
              const meta = metaFor?.(r.courseId) ?? "";
              return (
                <button
                  key={r.courseId}
                  id={optionId(i)}
                  type="button"
                  role="option"
                  aria-selected={i === active}
                  onPointerEnter={() => setActive(i)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(r)}
                  className={`flex w-full cursor-pointer items-center gap-3 rounded-[7px] px-2.5 py-2 text-left ${
                    i === active ? "bg-[rgba(255,255,255,0.06)]" : ""
                  }`}
                >
                  <span className="shrink-0 font-mono text-[13px] font-medium text-ink">
                    {r.courseId}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[13px] text-muted">{r.name}</span>
                  <span className="shrink-0 font-mono text-[12px] text-faint">{meta}</span>
                </button>
              );
            })
          )}

          <div className="mt-1 border-t border-line px-2.5 pb-1 pt-2 text-[11.5px] text-faint">
            {FOOTER_HINT}
          </div>
        </div>
      ) : null}
    </div>
  );
}
