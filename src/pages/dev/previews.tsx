/**
 * DEV-only preview harness — renders every major screen with fixture data and
 * no auth/Convex requirement, so the design can be reviewed in a browser.
 *
 * Routes (registered in router.tsx only when import.meta.env.DEV):
 *   /dev/preview                 — index of all previews
 *   /dev/preview/login           — sign-in card (?state=loading | ?state=error)
 *   /dev/preview/shell           — app shell + command palette open
 *   /dev/preview/availability    — TA availability editor (desktop fixture)
 *   /dev/preview/builder         — coordinator builder, default view
 *   /dev/preview/builder-drawer  — builder with Daniel's TA drawer open
 *   /dev/preview/builder-publish — builder with the publish modal open
 *   /dev/preview/roster          — coordinator roster
 *   /dev/preview/shifts          — coordinator shifts
 *   /dev/preview/hours-approval  — coordinator hours approval queue
 *   /dev/preview/schedule        — TA published schedule
 *   /dev/preview/ta-hours        — TA hour logging week view
 */
import { useState, type ReactNode } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { Toaster } from "../../components/ui";
import { AppShellView } from "../../components/AppShell";
import { CommandPaletteView } from "../../components/CommandPalette";
import { StaticPeriodProvider } from "../../lib/period";
import { LoginScreen } from "../Login";
import { AvailabilityEditor } from "../ta/availability/AvailabilityEditor";
import { availabilityFixture } from "../ta/availability/model";
import { BuilderScreen } from "../coordinator/Builder";
import { RosterView } from "../coordinator/Roster";
import { ShiftsView } from "../coordinator/Shifts";
import {
  HoursView as CoordinatorHoursView,
  type HoursFilters,
} from "../coordinator/Hours";
import { ScheduleView } from "../ta/Schedule";
import { HoursView as TaHoursView } from "../ta/Hours";
import { WizardChrome } from "../ta/onboarding/WizardChrome";
import { Step1Courses } from "../ta/onboarding/Step1Courses";
import { Step2Availability } from "../ta/onboarding/Step2Availability";
import { Step3Preferences } from "../ta/onboarding/Step3Preferences";
import type { ClassesValue, PreferencesValue } from "../ta/onboarding/model";
import * as fx from "./fixtures";
import * as ofx from "./onboardingFixtures";

const noop = () => {};
const asyncNoop = async () => {};

/* ------------------------------------------------------------------ */
/* Frames                                                              */
/* ------------------------------------------------------------------ */

function Frame({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-page text-ink">
      {children}
      <Toaster />
    </div>
  );
}

function PageFrame({ children }: { children: ReactNode }) {
  return (
    <Frame>
      <div className="mx-auto max-w-[1240px] px-7 py-6">{children}</div>
    </Frame>
  );
}

/* ------------------------------------------------------------------ */
/* Screens                                                             */
/* ------------------------------------------------------------------ */

function LoginPreview() {
  const [params] = useSearchParams();
  const state = params.get("state");
  return (
    <LoginScreen
      loading={state === "loading"}
      rejectedEmail={state === "error" ? "sarah.chen@gmail.com" : null}
      onGoogle={noop}
    />
  );
}

function ShellPreview() {
  const [paletteOpen, setPaletteOpen] = useState(true);
  const close = () => setPaletteOpen(false);
  return (
    <StaticPeriodProvider
      value={{
        periodId: fx.PERIOD_ID,
        label: fx.periodEntry.label,
        loading: false,
        entries: [fx.periodEntry],
        selected: fx.periodEntry,
        taProfileId: null,
      }}
    >
      <Frame>
        <AppShellView
          role="coordinator"
          userName="Dr. Nelson"
          userEmail="nelson@umd.edu"
          onSignOut={noop}
          onOpenPalette={() => setPaletteOpen(true)}
        >
          <RosterView
            periodSelected
            rows={fx.roster}
            nudging={false}
            onNudge={noop}
            inviting={false}
            onInvite={noop}
            onRemove={noop}
          />
        </AppShellView>
        <CommandPaletteView
          open={paletteOpen}
          onClose={close}
          role="coordinator"
          tas={fx.paletteTas}
          onNavigate={close}
          onAction={close}
          onOpenTa={close}
        />
      </Frame>
    </StaticPeriodProvider>
  );
}

function AvailabilityPreview() {
  return (
    <PageFrame>
      <AvailabilityEditor
        data={availabilityFixture}
        onSave={asyncNoop}
        onAddException={asyncNoop}
        onRemoveException={asyncNoop}
      />
    </PageFrame>
  );
}

function BuilderPreview({
  drawer,
  publish,
}: {
  drawer?: boolean;
  publish?: boolean;
}) {
  return (
    <Frame>
      <div className="px-6 py-5">
        <BuilderScreen
          periodRef={fx.PERIOD_ID}
          fixture={fx.builderFixture}
          fixtureDetail={drawer ? fx.danielDetail : undefined}
          initialDrawerTa={drawer ? fx.danielId : null}
          initialPublishOpen={publish ?? false}
        />
      </div>
    </Frame>
  );
}

function RosterPreview() {
  return (
    <PageFrame>
      <RosterView
        periodSelected
        rows={fx.roster}
        nudging={false}
        onNudge={noop}
        inviting={false}
        onInvite={noop}
        onRemove={noop}
      />
    </PageFrame>
  );
}

function ShiftsPreview() {
  return (
    <PageFrame>
      <ShiftsView
        periodSelected
        dutyTypes={fx.dutyTypes}
        shifts={fx.shifts}
        onCreate={noop}
        onUpdate={noop}
        onRemove={noop}
      />
    </PageFrame>
  );
}

function HoursApprovalPreview() {
  const [filters, setFilters] = useState<HoursFilters>({
    taProfileRef: "",
    dutyTypeRef: "",
    weekStart: "",
    status: "",
  });
  const logs = fx.hourLogs.filter(
    (l) =>
      (filters.taProfileRef === "" || l.taProfileRef === filters.taProfileRef) &&
      (filters.dutyTypeRef === "" || l.dutyTypeRef === filters.dutyTypeRef) &&
      (filters.status === "" || l.status === filters.status),
  );
  return (
    <PageFrame>
      <CoordinatorHoursView
        periodSelected
        logs={logs}
        totals={fx.taTotals}
        dutyTypes={fx.dutyTypes}
        filters={filters}
        onFiltersChange={setFilters}
        approving={false}
        onBulkApprove={noop}
        onFlag={noop}
        exporting={false}
        onExport={noop}
      />
    </PageFrame>
  );
}

function SchedulePreview() {
  return (
    <PageFrame>
      <ScheduleView
        courseLabel="CMSC132 · Fall 2026"
        published
        items={fx.scheduleItems}
        hourLogs={fx.taHourLogs}
        maxHoursPerWeek={10}
        pendingSwaps={fx.pendingSwaps}
        coverage={fx.coverageNotices}
        onCancelSwap={() => {}}
        onRequestSwap={noop}
        onAddToCalendar={noop}
        addingToCalendar={false}
      />
    </PageFrame>
  );
}

function TaHoursPreview() {
  const [weekStart, setWeekStart] = useState(fx.TA_WEEK_START);
  return (
    <PageFrame>
      <TaHoursView
        courseLabel="CMSC132 · Fall 2026"
        published
        items={fx.scheduleItems}
        hourLogs={fx.taHourLogs}
        maxHoursPerWeek={10}
        weekStart={weekStart}
        onWeekChange={setWeekStart}
        onLogHours={asyncNoop}
        onSubmitWeek={asyncNoop}
        submittingWeek={false}
        onUpdateLog={asyncNoop}
        onDeleteLog={asyncNoop}
        onUnsubmitWeek={asyncNoop}
      />
    </PageFrame>
  );
}

/* ------------------------------------------------------------------ */
/* Index + dispatcher                                                  */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* TA setup wizard                                                     */
/* ------------------------------------------------------------------ */

const WIZ_IDENTITY = "Priya Shah · pshah@umd.edu";

function OnboardingCoursesPreview() {
  const [params] = useSearchParams();
  const state = params.get("state");
  const [value, setValue] = useState<ClassesValue>(
    state === "empty" ? ofx.emptyClassesValue : ofx.classesValue,
  );
  const [details, setDetails] = useState(ofx.contactDetails);
  return (
    <Frame>
      <WizardChrome stepIndex={0} onContinue={noop} identity={WIZ_IDENTITY}>
        <Step1Courses
          value={value}
          onChange={setValue}
          onSearch={ofx.previewSearch}
          onImportCourse={
            state === "error" ? ofx.previewImportFailure : ofx.previewImport
          }
          details={details}
          onDetailsChange={setDetails}
          firstName={ofx.firstName}
        />
      </WizardChrome>
    </Frame>
  );
}

function OnboardingAvailabilityPreview() {
  const [classes, setClasses] = useState<ClassesValue>(ofx.classesValue);
  return (
    <Frame>
      <WizardChrome stepIndex={1} onContinue={noop} identity={WIZ_IDENTITY}>
        <Step2Availability
          data={availabilityFixture}
          classes={classes}
          onClassesChange={setClasses}
          savedAgoLabel="saved 2 min ago"
          onSave={asyncNoop}
          onAddException={asyncNoop}
          onRemoveException={asyncNoop}
        />
      </WizardChrome>
    </Frame>
  );
}

function OnboardingPreferencesPreview() {
  const [value, setValue] = useState<PreferencesValue>(ofx.preferencesValue);
  return (
    <Frame>
      <WizardChrome stepIndex={2} onContinue={noop} identity={WIZ_IDENTITY}>
        <Step3Preferences
          value={value}
          onChange={setValue}
          dutyTypes={ofx.dutyTypes}
          sections={ofx.staffedSections}
          classes={ofx.classesValue}
        />
      </WizardChrome>
    </Frame>
  );
}

const SCREENS: Record<string, { label: string; element: ReactNode }> = {
  login: { label: "Login (add ?state=loading or ?state=error)", element: <LoginPreview /> },
  shell: { label: "App shell + command palette", element: <ShellPreview /> },
  availability: { label: "TA availability editor", element: <AvailabilityPreview /> },
  builder: { label: "Builder — default", element: <BuilderPreview /> },
  "builder-drawer": { label: "Builder — TA drawer (Daniel)", element: <BuilderPreview drawer /> },
  "builder-publish": { label: "Builder — publish modal", element: <BuilderPreview publish /> },
  roster: { label: "Coordinator roster", element: <RosterPreview /> },
  shifts: { label: "Coordinator shifts", element: <ShiftsPreview /> },
  "hours-approval": { label: "Coordinator hours approval", element: <HoursApprovalPreview /> },
  schedule: { label: "TA schedule", element: <SchedulePreview /> },
  "ta-hours": { label: "TA hour logging", element: <TaHoursPreview /> },
  "onboarding-1": {
    label: "Setup 1 — courses (?state=empty | ?state=error)",
    element: <OnboardingCoursesPreview />,
  },
  "onboarding-2": { label: "Setup 2 — availability", element: <OnboardingAvailabilityPreview /> },
  "onboarding-3": { label: "Setup 3 — preferences", element: <OnboardingPreferencesPreview /> },
};

function PreviewIndex() {
  return (
    <PageFrame>
      <h1 className="text-[17px] font-semibold tracking-[-0.01em] text-ink">
        DEV preview harness
      </h1>
      <p className="mt-1 text-[12.5px] text-muted">
        Fixture-driven renders of every major screen. DEV builds only.
      </p>
      <ul className="mt-5 flex flex-col gap-1.5">
        {Object.entries(SCREENS).map(([slug, s]) => (
          <li key={slug}>
            <Link
              to={`/dev/preview/${slug}`}
              className="text-[13px] text-ink underline decoration-[rgba(255,255,255,0.25)] underline-offset-2 hover:decoration-inherit"
            >
              {s.label}
            </Link>
            <span className="ml-2 font-mono text-[11px] text-faint">/dev/preview/{slug}</span>
          </li>
        ))}
      </ul>
    </PageFrame>
  );
}

export function DevPreview() {
  const { screen } = useParams();
  if (!screen) return <PreviewIndex />;
  const entry = SCREENS[screen];
  if (!entry) {
    return (
      <PageFrame>
        <p className="text-[13px] text-muted">
          Unknown preview "{screen}".{" "}
          <Link to="/dev/preview" className="text-ink underline">
            Back to index
          </Link>
        </p>
      </PageFrame>
    );
  }
  return <div key={screen}>{entry.element}</div>;
}
