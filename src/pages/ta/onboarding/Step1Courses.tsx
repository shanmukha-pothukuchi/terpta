/* Step 1 — "Courses". Pure presentation over ClassesValue: the parent owns
   persistence and supplies onSearch / onImportCourse, so the same component
   doubles as the Classes section on the Preferences page.

   The whole step is one token combobox plus one preview card. The TA types the
   course code and their section number together — "CMSC330 0201" — so what
   gets committed is the section they are actually in, not whichever one the
   course happens to list first. Highlighting a row imports the course and
   ghosts that section's meetings into the card, so the TA sees what a pick
   would do before doing it. Manual entry lives on step 2 — this step only
   points at it from the dropdown footer. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TriangleAlert } from "lucide-react";
import type { Id } from "../../../../convex/_generated/dataModel";
import { Input, Label } from "../../../components/ui";
import { formatTime } from "../../../lib/format";
import {
  CourseSearch,
  type CourseHighlight,
  type CoursePick,
  type SectionLookup,
} from "./CourseSearch";
import { ImportPreviewCard } from "./ImportPreviewCard";
import {
  chipLabel,
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

/**
 * Which sections a pick commits. The exact one when the TA chose a row; the
 * one their digits name if they hit Enter before the import landed; otherwise
 * the per-type defaults, which keeps the type-and-Enter fast path intact.
 */
function pickedSectionIds(sections: EnrollableSection[], pick: CoursePick): Id<"sections">[] {
  if (pick.sectionId && sections.some((s) => s._id === pick.sectionId)) return [pick.sectionId];
  const typed = pick.sectionNumber?.toUpperCase();
  if (typed) {
    const hit = sections.find((s) => s.sectionNumber.toUpperCase().startsWith(typed));
    if (hit) return [hit._id];
  }
  return defaultSectionIds(sections);
}

export interface ContactDetails {
  preferredName: string;
  phone: string;
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
  /**
   * The "About you" block. Optional as a set: the reference has no welcome
   * step, so onboarding collects these two here, while the Preferences page
   * reuses this component *without* them — it edits the same fields on its own
   * "Your details" tab and must not show them twice.
   */
  details?: ContactDetails;
  onDetailsChange?: (next: ContactDetails) => void;
  /** Placeholder for the preferred-name field. */
  firstName?: string;
}

export function Step1Courses({
  value,
  onChange,
  onSearch,
  onImportCourse,
  details,
  onDetailsChange,
  firstName,
}: Step1CoursesProps) {
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [highlightSectionId, setHighlightSectionId] = useState<Id<"sections"> | null>(null);
  /* The imported course behind the ghost; which of its sections shows is
     decided below, from whichever section row is highlighted. */
  const [ghostSource, setGhostSource] = useState<{
    courseId: string;
    sections: EnrollableSection[];
  } | null>(null);
  const [committing, setCommitting] = useState<string | null>(null);
  const [importFailed, setImportFailed] = useState(false);
  /* Bumped whenever an import lands or fails, so metaFor / sectionsFor
     re-read the cache. */
  const [cacheTick, setCacheTick] = useState(0);

  /* Imports are cached server-side too, but keeping them here means the common
     "hover then click" path commits without a second round trip. */
  const cacheRef = useRef(new Map<string, Imported>());
  const failedRef = useRef(new Set<string>());
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

  const addCourse = useCallback((imported: Imported, pick: CoursePick) => {
    const current = valueRef.current;
    const next: EnrolledCourse = {
      courseId: pick.courseId,
      courseName: imported.courseName || pick.courseId,
      sections: imported.sections,
      selectedSectionIds: pickedSectionIds(imported.sections, pick),
    };
    const index = current.courses.findIndex((c) => c.courseId === pick.courseId);
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
      setGhostSource(null);
      return;
    }
    const cached = cacheRef.current.get(highlightId);
    if (cached) {
      seqRef.current++;
      setGhostSource({ courseId: highlightId, sections: cached.sections });
      return;
    }
    const mine = ++seqRef.current;
    const timer = window.setTimeout(() => {
      importRef.current(highlightId).then(
        (res) => {
          cacheRef.current.set(highlightId, res);
          failedRef.current.delete(highlightId);
          setCacheTick((t) => t + 1);
          if (seqRef.current !== mine) return;
          setImportFailed(false);
          setGhostSource({ courseId: highlightId, sections: res.sections });
        },
        () => {
          failedRef.current.add(highlightId);
          setCacheTick((t) => t + 1);
          if (seqRef.current !== mine) return;
          setGhostSource(null);
          setImportFailed(true);
        },
      );
    }, HIGHLIGHT_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [highlightId]);

  const handleHighlight = useCallback((hit: CourseHighlight | null) => {
    setHighlightId(hit?.courseId ?? null);
    setHighlightSectionId(hit?.sectionId ?? null);
  }, []);

  const handleSelect = useCallback(
    (pick: CoursePick) => {
      seqRef.current++;
      setGhostSource(null);
      const cached = cacheRef.current.get(pick.courseId);
      if (cached) {
        setImportFailed(false);
        addCourse(cached, pick);
        return;
      }
      setCommitting(pick.courseId);
      importRef.current(pick.courseId).then(
        (res) => {
          cacheRef.current.set(pick.courseId, res);
          failedRef.current.delete(pick.courseId);
          setCacheTick((t) => t + 1);
          setCommitting((c) => (c === pick.courseId ? null : c));
          setImportFailed(false);
          addCourse(res, pick);
        },
        () => {
          failedRef.current.add(pick.courseId);
          setCacheTick((t) => t + 1);
          setCommitting((c) => (c === pick.courseId ? null : c));
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

  /* Feeds the section half of the dropdown: ready once the import lands. */
  const sectionsFor = useCallback(
    (courseId: string): SectionLookup => {
      void cacheTick;
      const cached = cacheRef.current.get(courseId);
      if (cached) return { status: "ready", sections: cached.sections };
      if (failedRef.current.has(courseId)) return { status: "error" };
      return { status: "loading" };
    },
    [cacheTick],
  );

  const chips = useMemo(
    () => value.courses.map((c) => ({ courseId: c.courseId, label: chipLabel(c) })),
    [value.courses],
  );

  /* Ghost exactly the highlighted section — a one-section course is all
     previewMeetings needs to preview one section. */
  const ghost = useMemo(() => {
    if (!ghostSource) return null;
    if (!highlightSectionId) return ghostSource;
    const hit = ghostSource.sections.find((s) => s._id === highlightSectionId);
    return hit ? { courseId: ghostSource.courseId, sections: [hit] } : ghostSource;
  }, [ghostSource, highlightSectionId]);

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
            chips={chips}
            onRemoveChip={handleRemove}
            onSearch={onSearch}
            onSelect={handleSelect}
            onHighlight={handleHighlight}
            sectionsFor={sectionsFor}
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

        {/* The two contact fields fill the gap the reference leaves above the
            hint, so onboarding still collects them without a fourth step. When
            they are absent the column keeps its original low-actions spacer. */}
        {details && onDetailsChange ? (
          <div className="flex min-w-0 flex-col gap-3">
            <h3 className="text-[13px] font-semibold leading-none text-ink">About you</h3>

            <div className="flex min-w-0 flex-col gap-1.5">
              <Label htmlFor="onboarding-preferred-name" className="mb-0">
                Preferred name
              </Label>
              <Input
                id="onboarding-preferred-name"
                className="max-w-72"
                autoComplete="given-name"
                placeholder={firstName || undefined}
                value={details.preferredName}
                onChange={(e) =>
                  onDetailsChange({ ...details, preferredName: e.target.value })
                }
              />
            </div>

            <div className="flex min-w-0 flex-col gap-1.5">
              <Label htmlFor="onboarding-phone" className="mb-0">
                Phone number <span className="font-normal text-faint">Optional</span>
              </Label>
              <Input
                id="onboarding-phone"
                className="max-w-72 font-mono"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                value={details.phone}
                onChange={(e) => onDetailsChange({ ...details, phone: e.target.value })}
              />
              <p className="text-[12px] text-faint [text-wrap:pretty]">
                For exam-day reminders. Only your coordinator sees it.
              </p>
            </div>
          </div>
        ) : (
          /* The actions sit low in the column — an onboarding-only treatment. */
          <div className="h-10 lg:h-[180px]" aria-hidden />
        )}

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
