import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { BellRing, Trash2, UserPlus, Users } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import {
  Button,
  EmptyState,
  Input,
  Label,
  Modal,
  PageHeader,
  ProgressBar,
  Spinner,
  StatusBadge,
  Surface,
  toast,
} from "../../components/ui";
import { usePeriod } from "../../lib/period";
import { formatHourCount, formatHours } from "../../lib/format";
import type { RosterRow } from "../../lib/api";
import { errorMessage } from "../../lib/errorMessage";

export type { RosterRow };

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

function prefLabel(p: number): string {
  if (p < 0.4) return "mostly sync";
  if (p > 0.6) return "mostly async";
  return "no strong pref";
}

const ROW_GRID =
  "grid grid-cols-[minmax(0,1.3fr)_128px_64px_minmax(0,1.5fr)_170px_36px] items-center gap-3 px-3.5";

/* ------------------------------------------------------------------ */
/* Pure view                                                           */
/* ------------------------------------------------------------------ */

export interface RosterViewProps {
  periodSelected: boolean;
  /** undefined = loading */
  rows: RosterRow[] | undefined;
  nudging: boolean;
  onNudge: () => void;
  inviting: boolean;
  onInvite: (email: string) => void;
  onRemove: (taProfileRef: Id<"taProfiles">) => void;
}

export function RosterView({
  periodSelected,
  rows,
  nudging,
  onNudge,
  inviting,
  onInvite,
  onRemove,
}: RosterViewProps) {
  const [inviteOpen, setInviteOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [pendingRemove, setPendingRemove] = useState<RosterRow | null>(null);

  if (!periodSelected) {
    return (
      <div>
        <PageHeader
          title="Roster"
          description="TAs in this staffing period, their weekly hour caps, and whether they've submitted availability."
        />
        <EmptyState
          icon={Users}
          title="No staffing period selected"
          hint="Create a staffing period in Period setup, then invite TAs here."
        />
      </div>
    );
  }

  const submitted = rows?.filter((r) => r.status === "submitted").length ?? 0;
  const missing = rows ? rows.length - submitted : 0;

  const submitInvite = () => {
    const trimmed = email.trim();
    if (!trimmed.includes("@")) return;
    onInvite(trimmed);
    setEmail("");
    setInviteOpen(false);
  };

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Roster"
        description="TAs in this staffing period, their weekly hour caps, and whether they've submitted availability."
        actions={
          <>
            <Button onClick={onNudge} loading={nudging} disabled={missing === 0}>
              {!nudging && <BellRing size={14} strokeWidth={1.5} aria-hidden />}
              Nudge missing{missing > 0 ? ` (${missing})` : ""}
            </Button>
            <Button variant="primary" onClick={() => setInviteOpen(true)}>
              <UserPlus size={14} strokeWidth={1.5} aria-hidden />
              Invite TA
            </Button>
          </>
        }
      />

      {rows === undefined ? (
        <Spinner label="Loading roster…" />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No TAs yet"
          hint="Invite TAs by email — they appear here immediately and can claim their spot on first sign-in."
        >
          <Button variant="primary" onClick={() => setInviteOpen(true)}>
            <UserPlus size={14} strokeWidth={1.5} aria-hidden />
            Invite TA
          </Button>
        </EmptyState>
      ) : (
        <Surface className="overflow-hidden">
          <div className="flex h-10 items-center gap-2.5 border-b border-line px-3.5">
            <span className="shrink-0 text-[13px] font-medium text-ink">TAs</span>
            <span className="min-w-0 flex-1 truncate text-[12px] text-faint">
              {submitted} of {rows.length} submitted availability
            </span>
            <ProgressBar
              value={submitted}
              max={rows.length}
              tone="ok"
              className="w-28 shrink-0"
            />
            <span className="shrink-0 font-mono text-[11px] text-muted">
              {submitted}/{rows.length}
            </span>
          </div>
          <div
            className={`${ROW_GRID} h-8 border-b border-line text-[11px] font-medium uppercase tracking-[0.06em] text-faint`}
          >
            <span>TA</span>
            <span>Availability</span>
            <span>Cap</span>
            <span>Preferences</span>
            <span>Assigned</span>
            <span />
          </div>
          {rows.map((row) => {
            const extras: string[] = [];
            if (row.assignedOnceHours > 0)
              extras.push(`${formatHourCount(row.assignedOnceHours)} once`);
            if (row.assignedAsyncHours > 0)
              extras.push(`${formatHourCount(row.assignedAsyncHours)} async`);
            return (
              <div
                key={row.taProfileRef}
                className={`${ROW_GRID} h-[52px] border-b border-[rgba(255,255,255,0.04)] last:border-b-0 hover:bg-[rgba(255,255,255,0.02)]`}
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <div className="grid size-6 shrink-0 place-items-center rounded-full bg-[rgba(255,255,255,0.08)] text-[9.5px] font-semibold text-[#C9C9CF]">
                    {initials(row.name)}
                  </div>
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 truncate text-[12.5px] text-ink">
                      {row.name}
                      {row.invitePending ? (
                        <span className="rounded-[5px] bg-[rgba(255,255,255,0.06)] px-1.5 py-px text-[10.5px] text-faint">
                          invited
                        </span>
                      ) : null}
                    </p>
                    <p className="truncate font-mono text-[11px] text-faint">{row.email}</p>
                  </div>
                </div>
                <div>
                  <StatusBadge submitted={row.status === "submitted"} />
                </div>
                <span className="font-mono text-[12px]">{formatHourCount(row.maxHoursPerWeek)}</span>
                <div className="min-w-0">
                  <p className="truncate text-[12px] text-[#C9C9CF]">
                    {row.topDutyTypeNames.length > 0 ? row.topDutyTypeNames.join(" · ") : "—"}
                  </p>
                  <p className="truncate text-[11px] text-faint">
                    {prefLabel(row.syncAsyncPreference)} · {row.sectionPrefCount} section pref
                    {row.sectionPrefCount === 1 ? "" : "s"}
                  </p>
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <ProgressBar
                      value={row.assignedWeeklyHours}
                      max={row.maxHoursPerWeek}
                      className="w-20"
                    />
                    <span
                      className={
                        "font-mono text-[11.5px] " +
                        (row.assignedWeeklyHours > row.maxHoursPerWeek
                          ? "text-warn-text"
                          : "text-muted")
                      }
                    >
                      {formatHours(row.assignedWeeklyHours, row.maxHoursPerWeek)}
                    </span>
                  </div>
                  {extras.length > 0 ? (
                    <p className="mt-0.5 font-mono text-[10.5px] text-faint">
                      + {extras.join(" · ")}
                    </p>
                  ) : null}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Remove ${row.name}`}
                  onClick={() => setPendingRemove(row)}
                  className="w-7 justify-self-end px-0"
                >
                  <Trash2 size={14} strokeWidth={1.5} aria-hidden />
                </Button>
              </div>
            );
          })}
        </Surface>
      )}

      {/* Invite modal */}
      <Modal
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        title="Invite a TA"
        footer={
          <>
            <Button onClick={() => setInviteOpen(false)}>Cancel</Button>
            <Button
              variant="primary"
              onClick={submitInvite}
              loading={inviting}
              disabled={!email.includes("@")}
            >
              Send invite
            </Button>
          </>
        }
      >
        <Label htmlFor="invite-email">UMD email</Label>
        <Input
          id="invite-email"
          autoFocus
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submitInvite()}
          placeholder="tduck@terpmail.umd.edu"
          className="font-mono"
        />
        <p className="mt-2 text-[12px] text-faint">
          Only umd.edu and terpmail.umd.edu addresses. They join the roster immediately and claim
          it when they first sign in.
        </p>
      </Modal>

      {/* Remove confirm */}
      <Modal
        open={pendingRemove !== null}
        onClose={() => setPendingRemove(null)}
        title="Remove TA"
        footer={
          <>
            <Button onClick={() => setPendingRemove(null)}>Cancel</Button>
            <Button
              variant="danger"
              onClick={() => {
                if (pendingRemove) onRemove(pendingRemove.taProfileRef);
                setPendingRemove(null);
              }}
            >
              Remove
            </Button>
          </>
        }
      >
        <p className="text-[12.5px] text-muted">
          Remove <span className="font-medium text-ink">{pendingRemove?.name}</span> from this
          period? Their availability, assignments, and hour logs are deleted. This cannot be
          undone.
        </p>
      </Modal>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Wired page                                                          */
/* ------------------------------------------------------------------ */

export default function Roster() {
  const { periodId } = usePeriod();
  const rows = useQuery(api.roster.list, periodId ? { periodRef: periodId } : "skip");
  const invite = useMutation(api.roster.invite);
  const removeTa = useMutation(api.roster.remove);
  const nudge = useAction(api.roster.nudge);
  const [nudging, setNudging] = useState(false);
  const [inviting, setInviting] = useState(false);

  return (
    <RosterView
      periodSelected={periodId !== null}
      rows={periodId ? rows : undefined}
      nudging={nudging}
      onNudge={() => {
        if (!periodId || !rows) return;
        const targets = rows.filter((r) => r.status === "missing").map((r) => r.taProfileRef);
        if (targets.length === 0) return;
        setNudging(true);
        nudge({ periodRef: periodId, taProfileRefs: targets })
          .then((n) => toast(`Nudged ${n} TA${n === 1 ? "" : "s"} by email`))
          .catch((e) => toast(errorMessage(e), { tone: "error" }))
          .finally(() => setNudging(false));
      }}
      inviting={inviting}
      onInvite={(email) => {
        if (!periodId) return;
        setInviting(true);
        invite({ periodRef: periodId, email })
          .then(() => toast(`Invited ${email}`))
          .catch((e) => toast(errorMessage(e), { tone: "error" }))
          .finally(() => setInviting(false));
      }}
      onRemove={(taProfileRef) => {
        removeTa({ taProfileRef })
          .then(() => toast("TA removed from period"))
          .catch((e) => toast(errorMessage(e), { tone: "error" }));
      }}
    />
  );
}
