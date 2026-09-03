import { useEffect, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { CalendarPlus, Download } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import {
  Badge,
  Button,
  Input,
  Label,
  PageHeader,
  Select,
  Spinner,
  Surface,
  toast,
  type BadgeTone,
} from "../../components/ui";
import { formatDate, formatMeeting } from "../../lib/format";

type PeriodListItem = FunctionReturnType<typeof api.periods.listMine>[number];
type SectionRow = FunctionReturnType<typeof api.periods.listSections>[number];
type ImportResult = FunctionReturnType<typeof api.umd.importCourse>;

const TERM_OPTIONS = [
  { value: "202601", label: "Spring 2026" },
  { value: "202605", label: "Summer 2026" },
  { value: "202608", label: "Fall 2026" },
  { value: "202701", label: "Spring 2027" },
];

export const PERIOD_STATUS_TONE: Record<string, BadgeTone> = {
  draft: "neutral",
  collecting: "amber",
  generated: "blue",
  published: "green",
};

export const PERIOD_STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  collecting: "Collecting",
  generated: "Generated",
  published: "Published",
};

function termLabel(term: string): string {
  const found = TERM_OPTIONS.find((t) => t.value === term);
  if (found) return found.label;
  const year = term.slice(0, 4);
  const season =
    { "01": "Spring", "05": "Summer", "08": "Fall", "12": "Winter" }[term.slice(4)] ?? term.slice(4);
  return `${season} ${year}`;
}

function errorMessage(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  const m = raw.match(/Uncaught Error:\s*([^\n]*)/);
  return (m ? m[1] : raw).trim() || "Something went wrong";
}

const SOURCE_NOTE: Record<ImportResult["source"], string> = {
  umdio: "live from umd.io",
  cache: "from the 24h umd.io cache",
  fixture: "umd.io is down — bundled fixture data",
};

const SECTION_TYPE_ORDER: SectionRow["type"][] = ["discussion", "lab", "lecture"];

const SECTION_TYPE_LABEL: Record<SectionRow["type"], string> = {
  discussion: "Discussion sections",
  lab: "Lab sections",
  lecture: "Lectures",
};

/* ------------------------------------------------------------------ */
/* Pure view — renders from props so a dev harness can feed fixtures.  */
/* ------------------------------------------------------------------ */

export interface PeriodSetupViewProps {
  /** undefined = loading */
  periods: PeriodListItem[] | undefined;
  course: string;
  onCourseChange: (v: string) => void;
  term: string;
  onTermChange: (v: string) => void;
  importing: boolean;
  onImport: () => void;
  importResult: ImportResult | null;
  /** undefined = loading (after an import); ignored before any import */
  sections: SectionRow[] | undefined;
  selected: ReadonlySet<string>;
  onToggleSection: (id: string) => void;
  deadline: string;
  onDeadlineChange: (v: string) => void;
  creating: boolean;
  onCreate: () => void;
}

export function PeriodSetupView({
  periods,
  course,
  onCourseChange,
  term,
  onTermChange,
  importing,
  onImport,
  importResult,
  sections,
  selected,
  onToggleSection,
  deadline,
  onDeadlineChange,
  creating,
  onCreate,
}: PeriodSetupViewProps) {
  const imported = importResult !== null;
  const canCreate = imported && deadline.length > 0 && !creating;

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Period setup"
        description="Create a staffing period for a course and term, import its sections, and open availability collection."
      />

      {/* Existing periods ------------------------------------------------ */}
      {periods === undefined ? (
        <Spinner label="Loading periods…" />
      ) : periods.length > 0 ? (
        <Surface className="mb-5 overflow-hidden">
          <div className="flex h-10 items-center gap-2.5 border-b border-line px-3.5">
            <span className="text-[13px] font-medium text-ink">Your staffing periods</span>
            <span className="text-[12px] text-faint">{periods.length}</span>
          </div>
          {periods.map(({ period, course: c }) => (
            <div
              key={period._id}
              className="flex h-11 items-center gap-3 border-b border-[rgba(255,255,255,0.04)] px-3.5 text-[12.5px] last:border-b-0 hover:bg-[rgba(255,255,255,0.02)]"
            >
              <span className="font-mono font-medium">{c?.courseId ?? "?"}</span>
              <span className="max-w-56 truncate text-muted">{c?.name}</span>
              <span className="text-[#C9C9CF]">{termLabel(period.term)}</span>
              <span className="flex-1" />
              <span className="font-mono text-[12px] text-muted">
                due {formatDate(period.collectionDeadline)}
              </span>
              <Badge tone={PERIOD_STATUS_TONE[period.status]}>
                {PERIOD_STATUS_LABEL[period.status]}
              </Badge>
            </div>
          ))}
        </Surface>
      ) : null}

      {/* Create form ------------------------------------------------------ */}
      <Surface className="overflow-hidden">
        <div className="flex h-10 items-center gap-2.5 border-b border-line px-3.5">
          <span className="text-[13px] font-medium text-ink">New staffing period</span>
          <span className="text-[12px] text-faint">sections come straight from Testudo via umd.io</span>
        </div>
        <div className="flex flex-col gap-4 p-4">
          <div className="flex items-end gap-3">
            <div className="w-40">
              <Label htmlFor="ps-course">Course</Label>
              <Input
                id="ps-course"
                value={course}
                onChange={(e) => onCourseChange(e.target.value.toUpperCase())}
                placeholder="CMSC132"
                className="font-mono"
                spellCheck={false}
              />
            </div>
            <div className="w-40">
              <Label htmlFor="ps-term">Term</Label>
              <Select id="ps-term" value={term} onChange={(e) => onTermChange(e.target.value)}>
                {TERM_OPTIONS.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </Select>
            </div>
            <Button
              onClick={onImport}
              loading={importing}
              disabled={course.trim().length === 0}
            >
              {!importing && <Download size={14} strokeWidth={1.5} aria-hidden />}
              Import sections
            </Button>
            {importResult ? (
              <span className="pb-2 text-[12px] text-faint">
                {importResult.sectionsImported} sections · {SOURCE_NOTE[importResult.source]}
              </span>
            ) : null}
          </div>

          {/* Imported sections */}
          {imported ? (
            sections === undefined ? (
              <Spinner label="Loading sections…" />
            ) : sections.length === 0 ? (
              <p className="text-[12.5px] text-muted">
                No sections found for this course and term.
              </p>
            ) : (
              <div className="flex flex-col gap-3">
                {SECTION_TYPE_ORDER.map((type) => {
                  const rows = sections.filter((s) => s.type === type);
                  if (rows.length === 0) return null;
                  return (
                    <div key={type}>
                      <p className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.06em] text-faint">
                        {SECTION_TYPE_LABEL[type]}
                        {type === "discussion" ? (
                          <span className="ml-2 normal-case tracking-normal text-faint">
                            checked sections get a weekly Discussion shift
                          </span>
                        ) : null}
                      </p>
                      <div className="overflow-hidden rounded-[10px] border border-line">
                        {rows.map((s) => (
                          <label
                            key={s._id}
                            className="flex h-9 cursor-pointer items-center gap-3 border-b border-[rgba(255,255,255,0.04)] px-3 text-[12.5px] last:border-b-0 hover:bg-[rgba(255,255,255,0.03)]"
                          >
                            <input
                              type="checkbox"
                              checked={selected.has(s._id)}
                              onChange={() => onToggleSection(s._id)}
                              className="size-3.5 shrink-0 cursor-pointer accent-umd"
                            />
                            <span className="w-12 font-mono font-medium">{s.sectionNumber}</span>
                            <span className="truncate font-mono text-[11.5px] text-muted">
                              {s.meetings.length === 0
                                ? "no meetings"
                                : s.meetings
                                    .map((m) => formatMeeting(m.day, m.startMin, m.endMin))
                                    .join(" · ")}
                            </span>
                            <span className="flex-1" />
                            <span className="font-mono text-[11.5px] text-faint">
                              {s.meetings[0]?.room ?? ""}
                            </span>
                          </label>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )
          ) : null}

          <div className="flex items-end gap-3 border-t border-line pt-4">
            <div className="w-44">
              <Label htmlFor="ps-deadline">Availability deadline</Label>
              <Input
                id="ps-deadline"
                type="date"
                value={deadline}
                onChange={(e) => onDeadlineChange(e.target.value)}
                className="font-mono"
              />
            </div>
            <Button variant="primary" onClick={onCreate} disabled={!canCreate} loading={creating}>
              {!creating && <CalendarPlus size={14} strokeWidth={1.5} aria-hidden />}
              Create period
            </Button>
            <span className="pb-2 text-[12px] text-faint">
              Starts collecting availability immediately.
            </span>
          </div>
        </div>
      </Surface>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Wired page                                                          */
/* ------------------------------------------------------------------ */

export default function PeriodSetup() {
  const periods = useQuery(api.periods.listMine);
  const importCourse = useAction(api.umd.importCourse);
  const createPeriod = useMutation(api.periods.create);

  const [course, setCourse] = useState("");
  const [term, setTerm] = useState("202608");
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [initializedFor, setInitializedFor] = useState<Id<"courses"> | null>(null);
  const [deadline, setDeadline] = useState("");
  const [creating, setCreating] = useState(false);

  const sections = useQuery(
    api.periods.listSections,
    importResult ? { courseRef: importResult.courseRef } : "skip",
  );

  // Pre-check discussion sections once per imported course.
  useEffect(() => {
    if (!importResult || !sections) return;
    if (initializedFor === importResult.courseRef) return;
    setSelected(new Set(sections.filter((s) => s.type === "discussion").map((s) => s._id)));
    setInitializedFor(importResult.courseRef);
  }, [importResult, sections, initializedFor]);

  const onImport = async () => {
    setImporting(true);
    try {
      const result = await importCourse({ courseId: course.trim(), term });
      setImportResult(result);
      if (result.source === "fixture") {
        toast("umd.io is down — imported bundled fixture sections", { tone: "info" });
      }
    } catch (e) {
      toast(errorMessage(e), { tone: "error" });
    } finally {
      setImporting(false);
    }
  };

  const onCreate = async () => {
    if (!importResult) return;
    setCreating(true);
    try {
      await createPeriod({
        courseRef: importResult.courseRef,
        term,
        collectionDeadline: deadline,
        sectionRefs: [...selected] as Id<"sections">[],
      });
      toast("Staffing period created — collecting availability", {
        link: { label: "Invite TAs", to: "/coordinator/roster" },
      });
      setImportResult(null);
      setInitializedFor(null);
      setSelected(new Set());
      setDeadline("");
    } catch (e) {
      toast(errorMessage(e), { tone: "error" });
    } finally {
      setCreating(false);
    }
  };

  return (
    <PeriodSetupView
      periods={periods}
      course={course}
      onCourseChange={setCourse}
      term={term}
      onTermChange={setTerm}
      importing={importing}
      onImport={() => void onImport()}
      importResult={importResult}
      sections={sections}
      selected={selected}
      onToggleSection={(id) =>
        setSelected((prev) => {
          const next = new Set(prev);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        })
      }
      deadline={deadline}
      onDeadlineChange={setDeadline}
      creating={creating}
      onCreate={() => void onCreate()}
    />
  );
}
