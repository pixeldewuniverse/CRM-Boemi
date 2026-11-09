import "server-only";
import { eq, inArray } from "drizzle-orm";
import webpush, { WebPushError } from "web-push";
import { getDb, schema } from "@/db";

/**
 * Web Push (VAPID) — free, no vendor: the browser's own push service
 * (Google for Chrome/Android, Apple for Safari/iPhone, Mozilla for Firefox)
 * delivers the message to the phone or laptop, even when the app is closed.
 */
export type PushPayload = { title: string; body?: string; url?: string; tag?: string };

let configured: boolean | undefined;

export function pushPublicKey(): string | null {
  return process.env.VAPID_PUBLIC_KEY || null;
}

export function pushReady(): boolean {
  if (configured !== undefined) return configured;
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return (configured = false);
  try {
    webpush.setVapidDetails(process.env.VAPID_SUBJECT || process.env.APP_URL || "mailto:admin@example.com", pub, priv);
    configured = true;
  } catch (err) {
    console.error("Invalid VAPID keys — push disabled", err);
    configured = false;
  }
  return configured;
}

/** Only real browser push services, so the server never posts to arbitrary URLs. */
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /(^|\.)notify\.windows\.com$/, /(^|\.)push\.apple\.com$/];

export function isPushEndpoint(endpoint: string): boolean {
  try {
    const u = new URL(endpoint);
    return u.protocol === "https:" && PUSH_HOSTS.some((h) => h.test(u.hostname));
  } catch {
    return false;
  }
}

/** Send to every device of the given users. Expired subscriptions are removed. */
export async function sendPush(userIds: string[], payload: PushPayload): Promise<{ sent: number; removed: number }> {
  if (!userIds.length || !pushReady()) return { sent: 0, removed: 0 };
  const db = getDb();
  const subs = await db.select().from(schema.pushSubscriptions).where(inArray(schema.pushSubscriptions.userId, userIds));
  const body = JSON.stringify(payload);
  let sent = 0;
  const dead: string[] = [];

  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, {
          TTL: 60 * 60 * 24,
          urgency: "normal",
          timeout: 10_000,
        });
        sent++;
        await db.update(schema.pushSubscriptions).set({ lastSuccessAt: new Date() }).where(eq(schema.pushSubscriptions.id, s.id));
      } catch (err) {
        if (err instanceof WebPushError && (err.statusCode === 404 || err.statusCode === 410)) dead.push(s.id);
        else console.error("push failed", err instanceof WebPushError ? err.statusCode : err);
      }
    }),
  );
  if (dead.length) await db.delete(schema.pushSubscriptions).where(inArray(schema.pushSubscriptions.id, dead));
  return { sent, removed: dead.length };
}
