import "server-only";
import { timingSafeEqual } from "node:crypto";
import { and, eq, gte, inArray, isNull, lt, lte, ne, or, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { fday, fdatetime, rpk, ymd } from "@/lib/format";
import { nextPeriod, periodStart } from "@/lib/queries/sales";
import { audit } from "@/lib/audit";
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

/** Daily: reminds approvers about requests (visit fees, discounts…) waiting longer than 24h. */
async function pendingVisitFees() {
  const db = getDb();
  const olderThan = new Date(Date.now() - 24 * HOUR);
  const rows = await db
    .select({ approvers: schema.approvalActions.approverIds })
    .from(schema.approvalRequests)
    .innerJoin(schema.approvalActions, and(eq(schema.approvalActions.requestId, schema.approvalRequests.id), eq(schema.approvalActions.position, schema.approvalRequests.currentStep)))
    .where(and(eq(schema.approvalRequests.status, "pending"), lt(schema.approvalRequests.createdAt, olderThan)));
  if (rows.length === 0) return { pending: 0 };
  const perUser = new Map<string, number>();
  for (const r of rows) for (const id of r.approvers) perUser.set(id, (perUser.get(id) ?? 0) + 1);
  for (const [userId, n] of perUser) {
    await notify({ userIds: [userId], type: "approval.requested", title: `${n} request(s) waiting for your approval`, body: "Waiting more than a day.", link: "/approvals" });
  }
  return { pending: rows.length, reminded: perUser.size };
}

/** Daily (06:30 WIB): one summary for Executives and Sales Managers. */
async function dailyDigest() {
  const db = getDb();
  const now = new Date();
  const today = ymd(now);
  const startToday = new Date(`${today}T00:00:00+07:00`);
  const startYesterday = new Date(startToday.getTime() - 24 * HOUR);
  const period = today.slice(0, 7);
  const o = schema.orders;

  const recipients = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(and(eq(schema.users.active, true), inArray(schema.users.role, ["executive", "sales_manager"])));
  if (!recipients.length) return { sent: 0 };

  // Once per day, even if the job is triggered twice.
  const already = await db
    .select({ userId: schema.notifications.userId })
    .from(schema.notifications)
    .where(and(eq(schema.notifications.type, "digest.daily"), gte(schema.notifications.createdAt, startToday)));
  const done = new Set(already.map((r) => r.userId));
  const to = recipients.map((r) => r.id).filter((id) => !done.has(id));
  if (!to.length) return { sent: 0, skipped: "already sent today" };

  const sumOrders = (from: Date, until: Date) =>
    db
      .select({ v: sql<number>`coalesce(sum(${o.total}),0)`.mapWith(Number), n: sql<number>`count(*)`.mapWith(Number) })
      .from(o)
      .where(and(gte(o.orderedAt, from), lt(o.orderedAt, until), ne(o.status, "cancelled")));
  const count = (q: Promise<{ n: number }[]>) => q.then((r) => r[0]?.n ?? 0);

  const [[yesterday], [mtd], [target], won, newLeads, visits, [fees], overdue] = await Promise.all([
    sumOrders(startYesterday, startToday),
    sumOrders(periodStart(period), periodStart(nextPeriod(period))),
    db
      .select({ v: sql<number>`coalesce(sum(${schema.kpiTargets.target}),0)`.mapWith(Number) })
      .from(schema.kpiTargets)
      .where(and(eq(schema.kpiTargets.metric, "revenue"), eq(schema.kpiTargets.period, period))),
    count(
      db
        .select({ n: sql<number>`count(*)`.mapWith(Number) })
        .from(schema.opportunities)
        .where(and(eq(schema.opportunities.stage, "won"), gte(schema.opportunities.updatedAt, startYesterday), lt(schema.opportunities.updatedAt, startToday))),
    ),
    count(
      db
        .select({ n: sql<number>`count(*)`.mapWith(Number) })
        .from(schema.leads)
        .where(and(gte(schema.leads.createdAt, startYesterday), lt(schema.leads.createdAt, startToday))),
    ),
    count(
      db
        .select({ n: sql<number>`count(*)`.mapWith(Number) })
        .from(schema.visits)
        .where(and(gte(schema.visits.checkedInAt, startYesterday), lt(schema.visits.checkedInAt, startToday))),
    ),
    db
      .select({ n: sql<number>`count(*)`.mapWith(Number), v: sql<number>`coalesce(sum(${schema.visitFees.amount}),0)`.mapWith(Number) })
      .from(schema.visitFees)
      .where(eq(schema.visitFees.status, "pending")),
    count(
      db
        .select({ n: sql<number>`count(*)`.mapWith(Number) })
        .from(schema.tasks)
        .where(and(inArray(schema.tasks.status, ["open", "in_progress", "waiting_approval"]), lt(schema.tasks.dueAt, now))),
    ),
  ]);

  const pctOfTarget = target.v ? ` (${Math.round((mtd.v / target.v) * 100)}% of target)` : "";
  const lines = [
    `Revenue yesterday ${rpk(yesterday.v)} from ${yesterday.n} orders`,
    `Month to date ${rpk(mtd.v)}${pctOfTarget}`,
    `${won} deals won · ${newLeads} new leads · ${visits} visits`,
    `${fees.n} visit fees to approve${fees.n ? ` (${rpk(fees.v)})` : ""} · ${overdue} overdue tasks`,
  ];
  await notify({
    userIds: to,
    type: "digest.daily",
    title: `Daily summary · ${fday(startYesterday)}`,
    body: lines.join("\n"),
    link: "/dashboard",
  });
  return { sent: to.length };
}

/** Daily: sent quotations past their valid-until date become expired. */
async function expireQuotations() {
  const db = getDb();
  const today = ymd(new Date());
  const expired = await db
    .update(schema.quotations)
    .set({ status: "expired", decidedAt: new Date() })
    .where(and(eq(schema.quotations.status, "sent"), lt(schema.quotations.validUntil, today)))
    .returning({ id: schema.quotations.id, quoteNo: schema.quotations.quoteNo, ownerId: schema.quotations.ownerId });
  for (const q of expired) {
    await audit({ actorId: null, action: "expire", entity: "quotation", entityId: q.quoteNo, changes: { status: ["sent", "expired"] } });
  }
  return { expired: expired.length };
}

export const CRON_JOBS: Record<string, () => Promise<Record<string, unknown>>> = {
  "task-reminders": taskReminders,
  "pending-visit-fees": pendingVisitFees,
  "daily-digest": dailyDigest,
  "expire-quotations": expireQuotations,
};
