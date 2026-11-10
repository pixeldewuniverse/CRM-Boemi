"use server";

import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { audit } from "@/lib/audit";
import { verifyUser } from "@/lib/auth";
import { canEditItem, loadBoard, loadItem } from "@/lib/boards/access";
import { labelsOf, type FileValue } from "@/lib/boards/columns";
import { between, tooClose } from "@/lib/boards/positions";
import { enrich, loadGroupItems, loadSubitems, parseBoardParams, PAGE_SIZE, type ItemRow } from "@/lib/boards/queries";
import { logActivity, renumberGroup, wouldCycle } from "@/lib/boards/write";
import { customerScope } from "@/lib/customers";
import { ownedBy } from "@/lib/scope";
import { sniffImage } from "@/lib/sniff-image";
import { buildKey, getStorage } from "@/lib/storage";

type Fail = { ok: false; error: string };
const fail = (error: string): Fail => ({ ok: false, error });
export type ItemResult = { ok: true; item: ItemRow; conflict?: { by: string; at: string } } | Fail;

const it = schema.boardItems;

async function one(id: string) {
  const [row] = await getDb().select().from(it).where(eq(it.id, id));
  return (await enrich(row ? [row] : []))[0];
}

/** People who can be put on an item: board members + everyone in the board's department. */
async function assignable(board: { id: string; departmentId: string | null }) {
  const db = getDb();
  const rows = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(
      and(
        eq(schema.users.active, true),
        or(
          sql`exists (select 1 from ${schema.boardMembers} m where m.board_id = ${board.id} and m.user_id = ${sql.identifier("users")}.${sql.identifier("id")})`,
          board.departmentId ? eq(schema.users.departmentId, board.departmentId) : undefined,
        ),
      ),
    );
  return new Set(rows.map((r) => r.id));
}

/* ───────────── Create / move ───────────── */

const NewItem = z.object({ boardId: z.uuid(), groupId: z.uuid(), name: z.string().min(1, "Name the item.").max(255), parentItemId: z.uuid().optional() });

export async function createItem(input: z.input<typeof NewItem>): Promise<ItemResult> {
  const user = await verifyUser();
  const p = NewItem.safeParse(input);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Invalid item.");
  const found = await loadBoard(user, p.data.boardId);
  if (!found?.access.edit) return fail("You can't add items to this board.");
  if (found.board.archivedAt) return fail("This board is archived.");
  const db = getDb();
  const [group] = await db.select({ id: schema.boardGroups.id }).from(schema.boardGroups).where(and(eq(schema.boardGroups.id, p.data.groupId), eq(schema.boardGroups.boardId, p.data.boardId)));
  if (!group) return fail("Group not found.");
  if (p.data.parentItemId) {
    const [parent] = await db.select({ parent: it.parentItemId, boardId: it.boardId }).from(it).where(eq(it.id, p.data.parentItemId));
    if (!parent || parent.boardId !== p.data.boardId) return fail("Parent item not found.");
    if (parent.parent) return fail("Subitems can't have subitems.");
  }
  const [last] = await db
    .select({ position: it.position })
    .from(it)
    .where(and(eq(it.groupId, p.data.groupId), p.data.parentItemId ? eq(it.parentItemId, p.data.parentItemId) : isNull(it.parentItemId)))
    .orderBy(desc(it.position))
    .limit(1);
  const statusLabels = labelsOf((await db.select({ s: schema.boardColumns.settings }).from(schema.boardColumns).where(and(eq(schema.boardColumns.boardId, p.data.boardId), eq(schema.boardColumns.key, "status"))))[0]?.s);
  const id = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(it)
      .values({ boardId: p.data.boardId, groupId: p.data.groupId, parentItemId: p.data.parentItemId ?? null, name: p.data.name.trim(), position: between(last?.position, null), statusKey: statusLabels.find((l) => l.category === "not_started")?.key ?? null, createdBy: user.id })
      .returning({ id: it.id });
    // Assigned-only editors own what they create.
    if (found.access.editAssignedOnly) await tx.insert(schema.boardItemAssignees).values({ itemId: row.id, userId: user.id });
    await logActivity(tx, row.id, user.id, "created", null, p.data.name.trim());
    return row.id;
  });
  await audit({ actorId: user.id, action: "create", entity: p.data.parentItemId ? "board_subitem" : "board_item", entityId: found.board.name, changes: { item: p.data.name.trim() } });
  return { ok: true, item: await one(id) };
}

const Move = z.object({ itemId: z.uuid(), groupId: z.uuid(), beforeId: z.uuid().nullable().optional(), afterId: z.uuid().nullable().optional() });

/** Drag a row: new group and/or position between two neighbours (top-level items only). */
export async function moveItem(input: z.input<typeof Move>): Promise<ItemResult> {
  const user = await verifyUser();
  const p = Move.safeParse(input);
  if (!p.success) return fail("Invalid move.");
  const loaded = await loadItem(user, p.data.itemId);
  if (!loaded?.editable) return fail("You can't move this item.");
  const db = getDb();
  const [group] = await db.select({ id: schema.boardGroups.id }).from(schema.boardGroups).where(and(eq(schema.boardGroups.id, p.data.groupId), eq(schema.boardGroups.boardId, loaded.board.id)));
  if (!group) return fail("Group not found.");
  const pos = async (id?: string | null) => (id ? (await db.select({ p: it.position, g: it.groupId }).from(it).where(eq(it.id, id)))[0] : undefined);
  const [before, after] = await Promise.all([pos(p.data.beforeId), pos(p.data.afterId)]);
  let position = between(before?.g === p.data.groupId ? before.p : null, after?.g === p.data.groupId ? after.p : null);
  if (!before && !after) {
    const [last] = await db.select({ position: it.position }).from(it).where(and(eq(it.groupId, p.data.groupId), isNull(it.parentItemId))).orderBy(desc(it.position)).limit(1);
    position = between(last?.position, null);
  }
  await db.transaction(async (tx) => {
    await tx.update(it).set({ groupId: p.data.groupId, position }).where(eq(it.id, loaded.item.id));
    // Subitems travel with their parent.
    await tx.update(it).set({ groupId: p.data.groupId }).where(eq(it.parentItemId, loaded.item.id));
    if (loaded.item.groupId !== p.data.groupId) await logActivity(tx, loaded.item.id, user.id, "group", loaded.item.groupId, p.data.groupId);
    if (before && after && tooClose(before.p, after.p)) await renumberGroup(tx, p.data.groupId);
  });
  return { ok: true, item: await one(loaded.item.id) };
}

/* ───────────── Edit one cell ───────────── */

const Update = z.object({ itemId: z.uuid(), field: z.string().min(1).max(60), value: z.unknown(), seen: z.string().optional() });

/**
 * Saves one cell. Last write wins; when someone else changed the item after
 * `seen` (the updatedAt the browser had), the answer carries `conflict` so the
 * UI can say so.
 */
export async function updateItemField(input: z.input<typeof Update>): Promise<ItemResult> {
  const user = await verifyUser();
  const p = Update.safeParse(input);
  if (!p.success) return fail("Invalid change.");
  const loaded = await loadItem(user, p.data.itemId);
  if (!loaded) return fail("Item not found.");
  if (!loaded.editable) return fail(loaded.access.editAssignedOnly ? "You can only edit items assigned to you." : "You can't edit this board.");
  if (loaded.board.archivedAt) return fail("This board is archived.");
  const { item, board } = loaded;
  const db = getDb();

  let conflict: { by: string; at: string } | undefined;
  if (p.data.seen && new Date(p.data.seen).getTime() < item.updatedAt.getTime() - 500) {
    const [last] = await db
      .select({ by: schema.users.name, actor: schema.boardItemActivity.actorId })
      .from(schema.boardItemActivity)
      .leftJoin(schema.users, eq(schema.users.id, schema.boardItemActivity.actorId))
      .where(eq(schema.boardItemActivity.itemId, item.id))
      .orderBy(desc(schema.boardItemActivity.createdAt))
      .limit(1);
    if (last && last.actor !== user.id) conflict = { by: last.by ?? "Someone", at: item.updatedAt.toISOString() };
  }

  const field = p.data.field;
  const v = p.data.value;
  const patch: Partial<typeof it.$inferInsert> = {};
  let from: unknown;
  let to: unknown;
  const str = (max: number) => z.string().max(max).nullable().safeParse(v);
  const date = z.iso.date().nullable().safeParse(v);

  if (field === "name") {
    const r = z.string().trim().min(1, "Name can't be empty.").max(255).safeParse(v);
    if (!r.success) return fail(r.error.issues[0].message);
    [from, to] = [item.name, r.data];
    patch.name = r.data;
  } else if (field === "status" || field === "priority") {
    const [col] = await db.select().from(schema.boardColumns).where(and(eq(schema.boardColumns.boardId, board.id), eq(schema.boardColumns.key, field)));
    const labels = labelsOf(col?.settings);
    const r = z.string().nullable().safeParse(v);
    if (!r.success || (r.data && !labels.some((l) => l.key === r.data))) return fail("Unknown label.");
    if (field === "status") {
      [from, to] = [item.statusKey, r.data];
      patch.statusKey = r.data;
      const done = labels.find((l) => l.key === r.data)?.category === "done";
      patch.completedAt = done ? (item.completedAt ?? new Date()) : null;
    } else {
      [from, to] = [item.priority, r.data];
      patch.priority = r.data;
    }
  } else if (field === "people") {
    const r = z.array(z.uuid()).max(20).safeParse(v);
    if (!r.success) return fail("Invalid people.");
    const allowed = await assignable(board);
    if (r.data.some((id) => !allowed.has(id))) return fail("Only board members or people in the board's department can be assigned.");
    // An assigned-only editor can't hand their item away from themselves.
    if (loaded.access.editAssignedOnly && !r.data.includes(user.id)) return fail("Keep yourself on items you can only edit while assigned.");
    from = loaded.assignees;
    to = r.data;
    await db.transaction(async (tx) => {
      await tx.delete(schema.boardItemAssignees).where(eq(schema.boardItemAssignees.itemId, item.id));
      if (r.data.length) await tx.insert(schema.boardItemAssignees).values([...new Set(r.data)].map((userId) => ({ itemId: item.id, userId })));
    });
  } else if (field === "timeline") {
    const r = z.object({ start: z.iso.date().nullable(), due: z.iso.date().nullable() }).safeParse(v);
    if (!r.success) return fail("Invalid dates.");
    if (r.data.start && r.data.due && r.data.due < r.data.start) return fail("The end date is before the start date.");
    [from, to] = [{ start: item.startOn, due: item.dueOn }, r.data];
    patch.startOn = r.data.start;
    patch.dueOn = r.data.due;
  } else if (field === "estimate_hours") {
    const r = z.number().min(0).max(10000).nullable().safeParse(v);
    if (!r.success) return fail("Enter hours between 0 and 10,000.");
    [from, to] = [item.estimateHours, r.data];
    patch.estimateHours = r.data;
  } else if (field === "milestone") {
    const r = z.boolean().safeParse(v);
    if (!r.success) return fail("Invalid value.");
    [from, to] = [item.isMilestone, r.data];
    patch.isMilestone = r.data;
  } else if (field === "link_account") {
    const r = z.uuid().nullable().safeParse(v);
    if (!r.success) return fail("Invalid account.");
    if (r.data) {
      const [c] = await db.select({ id: schema.customers.id }).from(schema.customers).where(and(eq(schema.customers.id, r.data), customerScope(user)));
      if (!c) return fail("Choose one of your accounts.");
    }
    [from, to] = [item.customerId, r.data];
    patch.customerId = r.data;
  } else if (field === "link_deal") {
    const r = z.uuid().nullable().safeParse(v);
    if (!r.success) return fail("Invalid deal.");
    if (r.data) {
      const [o] = await db.select({ id: schema.opportunities.id }).from(schema.opportunities).where(and(eq(schema.opportunities.id, r.data), ownedBy(user, schema.opportunities.ownerId)));
      if (!o) return fail("Choose one of your deals.");
    }
    [from, to] = [item.opportunityId, r.data];
    patch.opportunityId = r.data;
  } else if (field.startsWith("v:")) {
    const key = field.slice(2);
    const [col] = await db.select().from(schema.boardColumns).where(and(eq(schema.boardColumns.boardId, board.id), eq(schema.boardColumns.key, key)));
    if (!col || col.isSystem) return fail("Column not found.");
    let value: unknown;
    switch (col.type) {
      case "text": {
        const r = str(500);
        if (!r.success) return fail("Up to 500 characters.");
        value = r.data || null;
        break;
      }
      case "long_text": {
        const r = str(5000);
        if (!r.success) return fail("Up to 5,000 characters.");
        value = r.data || null;
        break;
      }
      case "number": {
        const r = z.number().finite().nullable().safeParse(v);
        if (!r.success) return fail("Enter a number.");
        value = r.data;
        break;
      }
      case "date":
        if (!date.success) return fail("Pick a date.");
        value = date.data;
        break;
      case "checkbox": {
        const r = z.boolean().safeParse(v);
        if (!r.success) return fail("Invalid value.");
        value = r.data;
        break;
      }
      case "status": {
        const r = z.string().nullable().safeParse(v);
        if (!r.success || (r.data && !labelsOf(col.settings).some((l) => l.key === r.data))) return fail("Unknown label.");
        value = r.data;
        break;
      }
      case "dropdown": {
        const r = z.array(z.string()).max(20).safeParse(v);
        const keys = new Set(labelsOf(col.settings).map((l) => l.key));
        if (!r.success || r.data.some((k) => !keys.has(k))) return fail("Unknown option.");
        value = r.data;
        break;
      }
      case "people": {
        const r = z.array(z.uuid()).max(20).safeParse(v);
        if (!r.success) return fail("Invalid people.");
        const allowed = await assignable(board);
        if (r.data.some((id) => !allowed.has(id))) return fail("Only board members or people in the board's department can be picked.");
        value = r.data;
        break;
      }
      case "link": {
        const r = z.object({ url: z.url("Enter a full link starting with https://").max(2000).refine((u) => /^https?:\/\//i.test(u), "Only http(s) links."), text: z.string().max(120).optional() }).nullable().safeParse(v);
        if (!r.success) return fail(r.error.issues[0]?.message ?? "Invalid link.");
        value = r.data;
        break;
      }
      default:
        return fail("Use the upload button for files.");
    }
    from = item.values?.[key] ?? null;
    to = value;
    patch.values = { ...(item.values ?? {}), [key]: value };
    if (value === null) delete (patch.values as Record<string, unknown>)[key];
  } else {
    return fail("Unknown field.");
  }

  if (JSON.stringify(from) === JSON.stringify(to)) return { ok: true, item: await one(item.id) };
  await db.transaction(async (tx) => {
    // updatedAt always moves (also for people-only changes) so others see the conflict.
    await tx.update(it).set({ ...patch, updatedAt: new Date() }).where(eq(it.id, item.id));
    await logActivity(tx, item.id, user.id, field, from, to);
  });
  return { ok: true, item: await one(item.id), conflict };
}

/* ───────────── Bulk ───────────── */

const Bulk = z.object({
  boardId: z.uuid(),
  ids: z.array(z.uuid()).min(1).max(500),
  action: z.enum(["move", "status", "people", "duplicate", "archive", "delete"]),
  groupId: z.uuid().optional(),
  statusKey: z.string().max(40).optional(),
  userIds: z.array(z.uuid()).max(20).optional(),
});

export async function bulkItems(input: z.input<typeof Bulk>): Promise<{ ok: true; changed: number; skipped: number } | Fail> {
  const user = await verifyUser();
  const p = Bulk.safeParse(input);
  if (!p.success) return fail("Invalid request.");
  const found = await loadBoard(user, p.data.boardId);
  if (!found?.access.edit) return fail("You can't edit this board.");
  if (p.data.action === "delete" && !found.access.manage) return fail("Only board owners can delete items — archive them instead.");
  const db = getDb();
  const rows = await db.select().from(it).where(and(eq(it.boardId, p.data.boardId), inArray(it.id, p.data.ids)));
  const assignees = await db.select().from(schema.boardItemAssignees).where(inArray(schema.boardItemAssignees.itemId, rows.map((r) => r.id).concat("00000000-0000-0000-0000-000000000000")));
  const allowed = rows.filter((r) => canEditItem(found.access, assignees.filter((a) => a.itemId === r.id).map((a) => a.userId), user.id));
  const ids = allowed.map((r) => r.id);
  if (!ids.length) return fail("None of these items can be changed by you.");

  if (p.data.action === "move") {
    const [g] = await db.select({ id: schema.boardGroups.id }).from(schema.boardGroups).where(and(eq(schema.boardGroups.id, p.data.groupId ?? ""), eq(schema.boardGroups.boardId, p.data.boardId)));
    if (!g) return fail("Choose a group.");
  }
  let statusLabels: ReturnType<typeof labelsOf> = [];
  if (p.data.action === "status") {
    statusLabels = labelsOf((await db.select({ s: schema.boardColumns.settings }).from(schema.boardColumns).where(and(eq(schema.boardColumns.boardId, p.data.boardId), eq(schema.boardColumns.key, "status"))))[0]?.s);
    if (!statusLabels.some((l) => l.key === p.data.statusKey)) return fail("Choose a status.");
  }
  if (p.data.action === "people") {
    const ok = await assignable(found.board);
    if ((p.data.userIds ?? []).some((u) => !ok.has(u))) return fail("Only board members or people in the board's department can be assigned.");
  }

  await db.transaction(async (tx) => {
    const now = new Date();
    switch (p.data.action) {
      case "move": {
        const [last] = await tx.select({ position: it.position }).from(it).where(and(eq(it.groupId, p.data.groupId!), isNull(it.parentItemId))).orderBy(desc(it.position)).limit(1);
        let pos = last?.position ?? 0;
        for (const r of allowed.sort((a, b) => a.position - b.position)) {
          pos += 1024;
          await tx.update(it).set({ groupId: p.data.groupId!, position: pos, updatedAt: now }).where(eq(it.id, r.id));
          await tx.update(it).set({ groupId: p.data.groupId! }).where(eq(it.parentItemId, r.id));
          await logActivity(tx, r.id, user.id, "group", r.groupId, p.data.groupId);
        }
        break;
      }
      case "status": {
        const done = statusLabels.find((l) => l.key === p.data.statusKey)?.category === "done";
        for (const r of allowed) {
          await tx.update(it).set({ statusKey: p.data.statusKey!, completedAt: done ? (r.completedAt ?? now) : null, updatedAt: now }).where(eq(it.id, r.id));
          await logActivity(tx, r.id, user.id, "status", r.statusKey, p.data.statusKey);
        }
        break;
      }
      case "people":
        for (const r of allowed) {
          await tx.delete(schema.boardItemAssignees).where(eq(schema.boardItemAssignees.itemId, r.id));
          if (p.data.userIds?.length) await tx.insert(schema.boardItemAssignees).values(p.data.userIds.map((userId) => ({ itemId: r.id, userId })));
          await tx.update(it).set({ updatedAt: now }).where(eq(it.id, r.id));
          await logActivity(tx, r.id, user.id, "people", assignees.filter((a) => a.itemId === r.id).map((a) => a.userId), p.data.userIds ?? []);
        }
        break;
      case "duplicate":
        for (const r of allowed) {
          const [copy] = await tx
            .insert(it)
            .values({ boardId: r.boardId, groupId: r.groupId, parentItemId: r.parentItemId, name: `${r.name} (copy)`, position: r.position + 0.5, statusKey: r.statusKey, priority: r.priority, startOn: r.startOn, dueOn: r.dueOn, estimateHours: r.estimateHours, customerId: r.customerId, opportunityId: r.opportunityId, isMilestone: r.isMilestone, values: r.values, createdBy: user.id })
            .returning({ id: it.id });
          const people = assignees.filter((a) => a.itemId === r.id).map((a) => a.userId);
          if (people.length) await tx.insert(schema.boardItemAssignees).values(people.map((userId) => ({ itemId: copy.id, userId })));
          await logActivity(tx, copy.id, user.id, "created", null, `Duplicated from ${r.name}`);
        }
        break;
      case "archive":
        await tx.update(it).set({ archivedAt: now, updatedAt: now }).where(or(inArray(it.id, ids), inArray(it.parentItemId, ids)));
        for (const id of ids) await logActivity(tx, id, user.id, "archived", null, true);
        break;
      case "delete":
        await tx.delete(it).where(inArray(it.id, ids));
        break;
    }
  });
  await audit({
    actorId: user.id,
    action: p.data.action === "delete" ? "delete" : p.data.action === "archive" ? "archive" : "bulk_update",
    entity: "board_item",
    entityId: found.board.name,
    changes: { action: p.data.action, items: allowed.map((r) => r.name).slice(0, 20), count: ids.length, groupId: p.data.groupId, statusKey: p.data.statusKey },
  });
  refresh();
  return { ok: true, changed: ids.length, skipped: p.data.ids.length - ids.length };
}

/* ───────────── Dependencies ───────────── */

const Dep = z.object({ successorId: z.uuid(), predecessorId: z.uuid(), type: z.enum(["FS", "SS", "FF", "SF"]).default("FS"), lagDays: z.number().int().min(-365).max(365).default(0) });

export async function addDependency(input: z.input<typeof Dep>): Promise<ItemResult> {
  const user = await verifyUser();
  const p = Dep.safeParse(input);
  if (!p.success) return fail("Invalid dependency.");
  const loaded = await loadItem(user, p.data.successorId);
  if (!loaded?.editable) return fail("You can't edit this item.");
  const db = getDb();
  const [pred] = await db.select({ boardId: it.boardId, name: it.name }).from(it).where(eq(it.id, p.data.predecessorId));
  if (!pred || pred.boardId !== loaded.board.id) return fail("Pick an item on the same board.");
  if (await wouldCycle(db, p.data.predecessorId, p.data.successorId)) return fail("That would create a loop: this item already leads to the one you picked.");
  await db.transaction(async (tx) => {
    await tx
      .insert(schema.boardItemDependencies)
      .values(p.data)
      .onConflictDoUpdate({ target: [schema.boardItemDependencies.predecessorId, schema.boardItemDependencies.successorId], set: { type: p.data.type, lagDays: p.data.lagDays } });
    await tx.update(it).set({ updatedAt: new Date() }).where(eq(it.id, p.data.successorId));
    await logActivity(tx, p.data.successorId, user.id, "dependency", null, `${pred.name} (${p.data.type}${p.data.lagDays ? ` ${p.data.lagDays > 0 ? "+" : ""}${p.data.lagDays}d` : ""})`);
  });
  return { ok: true, item: await one(p.data.successorId) };
}

export async function removeDependency(input: { successorId: string; predecessorId: string }): Promise<ItemResult> {
  const user = await verifyUser();
  const p = z.object({ successorId: z.uuid(), predecessorId: z.uuid() }).safeParse(input);
  if (!p.success) return fail("Invalid dependency.");
  const loaded = await loadItem(user, p.data.successorId);
  if (!loaded?.editable) return fail("You can't edit this item.");
  const db = getDb();
  await db.transaction(async (tx) => {
    await tx.delete(schema.boardItemDependencies).where(and(eq(schema.boardItemDependencies.predecessorId, p.data.predecessorId), eq(schema.boardItemDependencies.successorId, p.data.successorId)));
    await tx.update(it).set({ updatedAt: new Date() }).where(eq(it.id, p.data.successorId));
    await logActivity(tx, p.data.successorId, user.id, "dependency", p.data.predecessorId, null);
  });
  return { ok: true, item: await one(p.data.successorId) };
}

/* ───────────── Reading ───────────── */

/** "Show more" in a group (same filters/sort as the page). */
export async function loadMoreItems(input: { boardId: string; groupId: string; offset: number; search: Record<string, string> }) {
  const user = await verifyUser();
  const p = z.object({ boardId: z.uuid(), groupId: z.uuid(), offset: z.number().int().min(0).max(100000), search: z.record(z.string(), z.string()) }).safeParse(input);
  if (!p.success) return { ok: false as const, error: "Invalid request." };
  const found = await loadBoard(user, p.data.boardId);
  if (!found) return { ok: false as const, error: "Board not found." };
  const columns = await getDb().select({ key: schema.boardColumns.key, type: schema.boardColumns.type }).from(schema.boardColumns).where(eq(schema.boardColumns.boardId, p.data.boardId));
  const items = await loadGroupItems(p.data.boardId, p.data.groupId, parseBoardParams(p.data.search), columns, p.data.offset, PAGE_SIZE);
  const subitems = await loadSubitems(items.map((i) => i.id));
  return { ok: true as const, items, subitems };
}

export async function itemDetail(itemId: string) {
  const user = await verifyUser();
  const id = z.uuid().safeParse(itemId);
  if (!id.success) return null;
  const loaded = await loadItem(user, id.data);
  if (!loaded) return null;
  const db = getDb();
  const [activity, subitems] = await Promise.all([
    db
      .select({ id: schema.boardItemActivity.id, field: schema.boardItemActivity.field, from: schema.boardItemActivity.from, to: schema.boardItemActivity.to, at: schema.boardItemActivity.createdAt, by: schema.users.name })
      .from(schema.boardItemActivity)
      .leftJoin(schema.users, eq(schema.users.id, schema.boardItemActivity.actorId))
      .where(eq(schema.boardItemActivity.itemId, id.data))
      .orderBy(desc(schema.boardItemActivity.createdAt))
      .limit(50),
    loadSubitems([id.data]),
  ]);
  return { editable: loaded.editable, activity: activity.map((a) => ({ ...a, at: a.at.toISOString() })), subitems };
}

/* ───────────── Files ───────────── */

const MAX_FILE = 3.5 * 1024 * 1024;
const OK_TYPES: Record<string, string> = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "text/csv": "csv", "text/plain": "txt" };

export async function uploadItemFile(fd: FormData): Promise<ItemResult> {
  const user = await verifyUser();
  const p = z.object({ itemId: z.uuid(), key: z.string().regex(/^c_[\w]{4,20}$/) }).safeParse({ itemId: fd.get("itemId"), key: fd.get("key") });
  if (!p.success) return fail("Invalid upload.");
  const file = fd.get("file");
  if (!(file instanceof File) || !file.size) return fail("Choose a file.");
  if (file.size > MAX_FILE) return fail("Files up to 3.5 MB.");
  const loaded = await loadItem(user, p.data.itemId);
  if (!loaded?.editable) return fail("You can't edit this item.");
  const db = getDb();
  const [col] = await db.select().from(schema.boardColumns).where(and(eq(schema.boardColumns.boardId, loaded.board.id), eq(schema.boardColumns.key, p.data.key)));
  if (col?.type !== "file") return fail("Column not found.");
  const bytes = Buffer.from(await file.arrayBuffer());
  const img = sniffImage(bytes);
  const pdf = bytes.subarray(0, 5).toString() === "%PDF-";
  const ext = img ?? (pdf ? "pdf" : OK_TYPES[file.type] && ["csv", "txt"].includes(OK_TYPES[file.type]) ? OK_TYPES[file.type] : null);
  if (!ext) return fail("Allowed: PDF, JPG, PNG, WebP, CSV, TXT.");
  const key = buildKey(`boards/${loaded.board.id}`, ext);
  const type = ext === "jpg" ? "image/jpeg" : ext === "pdf" ? "application/pdf" : ext === "csv" ? "text/csv" : ext === "txt" ? "text/plain" : `image/${ext}`;
  await (await getStorage()).put(key, bytes, type);
  const list = (Array.isArray(loaded.item.values?.[p.data.key]) ? loaded.item.values[p.data.key] : []) as FileValue[];
  const entry: FileValue = { key, name: file.name.slice(0, 120), size: file.size };
  await db.transaction(async (tx) => {
    await tx.update(it).set({ values: { ...loaded.item.values, [p.data.key]: [...list, entry] }, updatedAt: new Date() }).where(eq(it.id, loaded.item.id));
    await logActivity(tx, loaded.item.id, user.id, `v:${p.data.key}`, null, `+ ${entry.name}`);
  });
  return { ok: true, item: await one(loaded.item.id) };
}

export async function removeItemFile(input: { itemId: string; key: string; fileKey: string }): Promise<ItemResult> {
  const user = await verifyUser();
  const p = z.object({ itemId: z.uuid(), key: z.string(), fileKey: z.string() }).safeParse(input);
  if (!p.success) return fail("Invalid request.");
  const loaded = await loadItem(user, p.data.itemId);
  if (!loaded?.editable) return fail("You can't edit this item.");
  const list = (Array.isArray(loaded.item.values?.[p.data.key]) ? loaded.item.values[p.data.key] : []) as FileValue[];
  const gone = list.find((f) => f.key === p.data.fileKey);
  if (!gone) return fail("File not found.");
  await getDb().transaction(async (tx) => {
    await tx.update(it).set({ values: { ...loaded.item.values, [p.data.key]: list.filter((f) => f.key !== p.data.fileKey) }, updatedAt: new Date() }).where(eq(it.id, loaded.item.id));
    await logActivity(tx, loaded.item.id, user.id, `v:${p.data.key}`, gone.name, null);
  });
  await (await getStorage()).delete(gone.key).catch(() => {});
  return { ok: true, item: await one(loaded.item.id) };
}
