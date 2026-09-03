/**
 * TA → Preferences.
 *
 * The standing (post-wizard) editor for the two things a TA changes after
 * onboarding: the classes that lock their availability grid, and how they'd
 * like to be scheduled. Both tabs reuse the wizard's step components, so the
 * wizard and this page can never drift apart.
 *
 * Renders inside AppShell's <Outlet/>, so this is page content only.
 */
import { useMemo, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import {
  CalendarDays,
  SlidersHorizontal,
  TriangleAlert,
  UserRound,
  UserRoundPlus,
} from "lucide-react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { usePeriod } from "../../lib/period";
import { errorMessage } from "../../lib/errorMessage";
import type { DayCode } from "../../lib/format";
import {
  Button,
  Card,
  EmptyState,
  Input,
  Label,
  PageHeader,
  SegmentedControl,
  Spinner,
  toast,
} from "../../components/ui";
import { Step3Preferences } from "./onboarding/Step3Preferences";
import { Step1Courses } from "./onboarding/Step1Courses";
import {
  DEFAULT_HOURS,
  syncAsyncFromDuties,
  type ClassesValue,
  type EnrollableSection,
  type PreferencesValue,
  type SchedulableSection,
} from "./onboarding/model";

type TabKey = "classes" | "preferences" | "details";

const TABS = [
  { value: "classes" as const, label: "Classes", icon: CalendarDays },
  { value: "preferences" as const, label: "Preferences", icon: SlidersHorizontal },
  { value: "details" as const, label: "Your details", icon: UserRound },
];

const PAGE_DESCRIPTION = "Update your classes and how you'd like to be scheduled.";

/* ------------------------------------------------------------------ */
/* Editor — mounted only once every query has resolved                 */
/* ------------------------------------------------------------------ */

interface EditorProps {
  periodRef: Id<"staffingPeriods">;
  term: string;
  profile: {
    maxHoursPerWeek: number;
    officeHoursStyle?: "few_long" | "many_short";
    syncAsyncPreference: number;
    enrolledSectionRefs: Id<"sections">[];
    dutyTypePrefs: Id<"dutyTypes">[];
    sectionPrefs: Id<"sections">[];
    manualClassMeetings?: Array<{ day: DayCode; startMin: number; endMin: number; room: string }>;
  };
  dutyTypes: Array<{
    _id: Id<"dutyTypes">;
    name: string;
    mode: "sync" | "async" | "window";
    color: string;
  }>;
  sections: SchedulableSection[];
}

function PreferencesEditor({ periodRef, term, profile, dutyTypes, sections }: EditorProps) {
  const [tab, setTab] = useState<TabKey>("classes");
  const [saving, setSaving] = useState(false);

  const saveProfile = useMutation(api.ta.saveProfile);
  const searchCourses = useAction(api.umd.searchCourses);
  const importForEnrollment = useAction(api.umd.importForEnrollment);

  const [prefs, setPrefs] = useState<PreferencesValue>(() => ({
    maxHoursPerWeek: profile.maxHoursPerWeek || DEFAULT_HOURS,
    officeHoursStyle: profile.officeHoursStyle ?? "few_long",
    syncAsyncPreference: profile.syncAsyncPreference,
    dutyTypePrefs: profile.dutyTypePrefs,
    sectionPrefs: profile.sectionPrefs,
    noSectionPreference: false,
  }));

  const enrolled = useQuery(api.ta.getEnrolledClasses, { periodRef });
  const [classes, setClasses] = useState<ClassesValue>(() => ({
    courses: [],
    manual: (profile.manualClassMeetings ?? []).map((m, i) => ({
      key: `manual-${i}`,
      label: m.room || "Class",
      day: m.day,
      startMin: m.startMin,
      endMin: m.endMin,
    })),
    confirmedComplete: true,
  }));

  // Seed the picker from the saved enrolment once the join query lands, so
  // editing this tab never silently drops courses the TA already added.
  const [classesHydrated, setClassesHydrated] = useState(false);
  if (!classesHydrated && enrolled !== undefined) {
    setClassesHydrated(true);
    setClasses((prev) => ({ ...prev, courses: enrolled }));
  }

  const enrolledFromClasses = useMemo<Id<"sections">[]>(
    () => classes.courses.flatMap((c) => c.selectedSectionIds),
    [classes],
  );

  const save = async () => {
    setSaving(true);
    try {
      await saveProfile({
        periodRef,
        maxHoursPerWeek: prefs.maxHoursPerWeek,
        // The reference drops the sync/async control, so the axis the solver
        // needs is derived from which duty types they picked.
        syncAsyncPreference: syncAsyncFromDuties(prefs.dutyTypePrefs, dutyTypes),
        enrolledSectionRefs: enrolledFromClasses,
        dutyTypePrefs: prefs.dutyTypePrefs,
        sectionPrefs: prefs.sectionPrefs,
        officeHoursStyle: prefs.officeHoursStyle,
        // The label rides along in `room` so it survives a reload.
        manualClassMeetings: classes.manual.map((m) => ({
          day: m.day,
          startMin: m.startMin,
          endMin: m.endMin,
          room: m.label,
        })),
      });
      toast("Preferences saved");
    } catch (e) {
      toast(errorMessage(e), { tone: "error" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Preferences"
        description={PAGE_DESCRIPTION}
        actions={
          tab === "details" ? undefined : (
            <Button variant="primary" loading={saving} onClick={() => void save()}>
              Save changes
            </Button>
          )
        }
      />

      <SegmentedControl<TabKey>
        options={TABS}
        value={tab}
        onChange={setTab}
        className="mb-4"
      />

      {tab === "classes" ? (
        <div className="flex flex-col gap-4">
          <div className="flex gap-2.5 rounded-[9px] border border-[rgba(245,165,36,0.30)] bg-[rgba(245,165,36,0.08)] px-3 py-2.5">
            <TriangleAlert
              size={16}
              strokeWidth={1.5}
              className="mt-0.5 shrink-0 text-warn"
              aria-hidden
            />
            <p className="min-w-0 text-[12.5px] text-warn-text">
              Changing your classes regenerates the locked class blocks on your availability
              grid.
            </p>
          </div>

          <Step1Courses
            embedded
            value={classes}
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
        </div>
      ) : tab === "preferences" ? (
        <Step3Preferences
          layout="page"
          value={prefs}
          onChange={setPrefs}
          dutyTypes={dutyTypes}
          sections={sections}
          classes={classes}
        />
      ) : (
        <YourDetails />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Wired page                                                          */
/* ------------------------------------------------------------------ */

export default function TaPreferences() {
  const period = usePeriod();
  const periodId = period.periodId;

  const info = useQuery(api.periods.get, periodId ? { periodRef: periodId } : "skip");
  const profile = useQuery(api.ta.getProfile, periodId ? { periodRef: periodId } : "skip");
  const hasProfile = profile !== undefined && profile !== null;
  const dutyTypes = useQuery(
    api.dutyTypes.list,
    hasProfile && periodId ? { periodRef: periodId } : "skip",
  );
  const shifts = useQuery(
    api.shifts.list,
    hasProfile && periodId ? { periodRef: periodId } : "skip",
  );

  /**
   * There is no TA-readable sections query (periods.listSections is
   * coordinator-only), so the staffed course's discussion sections are
   * recovered from the period's section-backed shifts.
   */
  const sections = useMemo<SchedulableSection[]>(() => {
    const map = new Map<string, SchedulableSection>();
    for (const s of shifts ?? []) {
      if (!s.sectionRef) continue;
      const key = String(s.sectionRef);
      const meeting =
        s.recurrence === "weekly" &&
        s.day !== undefined &&
        s.startMin !== undefined &&
        s.endMin !== undefined
          ? { day: s.day as DayCode, startMin: s.startMin, endMin: s.endMin }
          : null;
      const existing = map.get(key);
      if (existing) {
        if (
          meeting &&
          !existing.meetings.some(
            (m) =>
              m.day === meeting.day &&
              m.startMin === meeting.startMin &&
              m.endMin === meeting.endMin,
          )
        ) {
          existing.meetings.push(meeting);
        }
        if (!existing.instructors?.length && s.sectionInstructors?.length) {
          existing.instructors = s.sectionInstructors;
        }
      } else {
        map.set(key, {
          _id: s.sectionRef,
          sectionNumber: (s.description ?? "").replace(/\D+/g, "") || "Section",
          meetings: meeting ? [meeting] : [],
          instructors: s.sectionInstructors?.length ? s.sectionInstructors : undefined,
        });
      }
    }
    return [...map.values()].sort((a, b) => a.sectionNumber.localeCompare(b.sectionNumber));
  }, [shifts]);

  if (period.loading || (periodId && (info === undefined || profile === undefined))) {
    return (
      <div>
        <PageHeader title="Preferences" description={PAGE_DESCRIPTION} />
        <Spinner label="Loading your preferences…" />
      </div>
    );
  }

  if (!periodId || info === undefined || info === null) {
    return (
      <div>
        <PageHeader title="Preferences" description={PAGE_DESCRIPTION} />
        <EmptyState
          icon={UserRoundPlus}
          title={info === null ? "Course not found" : "No course selected"}
          hint={
            info === null
              ? "This staffing period no longer exists. Pick another course from the switcher."
              : "Ask your coordinator for an invite link to their course's staffing period."
          }
        />
      </div>
    );
  }

  if (profile === undefined || profile === null) {
    return (
      <div>
        <PageHeader title="Preferences" description={PAGE_DESCRIPTION} />
        <EmptyState
          icon={UserRoundPlus}
          title="You haven't joined this course yet"
          hint="Finish TA setup for this course before editing your preferences."
        />
      </div>
    );
  }

  if (dutyTypes === undefined || shifts === undefined) {
    return (
      <div>
        <PageHeader title="Preferences" description={PAGE_DESCRIPTION} />
        <Spinner label="Loading your preferences…" />
      </div>
    );
  }

  return (
    <PreferencesEditor
      key={profile._id}
      periodRef={periodId}
      term={info.period.term}
      profile={{
        maxHoursPerWeek: profile.maxHoursPerWeek,
        officeHoursStyle: profile.officeHoursStyle,
        syncAsyncPreference: profile.syncAsyncPreference,
        enrolledSectionRefs: profile.enrolledSectionRefs,
        dutyTypePrefs: profile.dutyTypePrefs,
        sectionPrefs: profile.sectionPrefs,
        manualClassMeetings: profile.manualClassMeetings,
      }}
      dutyTypes={dutyTypes.map((d) => ({
        _id: d._id,
        name: d.name,
        mode: d.mode,
        color: d.color,
      }))}
      sections={sections}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Your details — preferred name and phone                             */
/*                                                                     */
/* The reference onboarding has no welcome step, so the two contact     */
/* fields it used to collect are edited here instead of being lost.     */
/* ------------------------------------------------------------------ */

function YourDetails() {
  const me = useQuery(api.users.current, {});
  const updateContact = useMutation(api.users.updateContact);
  const [preferredName, setPreferredName] = useState<string | null>(null);
  const [phone, setPhone] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  if (me === undefined) return <Spinner label="Loading your details…" />;
  if (me === null) return null;

  const nameValue = preferredName ?? me.preferredName ?? me.name.split(" ")[0] ?? "";
  const phoneValue = phone ?? me.phone ?? "";

  return (
    <Card title="Your details">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="pref-name">Preferred name</Label>
          <Input
            id="pref-name"
            value={nameValue}
            onChange={(e) => setPreferredName(e.target.value)}
            className="max-w-72"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="pref-phone">
            Phone number <span className="font-normal text-faint">Optional</span>
          </Label>
          <Input
            id="pref-phone"
            value={phoneValue}
            onChange={(e) => setPhone(e.target.value)}
            className="max-w-72 font-mono"
          />
          <p className="text-[12px] text-faint">
            For exam-day reminders. Only your coordinator sees it.
          </p>
        </div>
        <div className="flex justify-end">
          <Button
            variant="primary"
            loading={saving}
            onClick={() => {
              setSaving(true);
              void updateContact({ preferredName: nameValue, phone: phoneValue })
                .then(() => toast("Details saved"))
                .catch((e) => toast(errorMessage(e), { tone: "error" }))
                .finally(() => setSaving(false));
            }}
          >
            Save details
          </Button>
        </div>
      </div>
    </Card>
  );
}
