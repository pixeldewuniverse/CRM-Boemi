import "server-only";
import { and, asc, eq, gte, inArray, isNull, lt, ne, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { CurrentUser } from "@/lib/auth";
import { headedDepartments } from "@/lib/boards/access";
import { nextPeriod, periodStart, prevPeriod } from "@/lib/queries/sales";
import { ownedBy } from "@/lib/scope";
import { projectPerformance } from "./projects";

export const RANGES = { month: "This month", last: "Last month", quarter: "This quarter", year: "This year" } as const;
export type Range = keyof typeof RANGES;

/** [from, to) as yyyy-mm periods for a range, relative to `period` (the current month). */
export function rangePeriods(range: Range, period: string): { from: string; to: string; label: string } {
  const [y, m] = period.split("-").map(Number);
  if (range === "last") return { from: prevPeriod(period), to: period, label: RANGES.last };
  if (range === "quarter") {
    const q = Math.floor((m - 1) / 3) * 3 + 1;
    const from = `${y}-${String(q).padStart(2, "0")}`;
    return { from, to: nextPeriod(nextPeriod(nextPeriod(from))), label: `Q${(q + 2) / 3} ${y}` };
  }
  if (range === "year") return { from: `${y}-01`, to: `${y + 1}-01`, label: String(y) };
  return { from: period, to: nextPeriod(period), label: RANGES.month };
}

export type DeptKpi = {
  id: string;
  name: string;
  code: string;
  people: number;
  revenue: number;
  won: number;
  lost: number;
  winRate: number | null;
  leads: number;
  qualified: number;
  leadConversion: number | null;
  overdueTasks: number;
  overdueItems: number;
  projects: number;
  lateProjects: number;
  projectOnTime: number | null;
};

/**
 * KPI per department for a period. Admin & Executive see every department;
 * a Department Head sees the ones they head. People count to their own
 * department (not to its parent).
 */
export async function departmentKpis(user: CurrentUser, range: Range, period: string, today: string, nowDate: Date) {
  const db = getDb();
  const { from, to, label } = rangePeriods(range, period);
  const start = periodStart(from);
  const end = periodStart(to);
  const all = user.role === "admin" || user.role === "executive";
  const heads = all ? [] : await headedDepartments(user);
  const depts = await db
    .select({ id: schema.departments.id, name: schema.departments.name, code: schema.departments.code })
    .from(schema.departments)
    .where(all ? undefined : inArray(schema.departments.id, heads.length ? heads : ["00000000-0000-0000-0000-000000000000"]))
    .orderBy(asc(schema.departments.name));
  const deptIds = depts.map((d) => d.id);
  const members = deptIds.length
    ? await db.select({ id: schema.users.id, dept: schema.users.departmentId }).from(schema.users).where(and(eq(schema.users.active, true), inArray(schema.users.departmentId, deptIds)))
    : [];
  const ids = members.map((m) => m.id);
  const none = ["00000000-0000-0000-0000-000000000000"];
  const who = ids.length ? ids : none;
  const o = schema.opportunities;

  const [revenue, deals, leads, tasks, items, proj] = await Promise.all([
    db
      .select({ id: schema.orders.salesId, v: sql<number>`coalesce(sum(${schema.orders.total}),0)`.mapWith(Number) })
      .from(schema.orders)
      .where(and(inArray(schema.orders.salesId, who), ne(schema.orders.status, "cancelled"), gte(schema.orders.orderedAt, start), lt(schema.orders.orderedAt, end)))
      .groupBy(schema.orders.salesId),
    db
      .select({ id: o.ownerId, stage: o.stage, n: sql<number>`count(*)`.mapWith(Number) })
      .from(o)
      .where(and(inArray(o.ownerId, who), inArray(o.stage, ["won", "lost"]), gte(o.updatedAt, start), lt(o.updatedAt, end)))
      .groupBy(o.ownerId, o.stage),
    db
      .select({ id: schema.leads.ownerId, status: schema.leads.status, n: sql<number>`count(*)`.mapWith(Number) })
      .from(schema.leads)
      .where(and(inArray(schema.leads.ownerId, who), gte(schema.leads.receivedOn, `${from}-01`), lt(schema.leads.receivedOn, `${to}-01`)))
      .groupBy(schema.leads.ownerId, schema.leads.status),
    db
      .select({ id: schema.tasks.assigneeId, n: sql<number>`count(*)`.mapWith(Number) })
      .from(schema.tasks)
      .where(and(inArray(schema.tasks.assigneeId, who), inArray(schema.tasks.status, ["open", "in_progress", "waiting_approval"]), lt(schema.tasks.dueAt, nowDate)))
      .groupBy(schema.tasks.assigneeId),
    db
      .select({ id: schema.boardItemAssignees.userId, item: schema.boardItems.id })
      .from(schema.boardItems)
      .innerJoin(schema.boardItemAssignees, eq(schema.boardItemAssignees.itemId, schema.boardItems.id))
      .where(and(inArray(schema.boardItemAssignees.userId, who), isNull(schema.boardItems.completedAt), isNull(schema.boardItems.archivedAt), lt(schema.boardItems.dueOn, today))),
    projectPerformance(user, today),
  ]);

  const deptOf = new Map(members.map((m) => [m.id, m.dept]));
  const rows: DeptKpi[] = depts.map((d) => {
    const mine = (id: string | null) => Boolean(id && deptOf.get(id) === d.id);
    const won = deals.filter((x) => mine(x.id) && x.stage === "won").reduce((a, x) => a + x.n, 0);
    const lost = deals.filter((x) => mine(x.id) && x.stage === "lost").reduce((a, x) => a + x.n, 0);
    const l = leads.filter((x) => mine(x.id));
    const leadsN = l.reduce((a, x) => a + x.n, 0);
    const qualified = l.filter((x) => x.status === "qualified").reduce((a, x) => a + x.n, 0);
    const p = proj.departments.find((x) => x.departmentId === d.id);
    return {
      ...d,
      people: members.filter((m) => m.dept === d.id).length,
      revenue: revenue.filter((x) => mine(x.id)).reduce((a, x) => a + x.v, 0),
      won,
      lost,
      winRate: won + lost ? Math.round((won / (won + lost)) * 100) : null,
      leads: leadsN,
      qualified,
      leadConversion: leadsN ? Math.round((qualified / leadsN) * 100) : null,
      overdueTasks: tasks.filter((x) => mine(x.id)).reduce((a, x) => a + x.n, 0),
      overdueItems: new Set(items.filter((x) => mine(x.id)).map((x) => x.item)).size,
      projects: p?.projects ?? 0,
      lateProjects: p?.late ?? 0,
      projectOnTime: p?.onTimeRate ?? null,
    };
  });

  // Marketing: leads in the period (scoped like the Leads page) and what they cost.
  const [leadSources, events, campaigns] = await Promise.all([
    db
      .select({ source: schema.leads.source, status: schema.leads.status, n: sql<number>`count(*)`.mapWith(Number) })
      .from(schema.leads)
      .where(and(ownedBy(user, schema.leads.ownerId), gte(schema.leads.receivedOn, `${from}-01`), lt(schema.leads.receivedOn, `${to}-01`)))
      .groupBy(schema.leads.source, schema.leads.status),
    db
      .select({ v: sql<number>`coalesce(sum(${schema.events.actualCost}),0)`.mapWith(Number), n: sql<number>`count(*)`.mapWith(Number) })
      .from(schema.events)
      .where(and(gte(schema.events.heldOn, `${from}-01`), lt(schema.events.heldOn, `${to}-01`))),
    db
      .select({ v: sql<number>`coalesce(sum(${schema.campaigns.budget}),0)`.mapWith(Number), n: sql<number>`count(*)`.mapWith(Number) })
      .from(schema.campaigns)
      .where(and(gte(schema.campaigns.startsOn, `${from}-01`), lt(schema.campaigns.startsOn, `${to}-01`))),
  ]);
  const bySource = new Map<string, { leads: number; qualified: number }>();
  for (const r of leadSources) {
    const s = bySource.get(r.source) ?? { leads: 0, qualified: 0 };
    s.leads += r.n;
    if (r.status === "qualified") s.qualified += r.n;
    bySource.set(r.source, s);
  }
  const mLeads = [...bySource.values()].reduce((a, s) => a + s.leads, 0);
  const mQualified = [...bySource.values()].reduce((a, s) => a + s.qualified, 0);
  const cost = (events[0]?.v ?? 0) + (campaigns[0]?.v ?? 0);
  const marketing = {
    /** Event and campaign spend is company-wide, so cost per lead is only shown with company-wide leads. */
    costVisible: all,
    leads: mLeads,
    qualified: mQualified,
    eventCost: events[0]?.v ?? 0,
    events: events[0]?.n ?? 0,
    campaignBudget: campaigns[0]?.v ?? 0,
    campaigns: campaigns[0]?.n ?? 0,
    cost,
    costPerLead: mLeads ? Math.round(cost / mLeads) : null,
    costPerQualified: mQualified ? Math.round(cost / mQualified) : null,
    sources: [...bySource.entries()].map(([source, s]) => ({ source, ...s })).sort((a, b) => b.leads - a.leads),
  };
  return { label, from, to, rows, marketing, projects: proj.totals };
}
