import "server-only";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { DEFAULT_COLUMNS } from "./columns";
import { DEP_TYPE_LABEL, dependencyHolds, type Span } from "./dependency-rules";

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type DbOrTx = Db | Tx;

/** Per-item change log. */
export async function logActivity(db: DbOrTx, itemId: string, actorId: string, field: string, from: unknown, to: unknown) {
  await db.insert(schema.boardItemActivity).values({ itemId, actorId, field, from: from ?? null, to: to ?? null });
}

/** Every new board: system columns, one group (or the given ones) and the Main Table view. */
export async function scaffoldBoard(tx: DbOrTx, boardId: string, groups: { name: string; color: string }[] = [{ name: "Group 1", color: "c1" }]) {
  await tx.insert(schema.boardColumns).values(
    DEFAULT_COLUMNS.map((c, i) => ({ boardId, key: c.key, title: c.title, type: c.type, width: c.width, position: (i + 1) * 1024, settings: c.settings ?? {}, hidden: c.hidden ?? false, isSystem: true })),
  );
  const rows = await tx
    .insert(schema.boardGroups)
    .values(groups.map((g, i) => ({ boardId, name: g.name, color: g.color, position: (i + 1) * 1024 })))
    .returning({ id: schema.boardGroups.id });
  await tx.insert(schema.boardViews).values({ boardId, type: "table", name: "Main Table", position: 1024, config: {} });
  return rows.map((r) => r.id);
}

/** Renumbers a group's items 1024, 2048, … (after many inserts in the same gap). */
export async function renumberGroup(db: DbOrTx, groupId: string, parentItemId: string | null = null) {
  const items = await db
    .select({ id: schema.boardItems.id })
    .from(schema.boardItems)
    .where(and(eq(schema.boardItems.groupId, groupId), parentItemId ? eq(schema.boardItems.parentItemId, parentItemId) : isNull(schema.boardItems.parentItemId)))
    .orderBy(asc(schema.boardItems.position));
  for (let i = 0; i < items.length; i++) await db.update(schema.boardItems).set({ position: (i + 1) * 1024 }).where(eq(schema.boardItems.id, items[i].id));
}

/** Would predecessor → successor close a loop? (is the predecessor reachable from the successor?) */
export async function wouldCycle(db: DbOrTx, predecessorId: string, successorId: string): Promise<boolean> {
  if (predecessorId === successorId) return true;
  const rows = await db.execute<{ hit: boolean }>(sql`
    with recursive downstream(id) as (
      select successor_id from board_item_dependencies where predecessor_id = ${successorId}
      union
      select d.successor_id from board_item_dependencies d join downstream on d.predecessor_id = downstream.id
    )
    select exists (select 1 from downstream where id = ${predecessorId}) as hit`);
  return Boolean((rows as unknown as { hit: boolean }[])[0]?.hit);
}

/**
 * Strict boards: which dependencies would the new dates of `itemId` break?
 * Returns readable reasons (empty = fine).
 */
export async function brokenDependencies(db: DbOrTx, itemId: string, span: Span): Promise<string[]> {
  const it = schema.boardItems;
  const d = schema.boardItemDependencies;
  const [preds, succs] = await Promise.all([
    db.select({ name: it.name, start: it.startOn, due: it.dueOn, type: d.type, lag: d.lagDays }).from(d).innerJoin(it, eq(it.id, d.predecessorId)).where(eq(d.successorId, itemId)),
    db.select({ name: it.name, start: it.startOn, due: it.dueOn, type: d.type, lag: d.lagDays }).from(d).innerJoin(it, eq(it.id, d.successorId)).where(eq(d.predecessorId, itemId)),
  ]);
  const out: string[] = [];
  for (const p of preds) if (dependencyHolds(p.type, p.lag, { start: p.start, due: p.due }, span) === false) out.push(`it must follow “${p.name}” (${DEP_TYPE_LABEL[p.type]}${p.lag ? `, ${p.lag > 0 ? "+" : ""}${p.lag}d` : ""})`);
  for (const s of succs) if (dependencyHolds(s.type, s.lag, span, { start: s.start, due: s.due }) === false) out.push(`“${s.name}” must follow it (${DEP_TYPE_LABEL[s.type]}${s.lag ? `, ${s.lag > 0 ? "+" : ""}${s.lag}d` : ""})`);
  return out;
}
