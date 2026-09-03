/* Course + section combobox — a token input, not a search box above a list.
   Committed courses live inside the same bordered row the user types in, and
   the field takes both halves of "CMSC330 0201", so a TA lands on the section
   they are actually in rather than whichever one the course lists first.
   Purely presentational: it never talks to Convex or umd.io itself.

   parseCourseQuery() decides the phase. While the course code is incomplete
   ("CMSC3") the dropdown suggests courses, and picking one only fills the code
   in — it does not commit. Once the code parses ("CMSC330", "CMSC330 02") the
   dropdown lists that course's sections, filtered by the digits typed so far.

   It reports the highlighted course *and section* upward so the parent can
   import the course and ghost exactly those meetings into the preview card
   before anything is committed. */
import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Loader2, X } from "lucide-react";
import type { Id } from "../../../../convex/_generated/dataModel";
import { formatMeeting } from "../../../lib/format";
import { parseCourseQuery, type EnrollableSection } from "./model";

export interface CourseSearchResult {
  courseId: string;
  name: string;
}

/** What the parent knows about a fully typed course code. */
export type SectionLookup =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; sections: EnrollableSection[] };

/** A committed course, with the one section the TA asked for. */
export interface CoursePick {
  courseId: string;
  /** null when the import hadn't landed, or when no section was typed. */
  sectionId: Id<"sections"> | null;
  /** The digits typed, so the parent can resolve them once sections arrive. */
  sectionNumber: string | null;
}

/** What to ghost into the preview card. A null section means the defaults. */
export interface CourseHighlight {
  courseId: string;
  sectionId: Id<"sections"> | null;
}

export interface CourseSearchProps {
  /** Committed courses, rendered as removable mono chips inside the input. */
  chips: Array<{ courseId: string; label: string }>;
  onRemoveChip: (courseId: string) => void;
  /** Debounced by this component; only runs while the code is incomplete. */
  onSearch: (query: string) => Promise<CourseSearchResult[]>;
  /** Commits the course with the section the TA picked (or the defaults). */
  onSelect: (pick: CoursePick) => void;
  /** Fires whenever the highlighted course/section changes; null when none. */
  onHighlight?: (highlight: CourseHighlight | null) => void;
  /** Sections of a fully typed course — "loading" until its import lands. */
  sectionsFor: (courseId: string) => SectionLookup;
  /**
   * Right-hand meta for a course row — "Sec 0201 · TuTh 2:00p". Comes from
   * importing the highlighted course, so it is blank until that lands.
   */
  metaFor?: (courseId: string) => string;
  disabled?: boolean;
  placeholder?: string;
}

const MIN_QUERY = 2;
const DEBOUNCE_MS = 250;
const MAX_RESULTS = 6;

const PLACEHOLDER = "Course and section — e.g. CMSC216 0101";
const FOOTER_COURSE = "Don’t see it? Add a custom block on the next step.";
const FOOTER_SECTION = "Type your section number, or press Enter for the first one.";

/** "Tu 2:00p–3:15p · Th 2:00p–3:15p" — every meeting of one section. */
function sectionTimes(section: EnrollableSection): string {
  if (section.meetings.length === 0) return "TBA";
  return section.meetings.map((m) => formatMeeting(m.day, m.startMin, m.endMin)).join(" · ");
}

/** "IRB 1207 · Nelson Padua-Perez" — where it meets and who teaches it. */
function sectionWhere(section: EnrollableSection): string {
  const rooms = [...new Set(section.meetings.map((m) => m.room).filter(Boolean))].join(" · ");
  return [rooms, section.instructors?.[0] ?? ""].filter(Boolean).join(" · ");
}

export function CourseSearch({
  chips,
  onRemoveChip,
  onSearch,
  onSelect,
  onHighlight,
  sectionsFor,
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
  /** -1 means "nothing highlighted", which phase B starts in. */
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

  /* Phase A while courseId is null, phase B once the code parses. */
  const { courseId, sectionPrefix } = parseCourseQuery(query);

  /* Phase A — course suggestions. */
  const taken = new Set(chips.map((c) => c.courseId));
  const courseRows = results.filter((r) => !taken.has(r.courseId)).slice(0, MAX_RESULTS);
  const longEnough = query.trim().length >= MIN_QUERY;
  const showEmpty = longEnough && settled && !loading && courseRows.length === 0;

  /* Phase B — that course's sections, prefix-matched on the typed digits. */
  const lookup = courseId ? sectionsFor(courseId) : null;
  const sectionRows =
    lookup?.status === "ready"
      ? lookup.sections.filter((s) => s.sectionNumber.toUpperCase().startsWith(sectionPrefix))
      : [];

  const count = courseId ? sectionRows.length : courseRows.length;
  const showList =
    open && (courseId ? true : longEnough && (courseRows.length > 0 || showEmpty));

  /* The row Enter would take. Phase B leaves nothing highlighted until the TA
     types digits or arrows down, which is what keeps the defaults fallback
     reachable; phase A always highlights its first row, as it always has. */
  const clamped = active >= count ? count - 1 : active;
  const selected = courseId
    ? clamped >= 0
      ? clamped
      : sectionPrefix && count > 0
        ? 0
        : -1
    : count > 0
      ? Math.max(clamped, 0)
      : -1;

  /* Debounced query -> course results. Stale responses are dropped by
     sequence. Phase B never searches: the code is already known. */
  useEffect(() => {
    const q = query.trim();
    if (parseCourseQuery(q).courseId !== null || q.length < MIN_QUERY) {
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

  /* Tell the parent what to preview. Keyed on ids, not objects, so re-reading
     the same list doesn't re-trigger an import. Phase B reports even with the
     dropdown closed — the query still names a course, and Enter still commits
     it — so the ghost always matches what would be added. */
  const highlightCourse = courseId ?? (showList ? (courseRows[selected]?.courseId ?? null) : null);
  const highlightSection = courseId ? (sectionRows[selected]?._id ?? null) : null;
  useEffect(() => {
    highlightRef.current?.(
      highlightCourse ? { courseId: highlightCourse, sectionId: highlightSection } : null,
    );
  }, [highlightCourse, highlightSection]);

  /* Clear the ghost when the control unmounts. */
  useEffect(() => () => highlightRef.current?.(null), []);

  /* Keep the highlighted row in view — the section list scrolls. */
  useEffect(() => {
    if (!showList || selected < 0) return;
    document.getElementById(`${listId}-opt-${selected}`)?.scrollIntoView({ block: "nearest" });
  }, [listId, selected, showList]);

  /* Click outside closes the dropdown. */
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  function retype(next: string, highlighted: number) {
    seq.current++;
    setQuery(next);
    setResults([]);
    setSettled(false);
    setLoading(false);
    setActive(highlighted);
  }

  /* Phase A pick: fill in the code and hand the caret back, so the TA carries
     straight on into their section digits. Nothing is committed yet. */
  function pickCourse(result: CourseSearchResult) {
    retype(`${result.courseId} `, -1);
    setOpen(true);
    inputRef.current?.focus();
  }

  /* Phase B pick: commit the course with exactly this section. */
  function commit(section: EnrollableSection | undefined) {
    if (!courseId) return;
    retype("", 0);
    setOpen(false);
    onSelect({
      courseId,
      sectionId: section?._id ?? null,
      sectionNumber: section?.sectionNumber ?? (sectionPrefix || null),
    });
    inputRef.current?.focus();
  }

  function move(delta: number) {
    if (count === 0) return;
    setActive(
      selected < 0 ? (delta > 0 ? 0 : count - 1) : (selected + delta + count) % count,
    );
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
    if ((e.key === "ArrowDown" || e.key === "ArrowUp") && !open) {
      if (courseId || courseRows.length > 0) {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }
    /* Enter commits in phase B whether or not the list is showing: the query
       already names the course, and an empty section falls back to defaults. */
    if (e.key === "Enter" && courseId) {
      e.preventDefault();
      if (selected >= 0) {
        commit(sectionRows[selected]);
        return;
      }
      /* Digits that match nothing are a dead end, not a reason to silently
         commit the defaults — leave the "No section" row up instead. */
      if (sectionPrefix && lookup?.status === "ready" && sectionRows.length === 0) return;
      commit(undefined);
      return;
    }
    if (!showList || count === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      move(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      move(-1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const hit = courseRows[selected];
      if (hit) pickCourse(hit);
    }
  }

  /* Clicking the padding of the box puts the caret back in the query. */
  function focusQuery(e: ReactPointerEvent<HTMLDivElement>) {
    if (e.target !== e.currentTarget) return;
    inputRef.current?.focus();
  }

  function sectionList() {
    if (lookup?.status === "loading") {
      return (
        <div className="flex h-9 items-center gap-2 px-2.5 text-[13px] text-faint">
          <Loader2 size={14} strokeWidth={1.5} aria-hidden className="shrink-0 animate-spin" />
          <span className="truncate">{`Loading ${courseId} sections…`}</span>
        </div>
      );
    }
    if (lookup?.status === "error") {
      return (
        <div className="flex h-9 items-center px-2.5 text-[13px] text-faint">
          {`Couldn’t load ${courseId}`}
        </div>
      );
    }
    if (sectionRows.length === 0) {
      return (
        <div className="flex h-9 items-center px-2.5 text-[13px] text-faint">
          {sectionPrefix ? `No section ${sectionPrefix}` : "No sections"}
        </div>
      );
    }
    return sectionRows.map((s, i) => {
      const where = sectionWhere(s);
      return (
        <button
          key={s._id}
          id={optionId(i)}
          type="button"
          role="option"
          aria-selected={i === selected}
          onPointerEnter={() => setActive(i)}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => commit(s)}
          className={`flex h-9 w-full cursor-pointer items-center gap-3 rounded-[7px] px-2.5 text-left ${
            i === selected ? "bg-[rgba(255,255,255,0.06)]" : ""
          }`}
        >
          <span className="shrink-0 font-mono text-[13px] font-medium text-ink">
            {s.sectionNumber}
          </span>
          <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-muted">
            {sectionTimes(s)}
          </span>
          {where ? (
            <span className="min-w-0 max-w-[46%] shrink truncate text-right text-[12px] text-faint">
              {where}
            </span>
          ) : null}
        </button>
      );
    });
  }

  function courseList() {
    if (courseRows.length === 0) {
      return <div className="flex h-9 items-center px-2.5 text-[13px] text-faint">No matches</div>;
    }
    return courseRows.map((r, i) => (
      <button
        key={r.courseId}
        id={optionId(i)}
        type="button"
        role="option"
        aria-selected={i === selected}
        onPointerEnter={() => setActive(i)}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => pickCourse(r)}
        className={`flex w-full cursor-pointer items-center gap-3 rounded-[7px] px-2.5 py-2 text-left ${
          i === selected ? "bg-[rgba(255,255,255,0.06)]" : ""
        }`}
      >
        <span className="shrink-0 font-mono text-[13px] font-medium text-ink">{r.courseId}</span>
        <span className="min-w-0 flex-1 truncate text-[13px] text-muted">{r.name}</span>
        <span className="shrink-0 font-mono text-[12px] text-faint">
          {metaFor?.(r.courseId) ?? ""}
        </span>
      </button>
    ));
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
            {chip.label}
            <button
              type="button"
              aria-label={`Remove ${chip.label}`}
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
          aria-label="Search courses and sections"
          aria-activedescendant={showList && selected >= 0 ? optionId(selected) : undefined}
          autoComplete="off"
          spellCheck={false}
          disabled={disabled}
          value={query}
          placeholder={chips.length === 0 ? (placeholder ?? PLACEHOLDER) : ""}
          onChange={(e) => {
            const next = e.target.value;
            setQuery(next);
            setActive(parseCourseQuery(next).courseId !== null ? -1 : 0);
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
          aria-label={courseId ? `Sections of ${courseId}` : "Course results"}
          className="absolute left-0 right-0 top-[calc(100%+6px)] z-30 rounded-[10px] border border-line-strong bg-popover p-1.5 shadow-[0_12px_32px_-12px_rgba(0,0,0,0.75)]"
        >
          {/* Presentational so the options stay owned by the listbox. */}
          <div role="presentation" className="max-h-[248px] overflow-y-auto">
            {courseId ? sectionList() : courseList()}
          </div>

          <div className="mt-1 border-t border-line px-2.5 pb-1 pt-2 text-[11.5px] text-faint">
            {courseId ? FOOTER_SECTION : FOOTER_COURSE}
          </div>
        </div>
      ) : null}
    </div>
  );
}
