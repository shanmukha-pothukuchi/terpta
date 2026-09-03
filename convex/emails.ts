import { ConvexError, v } from "convex/values";
import { action, internalAction, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { requireUser } from "./lib/auth";

// The Convex runtime exposes process.env; @types/node is not installed in
// this project, so declare the minimal shape locally (module-scoped).
declare const process: { env: Record<string, string | undefined> };

/**
 * Where the app lives, for links in email. Public, so a default is fine;
 * set APP_URL on the deployment to override.
 */
export function appUrl(): string {
  return process.env.APP_URL ?? "https://shanmukha-pothukuchi.github.io/terpta/";
}

/**
 * What happened to one email. `ok: false` with `via: "none"` means no
 * transport is configured at all, which is a different problem from a
 * configured one refusing the message — the coordinator needs to know which.
 */
export const emailResultValidator = v.object({
  ok: v.boolean(),
  via: v.union(v.literal("smtp"), v.literal("resend"), v.literal("none")),
  error: v.optional(v.string()),
});
export type EmailResult = {
  ok: boolean;
  via: "smtp" | "resend" | "none";
  error?: string;
};

function describe(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/**
 * Send one email and say how it went.
 *
 * Picks the first configured transport:
 * - SMTP_USER + SMTP_PASS -> convex/smtp.ts (Node runtime; Gmail app password).
 * - RESEND_API_KEY        -> the Resend HTTP API.
 * - neither               -> nothing is sent; the payload is logged.
 *
 * Never throws. This used to return null on every path, so an invite or a
 * nudge that went nowhere still showed "sent" — the only trace was a line in
 * the deployment log nobody was reading. Callers now get the result and are
 * expected to put it in front of the coordinator.
 */
export const send = internalAction({
  args: {
    to: v.string(),
    subject: v.string(),
    text: v.string(),
  },
  returns: emailResultValidator,
  handler: async (ctx, args): Promise<EmailResult> => {
    if (process.env.SMTP_USER && process.env.SMTP_PASS) {
      try {
        await ctx.runAction(internal.smtp.sendMail, args);
        return { ok: true, via: "smtp" };
      } catch (err) {
        console.error("[emails.send] SMTP delivery failed:", err);
        return { ok: false, via: "smtp", error: describe(err) };
      }
    }

    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      console.log(
        `[emails.send] no SMTP_* or RESEND_API_KEY — would send to=${args.to} ` +
          `subject=${JSON.stringify(args.subject)} text=${JSON.stringify(args.text)}`,
      );
      return {
        ok: false,
        via: "none",
        error: "No email transport is configured on this deployment (SMTP_USER/SMTP_PASS or RESEND_API_KEY)",
      };
    }
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: "TerpTA <onboarding@resend.dev>",
          to: [args.to],
          subject: args.subject,
          text: args.text,
        }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "<unreadable body>");
        console.error(`[emails.send] Resend responded ${res.status}: ${body}`);
        return { ok: false, via: "resend", error: `Resend responded ${res.status}: ${body}` };
      }
      return { ok: true, via: "resend" };
    } catch (err) {
      console.error("[emails.send] failed:", err);
      return { ok: false, via: "resend", error: describe(err) };
    }
  },
});

/** The signed-in caller, for an action that has no db of its own. */
export const callerContact = internalQuery({
  args: {},
  returns: v.object({ email: v.string(), name: v.string(), role: v.string() }),
  handler: async (ctx): Promise<{ email: string; name: string; role: string }> => {
    const { user } = await requireUser(ctx);
    return { email: user.email, name: user.name, role: user.role ?? "ta" };
  },
});

/**
 * Send the coordinator a test message and report exactly what happened.
 *
 * There was no way to find out whether a deployment could send mail short of
 * inviting somebody and asking them. This is that check, addressed to the
 * caller so it cannot be used to mail anyone else.
 */
export const sendTest = action({
  args: {},
  returns: emailResultValidator,
  handler: async (ctx): Promise<EmailResult> => {
    const me: { email: string; name: string; role: string } = await ctx.runQuery(
      internal.emails.callerContact,
      {},
    );
    if (me.role !== "coordinator") throw new ConvexError("Coordinator role required");
    return await ctx.runAction(internal.emails.send, {
      to: me.email,
      subject: "[TerpTA] Test email",
      text:
        `Hi ${me.name},\n\n` +
        `This is a test message from TerpTA. If you are reading it, email delivery ` +
        `from this deployment works.\n\n${appUrl()}\n\nTerpTA`,
    });
  },
});
