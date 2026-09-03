"use node";

import { v } from "convex/values";
import nodemailer from "nodemailer";
import { internalAction } from "./_generated/server";

/**
 * SMTP delivery. Node runtime, because SMTP needs raw TCP/TLS sockets that the
 * default Convex V8 runtime does not provide.
 *
 * Config (deployment env vars, never in the repo):
 *   SMTP_HOST  default smtp.gmail.com
 *   SMTP_PORT  default 465 (implicit TLS)
 *   SMTP_USER  the mailbox to authenticate and send as
 *   SMTP_PASS  app password, not the account password
 *   SMTP_FROM  optional display form, defaults to "TerpTA <SMTP_USER>"
 *
 * Throws on failure; convex/emails.ts owns the never-break-the-caller policy.
 */
export const sendMail = internalAction({
  args: { to: v.string(), subject: v.string(), text: v.string() },
  returns: v.string(),
  handler: async (_ctx, args) => {
    const host = process.env.SMTP_HOST ?? "smtp.gmail.com";
    const port = Number(process.env.SMTP_PORT ?? 465);
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    if (!user || !pass) {
      throw new Error("SMTP_USER / SMTP_PASS are not set on this deployment");
    }

    const transport = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
    });

    const info = await transport.sendMail({
      from: process.env.SMTP_FROM ?? `TerpTA <${user}>`,
      to: args.to,
      subject: args.subject,
      text: args.text,
    });
    return info.messageId ?? "sent";
  },
});
