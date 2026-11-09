"use server";

import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { verifyUser } from "@/lib/auth";
import { isPushEndpoint, pushReady, sendPush } from "@/lib/push";

const Subscription = z.object({
  endpoint: z.url().max(1000),
  keys: z.object({ p256dh: z.string().min(20).max(200), auth: z.string().min(8).max(100) }),
  device: z.string().max(120).optional(),
});

export type PushResult = { ok: true; sent?: number } | { ok: false; error: string };

/** Save (or move to the current user) this browser's push subscription. */
export async function savePushSubscription(input: z.input<typeof Subscription>): Promise<PushResult> {
  const user = await verifyUser();
  const parsed = Subscription.safeParse(input);
  if (!parsed.success || !isPushEndpoint(parsed.data.endpoint)) return { ok: false, error: "This browser's push service is not supported." };
  const { endpoint, keys, device } = parsed.data;
  await getDb()
    .insert(schema.pushSubscriptions)
    .values({ userId: user.id, endpoint, p256dh: keys.p256dh, auth: keys.auth, device })
    .onConflictDoUpdate({
      target: schema.pushSubscriptions.endpoint,
      set: { userId: user.id, p256dh: keys.p256dh, auth: keys.auth, device },
    });
  return { ok: true };
}

export async function removePushSubscription(endpoint: string): Promise<PushResult> {
  const user = await verifyUser();
  await getDb()
    .delete(schema.pushSubscriptions)
    .where(and(eq(schema.pushSubscriptions.endpoint, String(endpoint).slice(0, 1000)), eq(schema.pushSubscriptions.userId, user.id)));
  return { ok: true };
}

export async function sendTestPush(): Promise<PushResult> {
  const user = await verifyUser();
  if (!pushReady()) return { ok: false, error: "Push is not configured on the server yet." };
  const { sent } = await sendPush([user.id], {
    title: "Notifications are on",
    body: "You'll get updates, approvals and deadlines here.",
    url: "/notifications",
  });
  return sent ? { ok: true, sent } : { ok: false, error: "No device received it. Try turning notifications off and on again." };
}
