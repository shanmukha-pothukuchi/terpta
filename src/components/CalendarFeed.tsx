import { useState } from "react";
import { Check, Copy, ExternalLink, RefreshCw } from "lucide-react";
import { Button, toast } from "./ui";

/** The Convex site origin, where the .ics route lives. */
export function feedOrigin(): string {
  const env = import.meta.env as Record<string, string | undefined>;
  return (
    env.VITE_CONVEX_SITE_URL ??
    (env.VITE_CONVEX_URL ?? "").replace(".convex.cloud", ".convex.site")
  );
}

export function feedUrl(secret: string): string {
  return `${feedOrigin()}/calendar.ics?feed=${encodeURIComponent(secret)}`;
}

export interface CalendarFeedProps {
  /** Undefined until the address has been asked for. */
  secret: string | undefined;
  loading?: boolean;
  onCreate: () => void;
  onRotate?: () => void;
  /** What the feed holds, for the sentence above the address. */
  description?: string;
  /** Say that the link is the credential. Off when a list of links says it once. */
  note?: boolean;
}

/**
 * Subscribe-by-URL, in the three shapes calendars actually take one.
 *
 * A downloaded .ics is a photograph: it says what the schedule was the day
 * it was saved. This is the address of the schedule itself, so a change
 * turns up in the same calendar entry without anybody re-adding anything.
 */
export function CalendarFeed({
  secret,
  loading = false,
  onCreate,
  onRotate,
  description,
  note = true,
}: CalendarFeedProps) {
  const [copied, setCopied] = useState(false);
  const [confirmingRotate, setConfirmingRotate] = useState(false);

  if (!secret) {
    return (
      <div className="flex flex-col gap-2">
        {description ? (
          <p className="text-[12.5px] leading-[1.5] text-muted">{description}</p>
        ) : null}
        <Button variant="secondary" onClick={onCreate} loading={loading} className="w-fit">
          Create a calendar link
        </Button>
      </div>
    );
  }

  const url = feedUrl(secret);
  // Apple Calendar and Outlook both take webcal:// as "subscribe, keep asking".
  const webcal = url.replace(/^https?:\/\//, "webcal://");
  const google = `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}`;

  const copy = () => {
    navigator.clipboard
      .writeText(url)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => toast("Could not reach the clipboard — select the link instead", { tone: "error" }));
  };

  return (
    <div className="flex flex-col gap-2.5">
      {description ? (
        <p className="text-[12.5px] leading-[1.5] text-muted">{description}</p>
      ) : null}
      <input
        readOnly
        value={url}
        aria-label="Calendar feed address"
        onFocus={(e) => e.currentTarget.select()}
        className="w-full rounded-[9px] border border-line bg-page px-3 py-2 font-mono text-[11.5px] text-ink outline-none"
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" size="sm" onClick={copy}>
          {copied ? (
            <Check size={13} strokeWidth={1.5} aria-hidden />
          ) : (
            <Copy size={13} strokeWidth={1.5} aria-hidden />
          )}
          {copied ? "Copied" : "Copy link"}
        </Button>
        <a
          href={webcal}
          className="flex h-8 items-center gap-1.5 rounded-[9px] border border-line px-2.5 text-[12.5px] text-muted transition-colors hover:bg-[rgba(255,255,255,0.05)] hover:text-ink"
        >
          <ExternalLink size={13} strokeWidth={1.5} aria-hidden />
          Apple / Outlook
        </a>
        <a
          href={google}
          target="_blank"
          rel="noreferrer noopener"
          className="flex h-8 items-center gap-1.5 rounded-[9px] border border-line px-2.5 text-[12.5px] text-muted transition-colors hover:bg-[rgba(255,255,255,0.05)] hover:text-ink"
        >
          <ExternalLink size={13} strokeWidth={1.5} aria-hidden />
          Google Calendar
        </a>
      </div>
      {note ? (
        <p className="text-[11.5px] leading-[1.45] text-faint">
          Anyone with this link can read the calendar, so treat it like a private
          address. Calendar apps check it on their own schedule — usually every
          few hours — so a change can take a little while to appear.
        </p>
      ) : null}
      {onRotate ? (
        confirmingRotate ? (
          <div className="flex flex-wrap items-center gap-2 rounded-[9px] border border-line bg-[rgba(245,165,36,0.08)] px-3 py-2">
            <span className="text-[12px] text-warn">
              A new link stops the old one working for everyone using it.
            </span>
            <span className="flex-1" />
            <Button size="sm" onClick={() => setConfirmingRotate(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={() => {
                setConfirmingRotate(false);
                onRotate();
              }}
            >
              Replace it
            </Button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmingRotate(true)}
            className="flex w-fit items-center gap-1.5 text-[11.5px] text-faint transition-colors hover:text-ink"
          >
            <RefreshCw size={12} strokeWidth={1.5} aria-hidden />
            Replace this link
          </button>
        )
      ) : null}
    </div>
  );
}
