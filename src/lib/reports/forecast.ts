import "server-only";
import { and, asc, eq, gte, inArray, lt, ne, notInArray, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { CurrentUser } from "@/lib/auth";
import { STAGE } from "@/lib/labels";
import { nextPeriod, periodStart } from "@/lib/queries/sales";
import { ownedBy, visibleUserIds } from "@/lib/scope";
import { getSetting } from "@/lib/settings";

export const OPEN_STAGES = ["new", "contacted", "sampling", "quotation", "negotiation"] as const;
/** Deals at or above this probability count as "commit". */
export const COMMIT_AT = 75;

export type Probabilities = Record<string, number>;

/** Stage defaults from Master Data (won 100, lost 0). */
export async function stageProbabilities(): Promise<Probabilities> {
  const s = await getSetting("pipeline");
  return { ...s, won: 100, lost: 0 };
}

export const effectiveProbability = (d: { stage: string; probability: number | null; probabilityOverride: boolean }, probs: Probabilities) =>
  d.stage === "won" ? 100 : d.stage === "lost" ? 0 : d.probabilityOverride && d.probability != null ? d.probability : (probs[d.stage] ?? STAGE[d.stage]?.probability ?? 0);

export type Bucket = { target: number; actual: number; weighted: number; commit: number; best: number; deals: number };
const empty = (): Bucket => ({ target: 0, actual: 0, weighted: 0, commit: 0, best: 0, deals: 0 });
const add = (a: Bucket, b: Partial<Bucket>) => {
  for (const k of Object.keys(b) as (keyof Bucket)[]) a[k] += b[k] ?? 0;
};
export const projected = (b: Bucket) => b.actual + b.weighted;

export type ForecastDeal = {
  id: string;
  title: string;
  account: string;
  ownerId: string;
  owner: string;
  stage: string;
  value: number;
  probability: number;
  override: boolean;
  weighted: number;
  closeOn: string | null;
  /** yyyy-mm, "overdue" (close date before the horizon) or "none". */
  bucket: string;
};

/**
 * Sales forecast for `months` months starting at `from` (yyyy-mm):
 * target (kpi_targets "revenue"), actual (orders excl. cancelled),
 * best case (all open deals), commit (open deals ≥ COMMIT_AT %) and
 * weighted (value × probability), per month and per rep. Scoped like the
 * pipeline: own deals for reps, the team for department heads.
 */
export async function salesForecast(user: CurrentUser, from: string, months: number, repId?: string) {
  const db = getDb();
  const periods: string[] = [from];
  while (periods.length < months) periods.push(nextPeriod(periods[periods.length - 1]));
  const end = nextPeriod(periods[periods.length - 1]);
  const visible = await visibleUserIds(user);
  const probs = await stageProbabilities();
  const o = schema.opportunities;
  const ord = schema.orders;

  const reps = (
    await db
      .select({ id: schema.users.id, name: schema.users.name })
      .from(schema.users)
      .where(and(eq(schema.users.active, true), inArray(schema.users.role, ["sales", "sales_manager"])))
      .orderBy(asc(schema.users.name))
  ).filter((r) => !visible || visible.has(r.id));
  const repFilter = repId && reps.some((r) => r.id === repId) ? repId : undefined;

  const [deals, actuals, targets] = await Promise.all([
    db
      .select({ id: o.id, title: o.title, stage: o.stage, value: o.value, probability: o.probability, probabilityOverride: o.probabilityOverride, closeOn: o.expectedCloseOn, ownerId: o.ownerId, owner: schema.users.name, account: schema.customers.name })
      .from(o)
      .innerJoin(schema.customers, eq(schema.customers.id, o.customerId))
      .innerJoin(schema.users, eq(schema.users.id, o.ownerId))
      .where(and(ownedBy(user, o.ownerId), notInArray(o.stage, ["won", "lost"]), repFilter ? eq(o.ownerId, repFilter) : undefined))
      .orderBy(asc(o.expectedCloseOn)),
    db
      .select({ id: ord.salesId, period: sql<string>`to_char(${ord.orderedAt} at time zone 'Asia/Jakarta', 'YYYY-MM')`, value: sql<number>`coalesce(sum(${ord.total}), 0)`.mapWith(Number) })
      .from(ord)
      .where(and(ownedBy(user, ord.salesId), ne(ord.status, "cancelled"), gte(ord.orderedAt, periodStart(from)), lt(ord.orderedAt, periodStart(end)), repFilter ? eq(ord.salesId, repFilter) : undefined))
      .groupBy(ord.salesId, sql`2`),
    db
      .select({ id: schema.kpiTargets.userId, period: schema.kpiTargets.period, value: schema.kpiTargets.target })
      .from(schema.kpiTargets)
      .where(and(ownedBy(user, schema.kpiTargets.userId), eq(schema.kpiTargets.metric, "revenue"), inArray(schema.kpiTargets.period, periods), repFilter ? eq(schema.kpiTargets.userId, repFilter) : undefined)),
  ]);

  const byMonth = new Map(periods.map((p) => [p, empty()]));
  const byRep = new Map<string, { id: string; name: string; total: Bucket; months: Map<string, Bucket> }>();
  const repRow = (id: string | null, name?: string) => {
    const key = id ?? "";
    if (!byRep.has(key)) byRep.set(key, { id: key, name: name ?? reps.find((r) => r.id === id)?.name ?? "Unassigned", total: empty(), months: new Map(periods.map((p) => [p, empty()])) });
    return byRep.get(key)!;
  };
  for (const r of reps.filter((r) => !repFilter || r.id === repFilter)) repRow(r.id, r.name);

  const list: ForecastDeal[] = deals.map((d) => {
    const p = effectiveProbability(d, probs);
    const value = d.value ?? 0;
    const m = d.closeOn?.slice(0, 7) ?? null;
    const bucket = !m ? "none" : m < from ? "overdue" : m;
    return { id: d.id, title: d.title, account: d.account, ownerId: d.ownerId, owner: d.owner, stage: d.stage, value, probability: p, override: d.probabilityOverride, weighted: (value * p) / 100, closeOn: d.closeOn, bucket };
  });
  for (const d of list) {
    const b = byMonth.get(d.bucket);
    if (!b) continue;
    const part = { weighted: d.weighted, best: d.value, commit: d.probability >= COMMIT_AT ? d.value : 0, deals: 1 };
    add(b, part);
    const r = repRow(d.ownerId, d.owner);
    add(r.total, part);
    add(r.months.get(d.bucket)!, part);
  }
  for (const a of actuals) {
    const b = byMonth.get(a.period);
    if (!b) continue;
    b.actual += a.value;
    const r = repRow(a.id);
    r.total.actual += a.value;
    r.months.get(a.period)!.actual += a.value;
  }
  for (const t of targets) {
    const b = byMonth.get(t.period);
    if (!b) continue;
    b.target += t.value;
    const r = repRow(t.id);
    r.total.target += t.value;
    r.months.get(t.period)!.target += t.value;
  }
  const total = empty();
  for (const b of byMonth.values()) add(total, b);
  const outside = (k: string) => list.filter((d) => d.bucket === k);
  return {
    periods,
    months: periods.map((p) => ({ period: p, ...byMonth.get(p)! })),
    total,
    reps: [...byRep.values()].filter((r) => r.id || r.total.best || r.total.actual).map((r) => ({ id: r.id, name: r.name, ...r.total })),
    repOptions: reps,
    rep: repFilter,
    deals: list.filter((d) => byMonth.has(d.bucket) || d.bucket === "overdue" || d.bucket === "none"),
    overdue: { n: outside("overdue").length, value: outside("overdue").reduce((s, d) => s + d.value, 0) },
    noDate: { n: outside("none").length, value: outside("none").reduce((s, d) => s + d.value, 0) },
    probabilities: probs,
  };
}
