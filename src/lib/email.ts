import "server-only";
import nodemailer, { type Transporter } from "nodemailer";

/**
 * SMTP email. Works with Google Workspace (smtp-relay.gmail.com or
 * smtp.gmail.com + app password) or any SMTP provider.
 * If SMTP_HOST is not set, emails are logged instead of sent (staging).
 */
let transporter: Transporter | null | undefined;

function getTransporter(): Transporter | null {
  if (transporter !== undefined) return transporter;
  const host = process.env.SMTP_HOST;
  if (!host) {
    transporter = null;
    return null;
  }
  transporter = nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: Number(process.env.SMTP_PORT ?? 587) === 465,
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
      : undefined,
  });
  return transporter;
}

export async function sendEmail(message: {
  to: string;
  subject: string;
  text: string;
  html?: string;
}): Promise<boolean> {
  const t = getTransporter();
  if (!t) {
    console.info(`[email:dry-run] to=${message.to} subject="${message.subject}"`);
    return false;
  }
  await t.sendMail({
    from: process.env.EMAIL_FROM ?? "Sales & Marketing Tools <no-reply@localhost>",
    ...message,
  });
  return true;
}
