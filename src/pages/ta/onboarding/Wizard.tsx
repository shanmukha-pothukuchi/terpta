import { useCallback, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAction, useMutation, useQuery } from "convex/react";
import { CalendarDays } from "lucide-react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { EmptyState, FullPageSpinner, PageHeader, toast } from "../../../components/ui";
import { errorMessage } from "../../../lib/errorMessage";
import { formatDate, type DayCode } from "../../../lib/format";
import { usePeriod } from "../../../lib/period";
import {
  blocksToGrid,
  buildLockedGrid,
  SLOT_MIN,
  type AvailabilityData,
} from "../availability/model";
import { WizardChrome } from "./WizardChrome";
import { Step1Basics } from "./Step1Basics";
import { Step2Classes } from "./Step2Classes";
import { Step3Availability } from "./Step3Availability";
import { Step4Preferences } from "./Step4Preferences";
import { DoneScreen } from "./DoneScreen";
import {
  emptyWizardState,
  WIZARD_STEPS,
  type ClassesValue,
  type EnrollableSection,
  type WizardState,
} from "./model";

const CONVEX_ID_RE = /^[a-z0-9]{20,}$/;

/** Percent of the paintable week marked as anything other than unavailable. */
export function markedPercent(data: AvailabilityData): number {
  const grid = blocksToGrid(data.manualBlocks);
  const locked = buildLockedGrid(data.importedBlocks);
  let paintable = 0;
  let marked = 0;
  for (let d = 0; d < grid.length; d++) {
    for (let s = 0; s < grid[d].length; s++) {
      if (locked[d][s]) continue;
      paintable++;
      if (grid[d][s] !== "unavailable") marked++;
    }
  }
  return paintable === 0 ? 0 : Math.round((marked / paintable) * 100);
}

/** Hours marked available or prefer-not, for the done screen's summary. */
function markedHours(data: AvailabilityData): number {
  const grid = blocksToGrid(data.manualBlocks);
  const locked = buildLockedGrid(data.importedBlocks);
  let slots = 0;
  for (let d = 0; d < grid.length; d++) {
    for (let s = 0; s < grid[d].length; s++) {
      if (!locked[d][s] && grid[d][s] !== "unavailable") slots++;
    }
  }
  return (slots * SLOT_MIN) / 60;
}

export default function TaOnboardingWizard() {
  const [params] = useSearchParams();
  const raw = params.get("period");
  const paramPeriod =
    raw && CONVEX_ID_RE.test(raw) ? (raw as Id<"staffingPeriods">) : null;

  const ctx = usePeriod();
  const mine = useQuery(api.periods.listMine, {});
  const fallback =
    mine === undefined
      ? null
      : (mine.find((r) => r.taProfileId !== null) ?? mine[0] ?? null);
  const periodId = paramPeriod ?? ctx.periodId ?? fallback?.period._id ?? null;

  if (mine === undefined) return <FullPageSpinner label="Loading your setup…" />;

  if (!periodId) {
    return (
      <div>
        <PageHeader title="Set up your TA profile" />
        <EmptyState
          icon={CalendarDays}
          title="No staffing period yet"
          hint="Once a coordinator invites you to a course, setup starts here."
        />
      </div>
    );
  }
  return <WizardLoader periodId={periodId} />;
}

function WizardLoader({ periodId }: { periodId: Id<"staffingPeriods"> }) {
  const navigate = useNavigate();
  const me = useQuery(api.users.current, {});
  const info = useQuery(api.periods.get, { periodRef: periodId });
  const profile = useQuery(api.ta.getProfile, { periodRef: periodId });
  const hasProfile = profile !== undefined && profile !== null;
  const dutyTypes = useQuery(
    api.dutyTypes.list,
    hasProfile ? { periodRef: periodId } : "skip",
  );
  const shifts = useQuery(api.shifts.list, hasProfile ? { periodRef: periodId } : "skip");
  const availability = useQuery(
    api.ta.getAvailability,
    hasProfile ? { taProfileRef: profile._id } : "skip",
  );

  const searchCourses = useAction(api.umd.searchCourses);
  const importForEnrollment = useAction(api.umd.importForEnrollment);
  const updateContact = useMutation(api.users.updateContact);
  const saveProfile = useMutation(api.ta.saveProfile);
  const saveAvailability = useMutation(api.ta.saveAvailability);
  const addDateException = useMutation(api.ta.addDateException);
  const removeDateException = useMutation(api.ta.removeDateException);
  const completeOnboarding = useMutation(api.ta.completeOnboarding);

  const [stepIndex, setStepIndex] = useState(0);
  const [done, setDone] = useState(false);
  const [saving, setSaving] = useState(false);
  const [state, setState] = useState<WizardState>(emptyWizardState);
  const [hydrated, setHydrated] = useState(false);

  const term = info?.period.term ?? "";

  // Seed the form from whatever is already saved, exactly once.
  if (!hydrated && me !== undefined && profile !== undefined) {
    setHydrated(true);
    setState((prev) => ({
      basics: {
        preferredName: me?.preferredName ?? me?.name.split(" ")[0] ?? "",
        phone: me?.phone ?? "",
      },
      classes: prev.classes,
      preferences: profile
        ? {
            maxHoursPerWeek: profile.maxHoursPerWeek,
            syncAsyncPreference: profile.syncAsyncPreference,
            dutyTypePrefs: profile.dutyTypePrefs,
            sectionPrefs: profile.sectionPrefs,
            noSectionPreference: profile.sectionPrefs.length === 0,
          }
        : prev.preferences,
    }));
  }

  const availabilityData: AvailabilityData | null = useMemo(() => {
    if (!availability || !info) return null;
    return {
      term: info.period.term,
      deadline: info.period.collectionDeadline,
      manualBlocks: availability.blocks
        .filter((b) => b.source === "manual")
        .map((b) => ({
          day: b.day,
          startMin: b.startMin,
          endMin: b.endMin,
          status: b.status,
        })),
      importedBlocks: availability.blocks
        .filter((b) => b.source === "imported_class")
        .map((b) => ({ day: b.day, startMin: b.startMin, endMin: b.endMin })),
      dateExceptions: availability.dateExceptions.map((x) => ({
        id: x._id,
        startDate: x.startDate,
        endDate: x.endDate,
        reason: x.reason,
      })),
      submittedAt: availability.availabilitySubmittedAt,
    };
  }, [availability, info]);

  /** Discussion sections TAs can see: the ones the period's shifts reference. */
  const sectionOptions = useMemo(() => {
    const map = new Map<
      string,
      {
        _id: Id<"sections">;
        sectionNumber: string;
        meetings: Array<{ day: DayCode; startMin: number; endMin: number }>;
        instructors?: string[];
      }
    >();
    for (const s of shifts ?? []) {
      if (!s.sectionRef) continue;
      const key = s.sectionRef as string;
      const meeting =
        s.recurrence === "weekly" &&
        s.day !== undefined &&
        s.startMin !== undefined &&
        s.endMin !== undefined
          ? [{ day: s.day as DayCode, startMin: s.startMin, endMin: s.endMin }]
          : [];
      const existing = map.get(key);
      if (existing) {
        existing.meetings.push(...meeting);
      } else {
        map.set(key, {
          _id: s.sectionRef,
          sectionNumber: (s.description ?? "").replace(/\D+/g, "") || "Section",
          meetings: meeting,
          instructors: s.sectionInstructors,
        });
      }
    }
    return [...map.values()].sort((a, b) =>
      a.sectionNumber.localeCompare(b.sectionNumber),
    );
  }, [shifts]);

  /** Persist classes + preferences. Creates the profile on the first call. */
  const persistProfile = useCallback(
    async (next: WizardState) => {
      const enrolledSectionRefs = next.classes.courses.flatMap(
        (c) => c.selectedSectionIds,
      );
      // The label rides along in `room` so it survives a reload.
      const manualClassMeetings = next.classes.manual.map((m) => ({
        day: m.day,
        startMin: m.startMin,
        endMin: m.endMin,
        room: m.label,
      }));
      await saveProfile({
        periodRef: periodId,
        maxHoursPerWeek: next.preferences.maxHoursPerWeek,
        enrolledSectionRefs,
        syncAsyncPreference: next.preferences.syncAsyncPreference,
        dutyTypePrefs: next.preferences.dutyTypePrefs,
        sectionPrefs: next.preferences.noSectionPreference
          ? []
          : next.preferences.sectionPrefs,
        manualClassMeetings,
      });
    },
    [periodId, saveProfile],
  );

  const advance = useCallback(async (work?: () => Promise<void>) => {
    setSaving(true);
    try {
      if (work) await work();
      setStepIndex((i) => Math.min(i + 1, WIZARD_STEPS.length - 1));
    } catch (e) {
      toast(errorMessage(e), { tone: "error" });
    } finally {
      setSaving(false);
    }
  }, []);

  const finish = useCallback(async () => {
    setSaving(true);
    try {
      await persistProfile(state);
      if (profile) await completeOnboarding({ taProfileRef: profile._id });
      setDone(true);
      toast("Setup saved", { tone: "success" });
    } catch (e) {
      toast(errorMessage(e), { tone: "error" });
    } finally {
      setSaving(false);
    }
  }, [persistProfile, state, profile, completeOnboarding]);

  if (me === undefined || info === undefined || profile === undefined) {
    return <FullPageSpinner label="Loading your setup…" />;
  }

  if (info === null) {
    return (
      <div>
        <PageHeader title="Set up your TA profile" />
        <EmptyState
          icon={CalendarDays}
          title="This staffing period is no longer available"
          hint="Ask your coordinator to re-send your invitation."
        />
      </div>
    );
  }

  if (done) {
    return (
      <DoneScreen
        publishDateLabel={formatDate(info.period.collectionDeadline)}
        coursesAdded={state.classes.courses.length + state.classes.manual.length}
        hoursMarked={availabilityData ? markedHours(availabilityData) : 0}
        maxHoursPerWeek={state.preferences.maxHoursPerWeek}
        topPreferences={state.preferences.dutyTypePrefs
          .map((id) => dutyTypes?.find((d) => d._id === id)?.name)
          .filter((n): n is string => Boolean(n))
          .slice(0, 3)}
        onGoToSchedule={() => navigate("/ta/schedule")}
        onEditAvailability={() => navigate("/ta/availability")}
      />
    );
  }

  const setClasses = (classes: ClassesValue) => setState((s) => ({ ...s, classes }));
  const percent = availabilityData ? markedPercent(availabilityData) : 0;

  return (
    <WizardChrome
      stepIndex={stepIndex}
      saving={saving}
      onBack={stepIndex > 0 ? () => setStepIndex((i) => i - 1) : undefined}
      onContinue={() => {
        if (stepIndex === 0) {
          void advance(async () => {
            await updateContact({
              preferredName: state.basics.preferredName,
              phone: state.basics.phone,
            });
          });
        } else if (stepIndex === 1) {
          void advance(() => persistProfile(state));
        } else if (stepIndex === 2) {
          void advance();
        } else {
          void finish();
        }
      }}
      continueLabel={stepIndex === WIZARD_STEPS.length - 1 ? "Finish" : "Continue"}
      continueDisabled={
        (stepIndex === 1 && !state.classes.confirmedComplete) ||
        (stepIndex === 2 && percent === 0)
      }
      continueHint={
        stepIndex === 1
          ? "Confirm you have added all your classes"
          : stepIndex === 2
            ? "Paint at least some availability first"
            : undefined
      }
      onSkip={
        stepIndex === 1
          ? () => setStepIndex(2)
          : stepIndex === 3
            ? () => void finish()
            : undefined
      }
    >
      {stepIndex === 0 && (
        <Step1Basics
          value={state.basics}
          onChange={(basics) => setState((s) => ({ ...s, basics }))}
          firstName={state.basics.preferredName || me?.name.split(" ")[0] || "there"}
          courseLabel={
            info.course ? `${info.course.courseId} · ${info.period.term}` : "Your course"
          }
        />
      )}
      {stepIndex === 1 && (
        <Step2Classes
          value={state.classes}
          onChange={setClasses}
          onSearch={(query) => searchCourses({ query, term })}
          onImportCourse={async (courseId) => {
            const r = await importForEnrollment({ courseId, term });
            return {
              courseName: r.courseName,
              sections: r.sections as EnrollableSection[],
            };
          }}
        />
      )}
      {stepIndex === 2 &&
        (availabilityData && profile ? (
          <Step3Availability
            data={availabilityData}
            markedPercent={percent}
            showFirstVisitHint
            onSave={async (blocks, submitted) => {
              await saveAvailability({
                taProfileRef: profile._id,
                blocks,
                submitted: submitted || undefined,
              });
            }}
            onAddException={async (x) => {
              await addDateException({ taProfileRef: profile._id, ...x });
            }}
            onRemoveException={async (id) => {
              await removeDateException({
                dateExceptionRef: id as Id<"dateExceptions">,
              });
            }}
          />
        ) : (
          <FullPageSpinner label="Preparing your grid…" />
        ))}
      {stepIndex === 3 && (
        <Step4Preferences
          value={state.preferences}
          onChange={(preferences) => setState((s) => ({ ...s, preferences }))}
          dutyTypes={dutyTypes ?? []}
          sections={sectionOptions}
        />
      )}
    </WizardChrome>
  );
}
