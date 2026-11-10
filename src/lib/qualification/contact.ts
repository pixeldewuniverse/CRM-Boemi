import "server-only";
import { and, asc, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { CurrentUser } from "@/lib/auth";
import { notify } from "@/lib/notifications";
import { managersOf } from "@/lib/notifications/recipients";
import { ownedBy } from "@/lib/scope";
import { getSetting } from "@/lib/settings";
import { contactPriority, slaFor, type Tier } from "./core";

export const OPEN_LEAD = ["new", "contacted"] as const;

/**
 * Start of the current contact window: the last contact, otherwise when the
 * lead came in (its received date, 09:00 WIB, for imported/older leads).
 */
export function waitingSince(r: { lastContactedAt: Date | null; createdAt: Date; receivedOn: string }) {
  if (r.lastContactedAt) return r.lastContactedAt;
  const received = new Date(`${r.receivedOn}T09:00:00+07:00`);
  return received < r.createdAt ? received : r.createdAt;
}

/**
 * Contact Today: every open lead (new / contacted) in the user's scope,
 * ordered by score + aging boost + SLA. Nobody is filtered out — the score
 * only decides the order.
 */
export async function contactQueue(user: CurrentUser, now: Date) {
  const l = schema.leads;
  const sla = await getSetting("qualification");
  const rows = await getDb()
    .select({
      id: l.id,
      company: l.company,
      pic: l.picName,
      phone: l.phoneE164,
      email: l.email,
      segment: l.segment,
      city: l.city,
      source: l.source,
      status: l.status,
      score: l.qualificationScore,
      tier: l.qualificationTier,
      reason: l.qualificationReason,
      override: l.tierOverride,
      createdAt: l.createdAt,
      receivedOn: l.receivedOn,
      lastContactedAt: l.lastContactedAt,
      ownerId: l.ownerId,
      owner: schema.users.name,
    })
    .from(l)
    .leftJoin(schema.users, eq(schema.users.id, l.ownerId))
    .where(and(ownedBy(user, l.ownerId), inArray(l.status, [...OPEN_LEAD])))
    .orderBy(asc(l.createdAt))
    .limit(1000);
  return rows
    .map((r) => {
      const since = waitingSince(r);
      return { ...r, since, firstContact: !r.lastContactedAt, slaDays: slaFor(r.tier as Tier | null, sla), ...contactPriority({ score: r.score, tier: r.tier as Tier | null, since, now }, sla) };
    })
    .sort((a, b) => b.priority - a.priority || a.since.getTime() - b.since.getTime());
}

/** End of the current day in Asia/Jakarta. */
export function endOfDay(now: Date) {
  const day = new Date(now.getTime() + 7 * 3_600_000).toISOString().slice(0, 10);
  return new Date(`${day}T23:59:59+07:00`);
}

/** Count for badges / the dashboard card. */
export async function contactCounts(user: CurrentUser, now: Date) {
  const q = await contactQueue(user, now);
  const end = endOfDay(now);
  return { total: q.length, overdue: q.filter((x) => x.overdue).length, dueToday: q.filter((x) => !x.overdue && x.due <= end).length, top: q.slice(0, 5) };
}

/**
 * Cron (hourly): lead past its SLA → tell the owner once per contact window;
 * still waiting one day later → tell their manager(s). Unassigned leads go to
 * the managers of Sales.
 */
export async function leadSlaJob() {
  const db = getDb();
  const l = schema.leads;
  const now = new Date();
  const sla = await getSetting("qualification");
  const rows = await db
    .select({ id: l.id, company: l.company, tier: l.qualificationTier, ownerId: l.ownerId, createdAt: l.createdAt, receivedOn: l.receivedOn, lastContactedAt: l.lastContactedAt, notified: l.slaNotifiedAt, escalated: l.slaEscalatedAt })
    .from(l)
    .where(inArray(l.status, [...OPEN_LEAD]))
    .limit(2000);
  let reminded = 0;
  let escalated = 0;
  for (const r of rows) {
    const since = waitingSince(r);
    const days = slaFor(r.tier as Tier | null, sla);
    const due = new Date(since.getTime() + days * 86_400_000);
    if (now <= due) continue;
    const tierLabel = r.tier ? `${r.tier[0].toUpperCase()}${r.tier.slice(1)}` : "Unscored";
    const what = r.lastContactedAt ? "follow-up" : "first contact";
    if (!r.notified || r.notified < since) {
      const to = r.ownerId ? [r.ownerId] : await managersOf(null);
      await notify({ userIds: to, type: "lead.sla", title: `Contact ${r.company} — ${what} overdue`, body: `${tierLabel} lead: contact within ${days} day${days === 1 ? "" : "s"}. It's in Contact Today.`, link: "/sales/contact-today" });
      await db.update(l).set({ slaNotifiedAt: now }).where(eq(l.id, r.id));
      reminded++;
    } else if (r.ownerId && now.getTime() > due.getTime() + 86_400_000 && (!r.escalated || r.escalated < since)) {
      await notify({ userIds: await managersOf(r.ownerId, [r.ownerId]), type: "lead.sla", title: `Still not contacted: ${r.company}`, body: `${tierLabel} lead is more than a day past its ${days}-day SLA.`, link: "/sales/contact-today" });
      await db.update(l).set({ slaEscalatedAt: now }).where(eq(l.id, r.id));
      escalated++;
    }
  }
  return { checked: rows.length, reminded, escalated };
}
