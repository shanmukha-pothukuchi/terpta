import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { verifyToken } from "./exportTokens";
// convex/authkit.ts is owned by the auth agent; it exposes the AuthKit
// component client used to register the WorkOS webhook + component routes.
import { authKit } from "./authkit";

const http = httpRouter();

// ---------------------------------------------------------------------------
// ICS helpers
// ---------------------------------------------------------------------------

const TZID = "America/New_York";

const DAY_TO_ICAL: Record<string, string> = {
  M: "MO",
  Tu: "TU",
  W: "WE",
  Th: "TH",
  F: "FR",
};

// JS getUTCDay(): Sun=0 … Sat=6
const DAY_TO_UTC_DOW: Record<string, number> = { M: 1, Tu: 2, W: 3, Th: 4, F: 5 };

function icsEscape(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

function compactDate(iso: string): string {
  return iso.replace(/-/g, "");
}

function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** ISO date + minutes-from-midnight -> iCalendar naive local DATE-TIME. */
function localDateTime(iso: string, minutes: number): string {
  const h = String(Math.floor(minutes / 60)).padStart(2, "0");
  const m = String(minutes % 60).padStart(2, "0");
  return `${compactDate(iso)}T${h}${m}00`;
}

/** First date >= startIso that falls on the given day-of-week ("M".."F"). */
function firstOccurrenceOnOrAfter(startIso: string, day: string): string {
  const [y, m, d] = startIso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const target = DAY_TO_UTC_DOW[day] ?? 1;
  while (dt.getUTCDay() !== target) dt.setUTCDate(dt.getUTCDate() + 1);
  return dt.toISOString().slice(0, 10);
}

type ScheduleData = {
  taName: string;
  taEmail: string;
  events: Array<{
    uid: string;
    kind: "weekly" | "once" | "async";
    title: string;
    description?: string;
    day?: "M" | "Tu" | "W" | "Th" | "F";
    startMin?: number;
    endMin?: number;
    startDate?: string;
    endDate?: string;
    date?: string;
    hoursRequired?: number;
    dueDate?: string;
  }>;
};

function buildIcs(data: ScheduleData): string {
  const dtstamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//TerpTA//Schedule Export//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${icsEscape(`TerpTA - ${data.taName}`)}`,
    `X-WR-TIMEZONE:${TZID}`,
  ];

  for (const ev of data.events) {
    lines.push("BEGIN:VEVENT", `UID:${ev.uid}`, `DTSTAMP:${dtstamp}`);

    if (
      ev.kind === "weekly" &&
      ev.day !== undefined &&
      ev.startMin !== undefined &&
      ev.endMin !== undefined &&
      ev.startDate !== undefined &&
      ev.endDate !== undefined
    ) {
      const first = firstOccurrenceOnOrAfter(ev.startDate, ev.day);
      lines.push(
        `SUMMARY:${icsEscape(ev.title)}`,
        `DTSTART;TZID=${TZID}:${localDateTime(first, ev.startMin)}`,
        `DTEND;TZID=${TZID}:${localDateTime(first, ev.endMin)}`,
        `RRULE:FREQ=WEEKLY;BYDAY=${DAY_TO_ICAL[ev.day]};UNTIL=${compactDate(ev.endDate)}T235959Z`,
      );
    } else if (
      ev.kind === "once" &&
      ev.date !== undefined &&
      ev.startMin !== undefined &&
      ev.endMin !== undefined
    ) {
      lines.push(
        `SUMMARY:${icsEscape(ev.title)}`,
        `DTSTART;TZID=${TZID}:${localDateTime(ev.date, ev.startMin)}`,
        `DTEND;TZID=${TZID}:${localDateTime(ev.date, ev.endMin)}`,
      );
    } else {
      // Async duty: all-day marker on the due date (or today if none set).
      const due = ev.dueDate ?? new Date().toISOString().slice(0, 10);
      const summary =
        ev.hoursRequired !== undefined
          ? `${ev.title} (${ev.hoursRequired}h due)`
          : ev.title;
      lines.push(
        `SUMMARY:${icsEscape(summary)}`,
        `DTSTART;VALUE=DATE:${compactDate(due)}`,
        `DTEND;VALUE=DATE:${compactDate(addDaysIso(due, 1))}`,
      );
    }

    if (ev.description) lines.push(`DESCRIPTION:${icsEscape(ev.description)}`);
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}

// ---------------------------------------------------------------------------
// GET /schedule.ics?token=…
// ---------------------------------------------------------------------------

http.route({
  path: "/schedule.ics",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const payload = await verifyToken(url.searchParams.get("token") ?? "", "schedule");
    if (!payload || !payload.taProfileRef) {
      return new Response("Invalid or expired token", { status: 401 });
    }
    const data = await ctx.runQuery(internal.exportTokens.scheduleForExport, {
      taProfileRef: payload.taProfileRef as Id<"taProfiles">,
    });
    if (!data) return new Response("Schedule not found", { status: 404 });
    return new Response(buildIcs(data), {
      status: 200,
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": 'attachment; filename="terpta-schedule.ics"',
        "Cache-Control": "no-store",
      },
    });
  }),
});

// ---------------------------------------------------------------------------
// GET /hour-logs.csv?token=…&from=YYYY-MM-DD&to=YYYY-MM-DD
// ---------------------------------------------------------------------------

function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

http.route({
  path: "/hour-logs.csv",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const payload = await verifyToken(url.searchParams.get("token") ?? "", "hourlogs");
    if (!payload || !payload.periodRef) {
      return new Response("Invalid or expired token", { status: 401 });
    }
    const from = url.searchParams.get("from") ?? undefined;
    const to = url.searchParams.get("to") ?? undefined;
    const rows = await ctx.runQuery(internal.hours.hourLogsForExport, {
      periodRef: payload.periodRef as Id<"staffingPeriods">,
      from,
      to,
    });
    const lines = [
      "date,ta,email,dutyType,hours,status,note",
      ...rows.map((r) =>
        [r.date, r.ta, r.email, r.dutyType, String(r.hours), r.status, r.note]
          .map(csvField)
          .join(","),
      ),
    ];
    return new Response(lines.join("\r\n") + "\r\n", {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="terpta-hour-logs.csv"',
        "Cache-Control": "no-store",
      },
    });
  }),
});

// ---------------------------------------------------------------------------
// AuthKit (WorkOS) webhook + component routes (see convex/authkit.ts).
// ---------------------------------------------------------------------------

authKit.registerRoutes(http);

export default http;
