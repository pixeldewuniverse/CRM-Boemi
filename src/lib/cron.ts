import "server-only";
import { timingSafeEqual } from "node:crypto";
import { and, eq, inArray, isNull, lt, lte, or } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { fdatetime } from "@/lib/format";
import { notify } from "@/lib/notifications";

/**
 * Scheduled jobs are plain HTTP endpoints protected by CRON_SECRET:
 *   staging    → Vercel Cron (sends "Authorization: Bearer $CRON_SECRET")
 *   production → Google Cloud Scheduler (same header)
 */
export function isAuthorizedCron(authorization: string | null): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || !authorization) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const given = Buffer.from(authorization);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

const HOUR = 60 * 60 * 1000;

/** Daily: reminders for tasks due within 24h and overdue tasks. */
async function taskReminders() {
  const db = getDb();
  const now = new Date();
  const in24h = new Date(now.getTime() + 24 * HOUR);
  const remindedBefore = new Date(now.getTime() - 20 * HOUR);

  const due = await db
    .select({
      id: schema.tasks.id,
      title: schema.tasks.title,
      assigneeId: schema.tasks.assigneeId,
      dueAt: schema.tasks.dueAt,
    })
    .from(schema.tasks)
    .where(
      and(
        inArray(schema.tasks.status, ["open", "in_progress"]),
        lte(schema.tasks.dueAt, in24h),
        or(
          isNull(schema.tasks.lastReminderAt),
          lt(schema.tasks.lastReminderAt, remindedBefore),
        ),
      ),
    )
    .limit(500);

  for (const task of due) {
    const overdue = task.dueAt !== null && task.dueAt < now;
    await notify({
      userIds: [task.assigneeId],
      type: overdue ? "task.overdue" : "task.due_soon",
      title: overdue ? `Overdue: ${task.title}` : `Due soon: ${task.title}`,
      body: task.dueAt
        ? `Due ${fdatetime(task.dueAt)}`
        : undefined,
      link: "/sales/tasks",
    });
    await db
      .update(schema.tasks)
      .set({ lastReminderAt: now })
      .where(eq(schema.tasks.id, task.id));
  }

  return { reminded: due.length };
}

/** Daily: reminds approvers about visit fees pending longer than 24h. */
async function pendingVisitFees() {
  const db = getDb();
  const olderThan = new Date(Date.now() - 24 * HOUR);

  const pending = await db
    .select({ id: schema.visitFees.id })
    .from(schema.visitFees)
    .where(
      and(
        eq(schema.visitFees.status, "pending"),
        lt(schema.visitFees.createdAt, olderThan),
      ),
    );
  if (pending.length === 0) return { pending: 0 };

  const approvers = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(
      and(
        eq(schema.users.active, true),
        inArray(schema.users.role, ["finance", "sales_manager"]),
      ),
    );

  await notify({
    userIds: approvers.map((a) => a.id),
    type: "visit_fee.pending",
    title: `${pending.length} visit fee(s) waiting for approval`,
    link: "/sales/visits",
  });
  return { pending: pending.length };
}

export const CRON_JOBS: Record<string, () => Promise<Record<string, unknown>>> = {
  "task-reminders": taskReminders,
  "pending-visit-fees": pendingVisitFees,
};
