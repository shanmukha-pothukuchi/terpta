/* Step 2 — "Your classes". Pure presentation over ClassesValue: the parent
   owns persistence and supplies onSearch / onImportCourse, so the same
   component doubles as the Classes section on the Preferences page. */
import { useCallback, useState } from "react";
import { BookOpen, Pencil, Trash2, TriangleAlert } from "lucide-react";
import type { Id } from "../../../../convex/_generated/dataModel";
import { Button, EmptyState, Spinner, Surface, Tooltip } from "../../../components/ui";
import { formatMeeting } from "../../../lib/format";
import { CourseSearch, type CourseSearchResult } from "./CourseSearch";
import { ManualClassEntry } from "./ManualClassEntry";
import { MiniWeekGrid } from "./MiniWeekGrid";
import { SectionPicker } from "./SectionPicker";
import {
  lockedMeetings,
  type ClassesValue,
  type EnrollableSection,
  type EnrolledCourse,
} from "./model";

interface PickerState {
  courseId: string;
  courseName: string;
  sections: EnrollableSection[];
  initialSelectedIds?: Id<"sections">[];
  /** true when re-opening an already-added course. */
  editing: boolean;
}

/** "0101 M 10:00a–10:50a · 0201 Tu 9:00a–9:50a" for a course card. */
function courseSummary(course: EnrolledCourse): string {
  const chosen = course.sections.filter((s) => course.selectedSectionIds.includes(s._id));
  if (chosen.length === 0) return "No sections selected";
  return chosen
    .map((s) =>
      [s.sectionNumber, ...s.meetings.map((m) => formatMeeting(m.day, m.startMin, m.endMin))].join(
        " ",
      ),
    )
    .join(" · ");
}

export interface Step2ClassesProps {
  value: ClassesValue;
  onChange: (next: ClassesValue) => void;
  /** Debounced course autocomplete. Returns [] when the query is too short. */
  onSearch: (query: string) => Promise<Array<{ courseId: string; name: string }>>;
  /** Imports a course and returns its sections. Rejects if umd.io is down. */
  onImportCourse: (
    courseId: string,
  ) => Promise<{ courseName: string; sections: EnrollableSection[] }>;
  /** Hides the "This is all my classes" checkbox when used on the Preferences page. */
  hideCompletionCheck?: boolean;
}

export function Step2Classes({
  value,
  onChange,
  onSearch,
  onImportCourse,
  hideCompletionCheck,
}: Step2ClassesProps) {
  const [picker, setPicker] = useState<PickerState | null>(null);
  const [importing, setImporting] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [manualOpen, setManualOpen] = useState(false);

  const meetings = lockedMeetings(value);

  const handleSelect = useCallback(
    (hit: CourseSearchResult) => {
      const existing = value.courses.find((c) => c.courseId === hit.courseId);
      setImportError(null);
      setPicker(null);
      setImporting(hit.courseId);
      onImportCourse(hit.courseId).then(
        (res) => {
          setImporting(null);
          setPicker({
            courseId: hit.courseId,
            courseName: res.courseName || hit.name,
            sections: res.sections,
            initialSelectedIds: existing?.selectedSectionIds,
            editing: Boolean(existing),
          });
        },
        () => {
          setImporting(null);
          setImportError(hit.courseId);
          setManualOpen(true);
        },
      );
    },
    [onImportCourse, value.courses],
  );

  function commitPicker(selectedSectionIds: Id<"sections">[]) {
    if (!picker) return;
    const next: EnrolledCourse = {
      courseId: picker.courseId,
      courseName: picker.courseName,
      sections: picker.sections,
      selectedSectionIds,
    };
    const index = value.courses.findIndex((c) => c.courseId === picker.courseId);
    onChange({
      ...value,
      courses:
        index >= 0
          ? value.courses.map((c, i) => (i === index ? next : c))
          : [...value.courses, next],
    });
    setPicker(null);
  }

  function editCourse(course: EnrolledCourse) {
    setImportError(null);
    setPicker({
      courseId: course.courseId,
      courseName: course.courseName,
      sections: course.sections,
      initialSelectedIds: course.selectedSectionIds,
      editing: true,
    });
  }

  function removeCourse(courseId: string) {
    if (picker?.courseId === courseId) setPicker(null);
    onChange({ ...value, courses: value.courses.filter((c) => c.courseId !== courseId) });
  }

  const showEmpty =
    value.courses.length === 0 && value.manual.length === 0 && !picker && !importing;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-ink">
          Which courses are you taking this semester?
        </h2>
        <p className="mt-0.5 text-[12.5px] text-muted">
          {"We lock these times on your availability grid so nobody schedules you during class."}
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        {/* Left — search, picker, added courses, manual entry */}
        <div className="flex min-w-0 flex-col gap-3">
          <CourseSearch onSearch={onSearch} onSelect={handleSelect} disabled={Boolean(importing)} />

          {importError ? (
            <div
              role="alert"
              className="flex items-start gap-2.5 rounded-[10px] border border-[rgba(226,24,51,0.30)] bg-[rgba(226,24,51,0.10)] px-3 py-2.5 text-[12.5px] leading-[1.45] text-[#F4A3AE]"
            >
              <TriangleAlert
                size={16}
                strokeWidth={1.5}
                className="mt-px shrink-0 text-umd"
                aria-hidden
              />
              <span>{"Couldn’t reach UMD’s schedule of classes — add times manually"}</span>
            </div>
          ) : null}

          {importing ? (
            <Surface className="px-3.5">
              <Spinner label={`Importing ${importing}…`} />
            </Surface>
          ) : null}

          {picker ? (
            <SectionPicker
              courseId={picker.courseId}
              courseName={picker.courseName}
              sections={picker.sections}
              initialSelectedIds={picker.initialSelectedIds}
              submitLabel={picker.editing ? "Save changes" : "Add course"}
              onCommit={commitPicker}
              onCancel={() => setPicker(null)}
            />
          ) : null}

          {value.courses.length > 0 ? (
            <div className="flex flex-col gap-2">
              {value.courses.map((course) => (
                <Surface key={course.courseId} className="flex items-center gap-3 px-3.5 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="shrink-0 font-mono text-[12.5px] font-medium text-ink">
                        {course.courseId}
                      </span>
                      <span className="min-w-0 truncate text-[12.5px] text-muted">
                        {course.courseName}
                      </span>
                    </div>
                    <div className="mt-0.5 truncate font-mono text-[11.5px] text-muted">
                      {courseSummary(course)}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-0.5">
                    <Tooltip label="Edit sections">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="px-1.5"
                        aria-label={`Edit ${course.courseId}`}
                        onClick={() => editCourse(course)}
                      >
                        <Pencil size={14} strokeWidth={1.5} aria-hidden />
                      </Button>
                    </Tooltip>
                    <Tooltip label="Remove">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="px-1.5"
                        aria-label={`Remove ${course.courseId}`}
                        onClick={() => removeCourse(course.courseId)}
                      >
                        <Trash2 size={14} strokeWidth={1.5} aria-hidden />
                      </Button>
                    </Tooltip>
                  </div>
                </Surface>
              ))}
            </div>
          ) : null}

          {showEmpty ? (
            <EmptyState
              icon={BookOpen}
              title="No classes added yet."
              hint="Search for a course above to pull in its section times, or add one by hand."
            />
          ) : null}

          <ManualClassEntry
            value={value.manual}
            forceOpen={manualOpen}
            onChange={(manual) => onChange({ ...value, manual })}
          />

          {!hideCompletionCheck ? (
            <label className="flex h-11 cursor-pointer items-center gap-3 rounded-[10px] border border-line bg-surface px-3.5 text-[12.5px] hover:bg-[rgba(255,255,255,0.02)]">
              <input
                type="checkbox"
                checked={value.confirmedComplete}
                onChange={(e) => onChange({ ...value, confirmedComplete: e.target.checked })}
                className="size-3.5 shrink-0 cursor-pointer accent-umd"
              />
              <span className="truncate">This is all my classes</span>
            </label>
          ) : null}
        </div>

        {/* Right — week preview */}
        <div className="min-w-0 lg:sticky lg:top-4 lg:self-start">
          <div className="mb-2 flex items-center gap-2">
            <span className="text-[12px] font-medium text-muted">Your week</span>
            <span className="font-mono text-[11.5px] text-faint">{meetings.length}</span>
          </div>
          <MiniWeekGrid meetings={meetings} />
        </div>
      </div>
    </div>
  );
}
