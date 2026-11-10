import "server-only";
import { and, asc, desc, eq, gte, ilike, inArray, isNull, lte, sql, type SQL } from "drizzle-orm";
import { getDb, schema } from "@/db";

export const PAGE_SIZE = 50;
export const VIRTUAL_LIMIT = 500;

export type BoardParams = {
  q?: string;
  person?: string;
  status?: string[];
  group?: string;
  from?: string;
  to?: string;
  sort?: string;
  dir?: "asc" | "desc";
  groupBy?: "status" | "priority" | "person";
};

export function parseBoardParams(sp: Record<string, string | string[] | undefined>): BoardParams {
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const date = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);
  const uuid = (v?: string) => (v && /^[0-9a-f-]{36}$/i.test(v) ? v : undefined);
  const gb = one("groupBy");
  return {
    q: one("q")?.trim().slice(0, 100) || undefined,
    person: uuid(one("person")),
    status: one("status")?.split(",").filter((s) => /^[\w-]{1,40}$/.test(s)),
    group: uuid(one("group")),
    from: date(one("from")),
    to: date(one("to")),
    sort: one("sort") && /^[\w-]{1,40}$/.test(one("sort")!) ? one("sort") : undefined,
    dir: one("dir") === "desc" ? "desc" : "asc",
    groupBy: gb === "status" || gb === "priority" || gb === "person" ? gb : undefined,
  };
}

export type ItemRow = {
  id: string;
  groupId: string;
  parentItemId: string | null;
  name: string;
  position: number;
  statusKey: string | null;
  priority: string | null;
  startOn: string | null;
  dueOn: string | null;
  estimateHours: number | null;
  customerId: string | null;
  customerName: string | null;
  opportunityId: string | null;
  dealTitle: string | null;
  isMilestone: boolean;
  values: Record<string, unknown>;
  assignees: string[];
  predecessors: { id: string; name: string; type: string; lagDays: number }[];
  subitemCount: number;
  updatedAt: string;
  completedAt: string | null;
};

export type GroupSummary = { status: Record<string, number>; numbers: Record<string, number>; estimate: number; minStart: string | null; maxDue: string | null; people: number };

const it = schema.boardItems;

/** Filters for top-level items of a board (subitems follow their parent). */
export function itemFilters(boardId: string, p: BoardParams): SQL {
  return and(
    eq(it.boardId, boardId),
    isNull(it.parentItemId),
    isNull(it.archivedAt),
    p.q ? ilike(it.name, `%${p.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`) : undefined,
    p.status?.length ? inArray(it.statusKey, p.status) : undefined,
    p.group ? eq(it.groupId, p.group) : undefined,
    p.from ? gte(it.dueOn, p.from) : undefined,
    p.to ? lte(it.startOn, p.to) : undefined,
    p.person
      ? sql`exists (select 1 from ${schema.boardItemAssignees} a where a.item_id = ${sql.identifier("board_items")}.${sql.identifier("id")} and a.user_id = ${p.person})`
      : undefined,
  )!;
}

/** ORDER BY for the sort column (system field or custom value). */
export function itemOrder(p: BoardParams, columns: { key: string; type: string }[]): SQL[] {
  const dir = p.dir === "desc" ? desc : asc;
  const col = columns.find((c) => c.key === p.sort);
  if (!col) return [asc(it.position)];
  const custom = (cast: string) => sql.raw(`(values->>'${col.key.replace(/'/g, "")}')${cast}`);
  const expr: Record<string, SQL | typeof it.name> = {
    name: it.name,
    status: it.statusKey as never,
    priority: it.priority as never,
    timeline: it.dueOn as never,
    estimate_hours: it.estimateHours as never,
    number: custom("::numeric"),
    date: custom("::date"),
    text: custom(""),
    checkbox: custom("::boolean"),
  };
  const e = expr[col.type] ?? expr[col.key];
  if (!e) return [asc(it.position)];
  return [p.dir === "desc" ? sql`${e} desc nulls last` : sql`${e} asc nulls last`, dir(it.position)];
}

/** Adds assignees, dependencies, account/deal names and subitem counts. */
export async function enrich(rows: (typeof schema.boardItems.$inferSelect)[]): Promise<ItemRow[]> {
  if (!rows.length) return [];
  const db = getDb();
  const ids = rows.map((r) => r.id);
  const custIds = [...new Set(rows.map((r) => r.customerId).filter((x): x is string => Boolean(x)))];
  const dealIds = [...new Set(rows.map((r) => r.opportunityId).filter((x): x is string => Boolean(x)))];
  const [assignees, deps, customers, deals, subs] = await Promise.all([
    db.select().from(schema.boardItemAssignees).where(inArray(schema.boardItemAssignees.itemId, ids)),
    db
      .select({ successorId: schema.boardItemDependencies.successorId, id: it.id, name: it.name, type: schema.boardItemDependencies.type, lagDays: schema.boardItemDependencies.lagDays })
      .from(schema.boardItemDependencies)
      .innerJoin(it, eq(it.id, schema.boardItemDependencies.predecessorId))
      .where(inArray(schema.boardItemDependencies.successorId, ids)),
    custIds.length ? db.select({ id: schema.customers.id, name: schema.customers.name }).from(schema.customers).where(inArray(schema.customers.id, custIds)) : [],
    dealIds.length ? db.select({ id: schema.opportunities.id, title: schema.opportunities.title }).from(schema.opportunities).where(inArray(schema.opportunities.id, dealIds)) : [],
    db
      .select({ parent: it.parentItemId, n: sql<number>`count(*)::int` })
      .from(it)
      .where(and(inArray(it.parentItemId, ids), isNull(it.archivedAt)))
      .groupBy(it.parentItemId),
  ]);
  return rows.map((r) => ({
    id: r.id,
    groupId: r.groupId,
    parentItemId: r.parentItemId,
    name: r.name,
    position: r.position,
    statusKey: r.statusKey,
    priority: r.priority,
    startOn: r.startOn,
    dueOn: r.dueOn,
    estimateHours: r.estimateHours,
    customerId: r.customerId,
    customerName: customers.find((c) => c.id === r.customerId)?.name ?? null,
    opportunityId: r.opportunityId,
    dealTitle: deals.find((d) => d.id === r.opportunityId)?.title ?? null,
    isMilestone: r.isMilestone,
    values: r.values ?? {},
    assignees: assignees.filter((a) => a.itemId === r.id).map((a) => a.userId),
    predecessors: deps.filter((d) => d.successorId === r.id).map((d) => ({ id: d.id, name: d.name, type: d.type, lagDays: d.lagDays })),
    subitemCount: subs.find((s) => s.parent === r.id)?.n ?? 0,
    updatedAt: r.updatedAt.toISOString(),
    completedAt: r.completedAt?.toISOString() ?? null,
  }));
}

export async function loadGroupItems(boardId: string, groupId: string, p: BoardParams, columns: { key: string; type: string }[], offset = 0, limit = PAGE_SIZE) {
  const rows = await getDb()
    .select()
    .from(it)
    .where(and(itemFilters(boardId, p), eq(it.groupId, groupId)))
    .orderBy(...itemOrder(p, columns))
    .limit(limit)
    .offset(offset);
  return enrich(rows);
}

export async function loadSubitems(parentIds: string[]) {
  if (!parentIds.length) return [];
  const rows = await getDb()
    .select()
    .from(it)
    .where(and(inArray(it.parentItemId, parentIds), isNull(it.archivedAt)))
    .orderBy(asc(it.position));
  return enrich(rows);
}

/** Per-group totals over ALL matching items (not only the loaded page). */
export async function groupSummaries(boardId: string, p: BoardParams, numberKeys: string[]) {
  const db = getDb();
  const where = itemFilters(boardId, p);
  const sums = numberKeys.map((k) => sql<number>`coalesce(sum(nullif(${it.values}->>${k}, '')::numeric), 0)`.mapWith(Number).as(`n_${k.replace(/\W/g, "_")}`));
  const [base, statuses, people] = await Promise.all([
    db
      .select({
        groupId: it.groupId,
        total: sql<number>`count(*)::int`,
        estimate: sql<number>`coalesce(sum(${it.estimateHours}), 0)`.mapWith(Number),
        minStart: sql<string | null>`min(${it.startOn})::text`,
        maxDue: sql<string | null>`max(${it.dueOn})::text`,
        ...Object.fromEntries(sums.map((s, i) => [`n${i}`, s])),
      })
      .from(it)
      .where(where)
      .groupBy(it.groupId),
    db.select({ groupId: it.groupId, statusKey: it.statusKey, n: sql<number>`count(*)::int` }).from(it).where(where).groupBy(it.groupId, it.statusKey),
    db
      .select({ groupId: it.groupId, n: sql<number>`count(distinct ${schema.boardItemAssignees.userId})::int` })
      .from(it)
      .innerJoin(schema.boardItemAssignees, eq(schema.boardItemAssignees.itemId, it.id))
      .where(where)
      .groupBy(it.groupId),
  ]);
  const out = new Map<string, { total: number; summary: GroupSummary }>();
  for (const b of base as (Record<string, unknown> & { groupId: string; total: number; estimate: number; minStart: string | null; maxDue: string | null })[]) {
    const numbers: Record<string, number> = {};
    numberKeys.forEach((k, i) => (numbers[k] = Number(b[`n${i}`] ?? 0)));
    out.set(b.groupId, {
      total: b.total,
      summary: {
        status: Object.fromEntries(statuses.filter((s) => s.groupId === b.groupId).map((s) => [s.statusKey ?? "", s.n])),
        numbers,
        estimate: b.estimate,
        minStart: b.minStart,
        maxDue: b.maxDue,
        people: people.find((x) => x.groupId === b.groupId)?.n ?? 0,
      },
    });
  }
  return out;
}

/** "Group by" a column instead of the board's groups: first VIRTUAL_LIMIT matching items. */
export async function loadAllMatching(boardId: string, p: BoardParams, columns: { key: string; type: string }[]) {
  const rows = await getDb()
    .select()
    .from(it)
    .where(itemFilters(boardId, p))
    .orderBy(...itemOrder(p, columns))
    .limit(VIRTUAL_LIMIT + 1);
  return { items: await enrich(rows.slice(0, VIRTUAL_LIMIT)), truncated: rows.length > VIRTUAL_LIMIT };
}
