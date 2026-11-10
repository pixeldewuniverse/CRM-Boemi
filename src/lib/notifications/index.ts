import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { sendEmail } from "@/lib/email";
import { sendPush } from "@/lib/push";

/**
 * Notification types. Channels: in-app, email and push (phone/laptop).
 * (Google Chat / Calendar can be added as extra channels once BOEMI's
 * Google Workspace is confirmed — only `deliver()` needs to change.)
 */
export const NOTIFICATION_TYPES = {
  "task.assigned": { label: "Task assigned to you", emailDefault: true },
  "task.due_soon": { label: "Task due within 24 hours", emailDefault: true },
  "task.overdue": { label: "Task overdue", emailDefault: true },
  "visit_fee.pending": { label: "Visit fee waiting for approval", emailDefault: true },
  "visit_fee.decided": { label: "Your visit fee was approved/rejected", emailDefault: true },
  "opportunity.stage_changed": { label: "Opportunity stage changed", emailDefault: false },
  "lead.hot": { label: "New lead assigned to you", emailDefault: true },
  "lead.new": { label: "New lead added by your team", emailDefault: false },
  "lead.journey": { label: "New leads from the aroma journey", emailDefault: false },
  "lead.qualified": { label: "Lead qualified by your team", emailDefault: false },
  "deal.won": { label: "Deal won", emailDefault: true },
  "deal.lost": { label: "Deal lost", emailDefault: true },
  "content.your_turn": { label: "Content waiting for you", emailDefault: true },
  "content.update": { label: "Content status changed", emailDefault: false },
  "digest.daily": { label: "Daily summary", emailDefault: true },
  "quote.approval": { label: "Quotation discount needs approval", emailDefault: true },
  "quote.decided": { label: "Quotation discount approved/rejected", emailDefault: true },
  "quote.accepted": { label: "Quotation accepted by the customer", emailDefault: false },
  "order.payment": { label: "Payment recorded on your order", emailDefault: false },
} as const;

export type NotificationType = keyof typeof NOTIFICATION_TYPES;

export type NotifyInput = {
  userIds: string[];
  type: NotificationType;
  title: string;
  body?: string;
  link?: string;
};

export async function notify(input: NotifyInput): Promise<void> {
  const userIds = [...new Set(input.userIds)];
  if (userIds.length === 0) return;
  const db = getDb();

  const [recipients, prefs] = await Promise.all([
    db
      .select({ id: schema.users.id, email: schema.users.email })
      .from(schema.users)
      .where(and(inArray(schema.users.id, userIds), eq(schema.users.active, true))),
    db
      .select()
      .from(schema.notificationPreferences)
      .where(
        and(
          inArray(schema.notificationPreferences.userId, userIds),
          eq(schema.notificationPreferences.type, input.type),
        ),
      ),
  ]);

  const prefByUser = new Map(prefs.map((p) => [p.userId, p]));
  const emailDefault = NOTIFICATION_TYPES[input.type].emailDefault;

  const pushTo: string[] = [];
  for (const user of recipients) {
    const pref = prefByUser.get(user.id);
    const wantsInApp = pref?.inApp ?? true;
    const wantsEmail = pref?.email ?? emailDefault;
    if (pref?.push ?? true) pushTo.push(user.id);

    let notificationId: string | null = null;
    if (wantsInApp) {
      const [row] = await db
        .insert(schema.notifications)
        .values({
          userId: user.id,
          type: input.type,
          title: input.title,
          body: input.body,
          link: input.link,
        })
        .returning({ id: schema.notifications.id });
      notificationId = row.id;
    }

    if (wantsEmail) {
      try {
        const appUrl = process.env.APP_URL ?? "";
        const sent = await sendEmail({
          to: user.email,
          subject: input.title,
          text: [input.body, input.link ? `${appUrl}${input.link}` : null]
            .filter(Boolean)
            .join("\n\n"),
        });
        if (sent && notificationId) {
          await db
            .update(schema.notifications)
            .set({ emailedAt: new Date() })
            .where(eq(schema.notifications.id, notificationId));
        }
      } catch (err) {
        // In-app notification is already stored; email failure is non-fatal.
        console.error("notification email failed", err);
      }
    }
  }

  try {
    await sendPush(pushTo, { title: input.title, body: input.body, url: input.link ?? "/notifications" });
  } catch (err) {
    console.error("notification push failed", err);
  }
}
