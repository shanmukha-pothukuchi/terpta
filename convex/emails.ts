import { v } from "convex/values";
import { internalAction } from "./_generated/server";

// The Convex runtime exposes process.env; @types/node is not installed in
// this project, so declare the minimal shape locally (module-scoped).
declare const process: { env: Record<string, string | undefined> };

/**
 * Fire-and-forget email sender.
 *
 * - If RESEND_API_KEY is set, POSTs to the Resend API.
 * - Otherwise logs the payload (dev mode).
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
  handler: async (_ctx, args) => {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      console.log(
        `[emails.send] RESEND_API_KEY not set — would send to=${args.to} ` +
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
