import { useCallback, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAction, useMutation, useQuery } from "convex/react";
import { CalendarDays } from "lucide-react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { EmptyState, FullPageSpinner, PageHeader, toast } from "../../../components/ui";
import { errorMessage } from "../../../lib/errorMessage";
import type { DayCode } from "../../../lib/format";
import { usePeriod } from "../../../lib/period";
import type { AvailabilityData } from "../availability/model";
import { WizardChrome } from "./WizardChrome";
import { Step1Courses } from "./Step1Courses";
import { Step2Availability } from "./Step2Availability";
import { Step3Preferences } from "./Step3Preferences";
import {
  emptyWizardState,
  syncAsyncFromDuties,
  WIZARD_STEPS,
  type ClassesValue,
  type EnrollableSection,
  type WizardState,
} from "./model";

const CONVEX_ID_RE = /^[a-z0-9]{20,}$/;

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
  const saveProfile = useMutation(api.ta.saveProfile);
  const saveAvailability = useMutation(api.ta.saveAvailability);
  const addDateException = useMutation(api.ta.addDateException);
  const removeDateException = useMutation(api.ta.removeDateException);
  const completeOnboarding = useMutation(api.ta.completeOnboarding);

  const [stepIndex, setStepIndex] = useState(0);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [state, setState] = useState<WizardState>(emptyWizardState);
  const [hydrated, setHydrated] = useState(false);

  const term = info?.period.term ?? "";

  // Seed from whatever is already saved, exactly once.
  if (!hydrated && profile !== undefined) {
    setHydrated(true);
    if (profile) {
      setState((prev) => ({
        classes: prev.classes,
        preferences: {
          maxHoursPerWeek: profile.maxHoursPerWeek,
          dutyTypePrefs: profile.dutyTypePrefs,
          sectionPrefs: profile.sectionPrefs,
        },
      }));
    }
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

  /** Staffed sections TAs can see: the ones the period's shifts reference. */
  const sectionOptions = useMemo(() => {
    const map = new Map<
      string,
      {
        _id: Id<"sections">;
        sectionNumber: string;
        meetings: Array<{ day: DayCode; startMin: number; endMin: number }>;
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
      if (existing) existing.meetings.push(...meeting);
      else
        map.set(key, {
          _id: s.sectionRef,
          sectionNumber: (s.description ?? "").replace(/\D+/g, "") || "Section",
          meetings: meeting,
        });
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
        syncAsyncPreference: syncAsyncFromDuties(
          next.preferences.dutyTypePrefs,
          dutyTypes ?? [],
        ),
        dutyTypePrefs: next.preferences.dutyTypePrefs,
        sectionPrefs: next.preferences.sectionPrefs,
        manualClassMeetings,
      });
      setSavedAt(Date.now());
    },
    [periodId, saveProfile, dutyTypes],
  );

  /**
   * Nothing gates Continue, so every step saves what it has on the way out and
   * the last one hands off to the live app — the reference has no completion
   * screen; submitting availability there is the real finish.
   */
  const onContinue = useCallback(() => {
    setSaving(true);
    void (async () => {
      try {
        await persistProfile(state);
        if (stepIndex < WIZARD_STEPS.length - 1) {
          setStepIndex((i) => i + 1);
        } else {
          if (profile) await completeOnboarding({ taProfileRef: profile._id });
          toast("Setup saved");
          navigate("/ta/availability");
        }
      } catch (e) {
        toast(errorMessage(e), { tone: "error" });
      } finally {
        setSaving(false);
      }
    })();
  }, [persistProfile, state, stepIndex, profile, completeOnboarding, navigate]);

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

  const setClasses = (classes: ClassesValue) => setState((s) => ({ ...s, classes }));
  const identity = me ? `${me.preferredName || me.name} · ${me.email}` : undefined;
  const savedAgoLabel =
    savedAt === null ? "not saved yet" : `saved ${describeAgo(savedAt)}`;

  return (
    <WizardChrome
      stepIndex={stepIndex}
      saving={saving}
      identity={identity}
      onContinue={onContinue}
    >
      {stepIndex === 0 && (
        <Step1Courses
          value={state.classes}
          onChange={setClasses}
          onSearch={(query: string) => searchCourses({ query, term })}
          onImportCourse={async (courseId: string) => {
            const r = await importForEnrollment({ courseId, term });
            return {
              courseName: r.courseName,
              sections: r.sections as EnrollableSection[],
            };
          }}
        />
      )}
      {stepIndex === 1 &&
        (availabilityData && profile ? (
          <Step2Availability
            data={availabilityData}
            classes={state.classes}
            onClassesChange={setClasses}
            savedAgoLabel={savedAgoLabel}
            onSave={async (blocks, submitted) => {
              await saveAvailability({
                taProfileRef: profile._id,
                blocks,
                submitted: submitted || undefined,
              });
              setSavedAt(Date.now());
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
      {stepIndex === 2 && (
        <Step3Preferences
          value={state.preferences}
          onChange={(preferences) => setState((s) => ({ ...s, preferences }))}
          dutyTypes={dutyTypes ?? []}
          sections={sectionOptions}
          classes={state.classes}
        />
      )}
    </WizardChrome>
  );
}

function describeAgo(at: number): string {
  const mins = Math.floor((Date.now() - at) / 60000);
  if (mins < 1) return "just now";
  return `${mins} min ago`;
}
