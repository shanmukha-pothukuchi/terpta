/* Step 1 — "Courses". Pure presentation over ClassesValue: the parent owns
   persistence and supplies onSearch / onImportCourse, so the same component
   doubles as the Classes section on the Preferences page.

   The whole step is one token combobox plus one preview card. Picking a result
   commits the course with its default sections in a single click; merely
   highlighting one imports it and ghosts its meetings into the card, so the TA
   sees what a pick would do before doing it. Manual entry lives on step 2 —
   this step only points at it from the dropdown footer. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TriangleAlert } from "lucide-react";
import type { Id } from "../../../../convex/_generated/dataModel";
import { formatTime } from "../../../lib/format";
import { CourseSearch, type CourseSearchResult } from "./CourseSearch";
import { ImportPreviewCard } from "./ImportPreviewCard";
import {
  defaultSectionIds,
  previewMeetings,
  type ClassesValue,
  type EnrollableSection,
  type EnrolledCourse,
} from "./model";

/** How long a result stays highlighted before we import it for the ghost. */
const HIGHLIGHT_DEBOUNCE_MS = 120;

interface Imported {
  courseName: string;
  sections: EnrollableSection[];
}

/** "Sec 0201 · TuTh 2:00p" — the default section a pick would commit. */
function resultMeta(sections: EnrollableSection[]): string {
  const ids = defaultSectionIds(sections);
  const picked = ids
    .map((id) => sections.find((s) => s._id === id))
    .filter((s): s is EnrollableSection => Boolean(s));
  const section = picked.find((s) => s.meetings.length > 0) ?? picked[0];
  if (!section) return "";
  if (section.meetings.length === 0) return `Sec ${section.sectionNumber}`;
  const days = [...new Set(section.meetings.map((m) => m.day))].join("");
  return `Sec ${section.sectionNumber} · ${days} ${formatTime(section.meetings[0]!.startMin)}`;
}

export interface Step1CoursesProps {
  value: ClassesValue;
  onChange: (next: ClassesValue) => void;
  /** Debounced course autocomplete. Returns [] when the query is too short. */
  onSearch: (query: string) => Promise<Array<{ courseId: string; name: string }>>;
  /** Imports a course and returns its sections. Rejects if umd.io is down. */
  onImportCourse: (
    courseId: string,
  ) => Promise<{ courseName: string; sections: EnrollableSection[] }>;
}

export function Step1Courses({ value, onChange, onSearch, onImportCourse }: Step1CoursesProps) {
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [ghost, setGhost] = useState<{ courseId: string; sections: EnrollableSection[] } | null>(
    null,
  );
  const [committing, setCommitting] = useState<string | null>(null);
  const [importFailed, setImportFailed] = useState(false);
  /* Bumped whenever an import lands, so metaFor re-reads the cache. */
  const [cacheTick, setCacheTick] = useState(0);

  /* Imports are cached server-side too, but keeping them here means the common
     "hover then click" path commits without a second round trip. */
  const cacheRef = useRef(new Map<string, Imported>());
  const seqRef = useRef(0);

  // Latest props/state for async callbacks, which would otherwise close over
  // a stale `value`.
  const valueRef = useRef(value);
  const changeRef = useRef(onChange);
  const importRef = useRef(onImportCourse);
  useEffect(() => {
    valueRef.current = value;
    changeRef.current = onChange;
    importRef.current = onImportCourse;
  });

  const addCourse = useCallback((courseId: string, imported: Imported, fallbackName?: string) => {
    const current = valueRef.current;
    const next: EnrolledCourse = {
      courseId,
      courseName: imported.courseName || fallbackName || courseId,
      sections: imported.sections,
      selectedSectionIds: defaultSectionIds(imported.sections),
    };
    const index = current.courses.findIndex((c) => c.courseId === courseId);
    changeRef.current({
      ...current,
      courses:
        index >= 0
          ? current.courses.map((c, i) => (i === index ? next : c))
          : [...current.courses, next],
    });
  }, []);

  /* Highlight -> debounced import -> ghost. Stale responses are dropped. */
  useEffect(() => {
    if (!highlightId) {
      seqRef.current++;
      setGhost(null);
      return;
    }
    const cached = cacheRef.current.get(highlightId);
    if (cached) {
      seqRef.current++;
      setGhost({ courseId: highlightId, sections: cached.sections });
      return;
    }
    const mine = ++seqRef.current;
    const timer = window.setTimeout(() => {
      importRef.current(highlightId).then(
        (res) => {
          cacheRef.current.set(highlightId, res);
          setCacheTick((t) => t + 1);
          if (seqRef.current !== mine) return;
          setImportFailed(false);
          setGhost({ courseId: highlightId, sections: res.sections });
        },
        () => {
          if (seqRef.current !== mine) return;
          setGhost(null);
          setImportFailed(true);
        },
      );
    }, HIGHLIGHT_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [highlightId]);

  const handleSelect = useCallback(
    (hit: CourseSearchResult) => {
      seqRef.current++;
      setGhost(null);
      const cached = cacheRef.current.get(hit.courseId);
      if (cached) {
        setImportFailed(false);
        addCourse(hit.courseId, cached, hit.name);
        return;
      }
      setCommitting(hit.courseId);
      importRef.current(hit.courseId).then(
        (res) => {
          cacheRef.current.set(hit.courseId, res);
          setCommitting((c) => (c === hit.courseId ? null : c));
          setImportFailed(false);
          addCourse(hit.courseId, res, hit.name);
        },
        () => {
          setCommitting((c) => (c === hit.courseId ? null : c));
          setImportFailed(true);
        },
      );
    },
    [addCourse],
  );

  const handleRemove = useCallback((courseId: string) => {
    const current = valueRef.current;
    changeRef.current({
      ...current,
      courses: current.courses.filter((c) => c.courseId !== courseId),
    });
  }, []);

  const handleChangeSections = useCallback(
    (courseId: string, selectedSectionIds: Id<"sections">[]) => {
      const current = valueRef.current;
      changeRef.current({
        ...current,
        courses: current.courses.map((c) =>
          c.courseId === courseId ? { ...c, selectedSectionIds } : c,
        ),
      });
    },
    [],
  );

  const metaFor = useCallback(
    (courseId: string) => {
      void cacheTick;
      const cached = cacheRef.current.get(courseId);
      return cached ? resultMeta(cached.sections) : "";
    },
    [cacheTick],
  );

  const rows = useMemo(() => previewMeetings(value, ghost), [value, ghost]);

  return (
    <div className="grid gap-8 lg:grid-cols-[560px_minmax(0,1fr)] lg:items-start lg:gap-x-16">
      {/* Left — the form. Uncarded, by design. */}
      <div className="flex min-w-0 flex-col gap-7">
        <div className="flex flex-col gap-2.5">
          <h2 className="text-[30px] font-semibold leading-[1.15] tracking-[-0.02em] text-ink">
            What are you taking this semester?
          </h2>
          <p className="text-[15px] leading-[1.5] text-muted">
            {
              "We’ll pull your lecture and discussion times from the Schedule of Classes so they’re blocked off automatically."
            }
          </p>
        </div>

        <div className="flex flex-col gap-2.5">
          <CourseSearch
            chips={value.courses}
            onRemoveChip={handleRemove}
            onSearch={onSearch}
            onSelect={handleSelect}
            onHighlight={setHighlightId}
            metaFor={metaFor}
          />

          {committing ? (
            <p className="font-mono text-[12px] text-faint">{`Importing ${committing}…`}</p>
          ) : null}

          {importFailed ? (
            <div
              role="alert"
              className="flex items-start gap-2.5 rounded-[10px] border border-[rgba(226,24,51,0.30)] bg-[rgba(226,24,51,0.10)] px-3 py-2.5 text-[13px] leading-[1.45] text-[#F4A3AE]"
            >
              <TriangleAlert
                size={16}
                strokeWidth={1.5}
                className="mt-px shrink-0 text-umd"
                aria-hidden
              />
              <span>
                {
                  "Couldn’t reach UMD’s schedule of classes — you can add times by hand on the next step."
                }
              </span>
            </div>
          ) : null}
        </div>

        {/* The actions sit low in the column — an onboarding-only treatment. */}
        <div className="h-10 lg:h-[180px]" aria-hidden />

        <div className="flex items-center">
          <p className="text-[13px] text-muted">You can edit this anytime under Preferences.</p>
        </div>
      </div>

      {/* Right — live import preview. The one card on the screen. */}
      <div className="min-w-0">
        <ImportPreviewCard
          rows={rows}
          courses={value.courses}
          onChangeSections={handleChangeSections}
        />
      </div>
    </div>
  );
}
