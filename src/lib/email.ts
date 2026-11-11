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
    html: message.html ?? brandedHtml(message.subject, message.text),
  });
  return true;
}

const esc = (v: string) => v.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/**
 * Plain-text email wrapped in the BOEMI letterhead (logo, leaf-green rule,
 * charcoal text). Inline styles only — email clients ignore stylesheets.
 * The logo is the public PNG at APP_URL/brand (SVG isn't shown by Gmail).
 */
export function brandedHtml(subject: string, text: string): string {
  const app = (process.env.APP_URL ?? "").replace(/\/$/, "");
  const body = esc(text)
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 14px">${p.replace(/\n/g, "<br>").replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" style="color:#616b37">$1</a>')}</p>`)
    .join("");
  const logo = app
    ? `<img src="${app}/brand/boemi-botanicals.png" width="160" alt="BOEMI Botanicals" style="display:block;border:0;width:160px;height:auto">`
    : `<span style="font-family:Georgia,serif;font-size:22px;letter-spacing:4px;color:#616b37">BOEMI</span>`;
  return `<!doctype html><html><body style="margin:0;background:#f6f3ec;font-family:Arial,Helvetica,sans-serif;color:#1d2124">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f3ec;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;border-top:4px solid #616b37">
<tr><td style="padding:24px 28px 8px">${logo}</td></tr>
<tr><td style="padding:8px 28px 4px;font-size:18px;font-weight:bold">${esc(subject)}</td></tr>
<tr><td style="padding:8px 28px 20px;font-size:14px;line-height:1.55">${body}</td></tr>
<tr><td style="padding:14px 28px;border-top:1px solid #e0d9cb;font-size:12px;color:#625d54">BOEMI Sales &amp; Marketing Tools</td></tr>
</table></td></tr></table></body></html>`;
}
