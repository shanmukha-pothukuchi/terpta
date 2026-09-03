import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";

// The Convex runtime exposes process.env; @types/node is not installed in
// this project, so declare the minimal shape locally (module-scoped).
declare const process: { env: Record<string, string | undefined> };

/**
 * Fire-and-forget email sender.
 *
 * Picks the first configured transport:
 * - SMTP_USER + SMTP_PASS -> convex/smtp.ts (Node runtime; Gmail app password).
 * - RESEND_API_KEY        -> the Resend HTTP API.
 * - neither               -> logs the payload (dev mode).
 * - NEVER throws: an email failure must not break the calling workflow
 *   (nudges, notifications, etc.). Failures are logged instead.
 */
export const send = internalAction({
  args: {
    to: v.string(),
    subject: v.string(),
    text: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (process.env.SMTP_USER && process.env.SMTP_PASS) {
      try {
        await ctx.runAction(internal.smtp.sendMail, args);
      } catch (err) {
        console.error("[emails.send] SMTP delivery failed:", err);
      }
      return null;
    }

    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      console.log(
        `[emails.send] no SMTP_* or RESEND_API_KEY — would send to=${args.to} ` +
          `subject=${JSON.stringify(args.subject)} text=${JSON.stringify(args.text)}`,
      );
      return null;
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
      }
    } catch (err) {
      console.error("[emails.send] failed:", err);
    }
    return null;
  },
});
