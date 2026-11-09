import "server-only";
import { and, eq, gte, inArray, lt, ne, notInArray, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";

/** First instant of a YYYY-MM period in Jakarta time. */
export const periodStart = (period: string) => new Date(`${period}-01T00:00:00+07:00`);
export const nextPeriod = (period: string) => {
  const [y, m] = period.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
};
export const prevPeriod = (period: string) => {
  const [y, m] = period.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
};

/** Per-rep KPIs for one month (revenue excludes cancelled orders, incl. PPN). */
export async function repKpis(period: string) {
  const db = getDb();
  const start = periodStart(period);
  const end = periodStart(nextPeriod(period));
  const prevStart = periodStart(prevPeriod(period));
  const u = schema.users;
  const o = schema.orders;

  const reps = await db
    .select({ id: u.id, name: u.name, region: u.region, role: u.role })
    .from(u)
    .where(and(inArray(u.role, ["sales", "sales_manager"]), eq(u.active, true)))
    .orderBy(u.name);
  const ids = reps.map((r) => r.id);
  if (!ids.length) return [];

  const [targets, revenue, prevRevenue, pipeline, won, visits, done, overdue] = await Promise.all([
    db
      .select({ id: schema.kpiTargets.userId, metric: schema.kpiTargets.metric, target: schema.kpiTargets.target })
      .from(schema.kpiTargets)
      .where(and(inArray(schema.kpiTargets.userId, ids), eq(schema.kpiTargets.period, period))),
    db
      .select({ id: o.salesId, value: sql<number>`sum(${o.total})`.mapWith(Number), n: sql<number>`count(*)`.mapWith(Number) })
      .from(o)
      .where(and(gte(o.orderedAt, start), lt(o.orderedAt, end), ne(o.status, "cancelled")))
      .groupBy(o.salesId),
    db
      .select({ id: o.salesId, value: sql<number>`sum(${o.total})`.mapWith(Number) })
      .from(o)
      .where(and(gte(o.orderedAt, prevStart), lt(o.orderedAt, start), ne(o.status, "cancelled")))
      .groupBy(o.salesId),
    db
      .select({
        id: schema.opportunities.ownerId,
        value: sql<number>`sum(${schema.opportunities.value})`.mapWith(Number),
        n: sql<number>`count(*)`.mapWith(Number),
      })
      .from(schema.opportunities)
      .where(notInArray(schema.opportunities.stage, ["won", "lost"]))
      .groupBy(schema.opportunities.ownerId),
    db
      .select({ id: schema.opportunities.ownerId, n: sql<number>`count(*)`.mapWith(Number) })
      .from(schema.opportunities)
      .where(eq(schema.opportunities.stage, "won"))
      .groupBy(schema.opportunities.ownerId),
    db
      .select({ id: schema.visits.salesId, n: sql<number>`count(*)`.mapWith(Number) })
      .from(schema.visits)
      .where(and(gte(schema.visits.checkedInAt, start), lt(schema.visits.checkedInAt, end)))
      .groupBy(schema.visits.salesId),
    db
      .select({ id: schema.tasks.assigneeId, n: sql<number>`count(*)`.mapWith(Number) })
      .from(schema.tasks)
      .where(and(eq(schema.tasks.status, "done"), gte(schema.tasks.completedAt, new Date(start.getTime() - 30 * 86_400_000))))
      .groupBy(schema.tasks.assigneeId),
    db
      .select({ id: schema.tasks.assigneeId, n: sql<number>`count(*)`.mapWith(Number) })
      .from(schema.tasks)
      .where(and(inArray(schema.tasks.status, ["open", "in_progress", "waiting_approval"]), lt(schema.tasks.dueAt, new Date())))
      .groupBy(schema.tasks.assigneeId),
  ]);

  const by = <T extends { id: string | null }>(rows: T[]) => new Map(rows.map((r) => [r.id, r]));
  const rev = by(revenue), prev = by(prevRevenue), pipe = by(pipeline), w = by(won), vis = by(visits), dn = by(done), od = by(overdue);

  return reps.map((r) => {
    const t = targets.filter((x) => x.id === r.id);
    return {
      ...r,
      revenueTarget: t.find((x) => x.metric === "revenue")?.target ?? 0,
      visitTarget: t.find((x) => x.metric === "visits")?.target ?? 0,
      revenue: rev.get(r.id)?.value ?? 0,
      orders: rev.get(r.id)?.n ?? 0,
      lastMonthRevenue: prev.get(r.id)?.value ?? 0,
      pipelineValue: pipe.get(r.id)?.value ?? 0,
      openDeals: pipe.get(r.id)?.n ?? 0,
      dealsWon: w.get(r.id)?.n ?? 0,
      visits: vis.get(r.id)?.n ?? 0,
      activitiesDone: dn.get(r.id)?.n ?? 0,
      overdue: od.get(r.id)?.n ?? 0,
    };
  });
}

/** Monthly revenue by account segment for the last `months` months (incl. current). */
export async function revenueBySegment(currentPeriod: string, months = 12, salesId?: string) {
  const periods: string[] = [currentPeriod];
  while (periods.length < months) periods.unshift(prevPeriod(periods[0]));
  const db = getDb();
  const o = schema.orders;
  const monthExpr = sql<string>`to_char(${o.orderedAt} at time zone 'Asia/Jakarta', 'YYYY-MM')`;
  const rows = await db
    .select({ month: monthExpr, segment: schema.customers.businessType, value: sql<number>`sum(${o.total})`.mapWith(Number) })
    .from(o)
    .innerJoin(schema.customers, eq(schema.customers.id, o.customerId))
    .where(
      and(
        gte(o.orderedAt, periodStart(periods[0])),
        lt(o.orderedAt, periodStart(nextPeriod(currentPeriod))),
        ne(o.status, "cancelled"),
        salesId ? eq(o.salesId, salesId) : undefined,
      ),
    )
    .groupBy(monthExpr, schema.customers.businessType);
  return { periods, rows };
}
