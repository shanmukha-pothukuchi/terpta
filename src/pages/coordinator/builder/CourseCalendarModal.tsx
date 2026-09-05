import { useState, type FormEvent } from "react";
import { useMutation, useQuery } from "convex/react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { Button, Input, Modal, Spinner, toast } from "../../../components/ui";
import { CalendarFeed } from "../../../components/CalendarFeed";
import { errorMessage } from "../../../lib/errorMessage";
import { describeScope, scopeFromStore, scopeToStore } from "../../../lib/calendarLinks";
import type { DutyType } from "./model";

type CourseFeed = {
  _id: Id<"calendarFeeds">;
  secret: string;
  label?: string;
  dutyTypeRefs?: Id<"dutyTypes">[];
};

export interface CourseCalendarModalProps {
  open: boolean;
  onClose: () => void;
  /** Absent in previews, which have no Convex to ask for a feed address. */
  periodRef?: Id<"staffingPeriods">;
  dutyTypes: DutyType[];
}

/**
 * The course's staffed week as calendars students subscribe to.
 *
 * One link per audience rather than one per course: the syllabus wants
 * everything, the student who only comes to office hours wants those alone,
 * a section page wants its discussions. Each link says which kinds of work
 * it carries and can be changed under the same address, so what a student
 * sees is decided here and not by which link they happened to get.
 */
export function CourseCalendarModal({
  open,
  onClose,
  periodRef,
  dutyTypes,
}: CourseCalendarModalProps) {
  const feeds = useQuery(
    api.calendarFeeds.listForPeriod,
    open && periodRef ? { periodRef } : "skip",
  );
  const [composing, setComposing] = useState(false);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add to calendar"
      width={520}
      footer={<Button onClick={onClose}>Close</Button>}
    >
      <div className="flex flex-col gap-3">
        <p className="text-[12.5px] leading-[1.5] text-muted">
          Every staffed hour of the course, as a calendar students add once. It
          follows the published schedule, so a change turns up without them
          doing anything. Make a link for each audience — everything for the
          syllabus, office hours alone for the students who only want those.
        </p>

        {!periodRef ? (
          <p className="text-[12.5px] text-faint">Not available in the preview.</p>
        ) : feeds === undefined ? (
          <Spinner label="Loading links…" />
        ) : (
          <>
            {feeds.map((feed) => (
              <LinkCard key={feed._id} feed={feed} dutyTypes={dutyTypes} />
            ))}

            {feeds.length === 0 || composing ? (
              <div className={feeds.length > 0 ? "border-t border-line pt-3" : undefined}>
                {feeds.length > 0 ? (
                  <div className="mb-2 text-[12.5px] font-medium text-ink">Another link</div>
                ) : null}
                <LinkForm
                  periodRef={periodRef}
                  dutyTypes={dutyTypes}
                  submitLabel="Create a calendar link"
                  onDone={() => setComposing(false)}
                  onCancel={feeds.length > 0 ? () => setComposing(false) : undefined}
                />
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setComposing(true)}
                className="flex w-fit items-center gap-1.5 text-[12px] text-muted transition-colors hover:text-ink"
              >
                <Plus size={13} strokeWidth={1.5} aria-hidden />
                Another link, for a different audience
              </button>
            )}

            {feeds.length > 0 ? (
              <p className="text-[11.5px] leading-[1.45] text-faint">
                Anyone with a link can read that calendar, so treat each one
                like a private address. Calendar apps check on their own
                schedule — usually every few hours — so a change can take a
                little while to appear.
              </p>
            ) : null}
          </>
        )}
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */

function LinkCard({ feed, dutyTypes }: { feed: CourseFeed; dutyTypes: DutyType[] }) {
  const [editing, setEditing] = useState(false);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [busy, setBusy] = useState(false);
  const rotate = useMutation(api.calendarFeeds.rotate);
  const remove = useMutation(api.calendarFeeds.remove);

  const nameOf = (id: string) => dutyTypes.find((d) => (d._id as string) === id)?.name;
  const scope = describeScope(feed.dutyTypeRefs, nameOf);
  const carried =
    feed.dutyTypeRefs === undefined
      ? dutyTypes
      : dutyTypes.filter((d) => feed.dutyTypeRefs!.includes(d._id));

  const doRotate = () => {
    setBusy(true);
    rotate({ kind: "course", feedRef: feed._id })
      .catch((e) => toast(errorMessage(e), { tone: "error" }))
      .finally(() => setBusy(false));
  };

  const doRemove = () => {
    setBusy(true);
    remove({ feedRef: feed._id })
      .then(() => toast("Calendar link removed"))
      .catch((e) => toast(errorMessage(e), { tone: "error" }))
      .finally(() => setBusy(false));
  };

  return (
    <div className="flex flex-col gap-2.5 rounded-[10px] border border-line bg-[rgba(255,255,255,0.02)] p-3">
      <div className="flex items-start gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="truncate text-[13px] font-medium text-ink">{feed.label ?? scope}</div>
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11.5px] text-muted">
            {carried.map((d) => (
              <span key={d._id} className="flex items-center gap-1">
                <span
                  className="size-[8px] shrink-0 rounded-[2.5px]"
                  style={{ background: d.color }}
                  aria-hidden
                />
                {d.name}
              </span>
            ))}
            {feed.dutyTypeRefs === undefined ? (
              <span className="text-faint">· and anything added later</span>
            ) : carried.length === 0 ? (
              <span className="text-faint">Carries nothing: its kinds of work were removed</span>
            ) : null}
          </div>
        </div>
        {!editing ? (
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => setEditing(true)}
              title="Change what this link carries"
              className="grid size-7 place-items-center rounded-[7px] text-faint transition-colors hover:bg-[rgba(255,255,255,0.06)] hover:text-ink"
            >
              <Pencil size={13} strokeWidth={1.5} aria-hidden />
              <span className="sr-only">Edit</span>
            </button>
            <button
              type="button"
              onClick={() => setConfirmingRemove(true)}
              title="Remove this link"
              className="grid size-7 place-items-center rounded-[7px] text-faint transition-colors hover:bg-[rgba(255,255,255,0.06)] hover:text-umd"
            >
              <Trash2 size={13} strokeWidth={1.5} aria-hidden />
              <span className="sr-only">Remove</span>
            </button>
          </div>
        ) : null}
      </div>

      {editing ? (
        <LinkForm
          feed={feed}
          dutyTypes={dutyTypes}
          submitLabel="Save"
          onDone={() => setEditing(false)}
          onCancel={() => setEditing(false)}
        />
      ) : confirmingRemove ? (
        <div className="flex flex-wrap items-center gap-2 rounded-[9px] border border-line bg-[rgba(245,165,36,0.08)] px-3 py-2">
          <span className="text-[12px] text-warn">
            Removing it stops the calendar for everyone who added it.
          </span>
          <span className="flex-1" />
          <Button size="sm" onClick={() => setConfirmingRemove(false)}>
            Cancel
          </Button>
          <Button variant="danger" size="sm" loading={busy} onClick={doRemove}>
            Remove it
          </Button>
        </div>
      ) : (
        <CalendarFeed
          secret={feed.secret}
          loading={busy}
          onCreate={() => {}}
          onRotate={doRotate}
          note={false}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function LinkForm({
  periodRef,
  feed,
  dutyTypes,
  submitLabel,
  onDone,
  onCancel,
}: {
  /** For a new link. */
  periodRef?: Id<"staffingPeriods">;
  /** For changing an existing one. */
  feed?: CourseFeed;
  dutyTypes: DutyType[];
  submitLabel: string;
  onDone: () => void;
  onCancel?: () => void;
}) {
  const allIds = dutyTypes.map((d) => d._id as string);
  const [label, setLabel] = useState(feed?.label ?? "");
  const [checked, setChecked] = useState<Set<string>>(() =>
    scopeFromStore(feed?.dutyTypeRefs, allIds),
  );
  const [busy, setBusy] = useState(false);
  const create = useMutation(api.calendarFeeds.createForPeriod);
  const update = useMutation(api.calendarFeeds.update);

  const toggle = (id: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const stored = scopeToStore(checked, allIds);
  const nothing = stored !== undefined && stored.length === 0;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (nothing) return;
    const dutyTypeRefs = stored as Id<"dutyTypes">[] | undefined;
    const trimmed = label.trim();
    setBusy(true);
    const call = feed
      ? update({ feedRef: feed._id, label: trimmed || undefined, dutyTypeRefs })
      : create({ periodRef: periodRef!, label: trimmed || undefined, dutyTypeRefs });
    call
      .then(() => onDone())
      .catch((err) => toast(errorMessage(err), { tone: "error" }))
      .finally(() => setBusy(false));
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-2.5">
      <Input
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        maxLength={60}
        placeholder="Name, e.g. Office hours only (optional)"
        aria-label="Link name"
      />
      <div className="flex flex-col gap-1.5">
        <span className="text-[12px] text-muted">Carries</span>
        {dutyTypes.length === 0 ? (
          <span className="text-[11.5px] text-faint">No kinds of work yet, so the link carries everything.</span>
        ) : (
          dutyTypes.map((d) => (
            <label
              key={d._id}
              className="flex cursor-pointer items-center gap-2 text-[12.5px] text-muted hover:text-ink"
            >
              <input
                type="checkbox"
                checked={checked.has(d._id as string)}
                onChange={() => toggle(d._id as string)}
                className="size-[13px] accent-[#E21833]"
              />
              <span
                className="size-[8px] shrink-0 rounded-[2.5px]"
                style={{ background: d.color }}
                aria-hidden
              />
              <span className="min-w-0 truncate">{d.name}</span>
            </label>
          ))
        )}
        <p className="text-[11.5px] leading-[1.45] text-faint">
          {nothing
            ? "Pick at least one kind of work for the link to carry."
            : stored === undefined
              ? "Everything, including any kind of work added later."
              : "Only these. A kind of work added later stays out until you add it here."}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Button type="submit" variant="primary" size="sm" loading={busy} disabled={nothing}>
          {submitLabel}
        </Button>
        {onCancel ? (
          <Button type="button" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
      </div>
    </form>
  );
}
