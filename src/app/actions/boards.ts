"use server";

import { and, asc, count, desc, eq, gt, isNull, lt, sql } from "drizzle-orm";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { submitForApproval } from "@/lib/approvals";
import { audit } from "@/lib/audit";
import { verifyUser, type CurrentUser } from "@/lib/auth";
import { canCreateBoards, headedDepartments, loadBoard } from "@/lib/boards/access";
import { CUSTOM_TYPES, DEFAULT_STATUS_LABELS, GROUP_COLORS, LABEL_COLORS, STATUS_CATEGORIES, type CustomType } from "@/lib/boards/columns";
import { between } from "@/lib/boards/positions";
import { scaffoldBoard } from "@/lib/boards/write";
import { customerScope } from "@/lib/customers";
import { fieldErrors, formObject, parseRupiah, type FormState } from "@/lib/forms";
import { ownedBy } from "@/lib/scope";

export type Result = { ok: true; id?: string } | { ok: false; error: string };
const fail = (error: string): Result => ({ ok: false, error });
const PRIORITIES = ["critical", "high", "medium", "low"] as const;

async function managed(user: CurrentUser, boardId: string) {
  const found = await loadBoard(user, boardId);
  return found?.access.manage ? found : null;
}

/* ───────────── Boards & projects ───────────── */

const BoardInput = z.object({
  kind: z.enum(["project", "team"]).default("team"),
  name: z.string("Give it a name.").min(2, "Give it a name.").max(120),
  description: z.string().max(2000).optional(),
  departmentId: z.uuid().optional(),
  visibility: z.enum(["department", "private", "shared"]).default("department"),
  priority: z.enum(PRIORITIES).optional(),
  customerId: z.uuid().optional(),
  opportunityId: z.uuid().optional(),
  budget: z.string().optional(),
  actualCost: z.string().optional(),
  startOn: z.iso.date("Pick a date.").optional(),
  dueOn: z.iso.date("Pick a date.").optional(),
  dependencyMode: z.enum(["strict", "flexible", "none"]).default("flexible"),
});

async function boardValues(user: CurrentUser, fd: FormData, current?: { departmentId: string | null }) {
  const parsed = BoardInput.safeParse(formObject(fd));
  if (!parsed.success) return { error: fieldErrors(parsed.error) } as const;
  const d = parsed.data;
  if (d.startOn && d.dueOn && d.dueOn < d.startOn) return { error: { ok: false, error: "Please check the highlighted fields.", fieldErrors: { dueOn: "Must be after the start." } } } as const;
  const db = getDb();
  // Workspace: admins/executives pick any department, everyone else their own (or the ones they head).
  if (d.departmentId && d.departmentId !== current?.departmentId && !["admin", "executive"].includes(user.role) && d.departmentId !== user.departmentId && !(await headedDepartments(user)).includes(d.departmentId)) {
    return { error: { ok: false, error: "Please check the highlighted fields.", fieldErrors: { departmentId: "Pick your own department." } } } as const;
  }
  if (d.customerId) {
    const [c] = await db.select({ id: schema.customers.id }).from(schema.customers).where(and(eq(schema.customers.id, d.customerId), customerScope(user)));
    if (!c) return { error: { ok: false, error: "Please check the highlighted fields.", fieldErrors: { customerId: "Choose one of your accounts." } } } as const;
  }
  if (d.opportunityId) {
    const [o] = await db.select({ id: schema.opportunities.id }).from(schema.opportunities).where(and(eq(schema.opportunities.id, d.opportunityId), ownedBy(user, schema.opportunities.ownerId)));
    if (!o) return { error: { ok: false, error: "Please check the highlighted fields.", fieldErrors: { opportunityId: "Choose one of your deals." } } } as const;
  }
  const project = d.kind === "project";
  return {
    values: {
      kind: d.kind,
      name: d.name,
      description: d.description ?? null,
      departmentId: d.departmentId ?? (current ? null : (user.departmentId ?? null)),
      visibility: d.visibility,
      priority: project ? (d.priority ?? "medium") : null,
      customerId: project ? (d.customerId ?? null) : null,
      opportunityId: project ? (d.opportunityId ?? null) : null,
      budget: project ? (parseRupiah(d.budget) ?? null) : null,
      actualCost: project ? (parseRupiah(d.actualCost) ?? null) : null,
      startOn: project ? (d.startOn ?? null) : null,
      dueOn: project ? (d.dueOn ?? null) : null,
      dependencyMode: d.dependencyMode,
    },
  } as const;
}

/** PRJ-2026-001: yearly counter in document_counters (atomic). */
async function nextProjectCode(tx: Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0]) {
  const year = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" }).slice(0, 4);
  const rows = await tx.execute<{ last_seq: number }>(sql`
    insert into document_counters (doc_type, period, last_seq) values ('project', ${year}, 1)
    on conflict (doc_type, period) do update set last_seq = document_counters.last_seq + 1 returning last_seq`);
  return `PRJ-${year}-${String(Number((rows as unknown as { last_seq: number }[])[0].last_seq)).padStart(3, "0")}`;
}

export async function createBoard(_prev: FormState, fd: FormData): Promise<FormState> {
  const user = await verifyUser();
  if (!canCreateBoards(user)) return { ok: false, error: "Your role can't create boards." };
  const v = await boardValues(user, fd);
  if ("error" in v) return v.error as FormState;
  const project = v.values.kind === "project";
  const id = await getDb().transaction(async (tx) => {
    const [b] = await tx
      .insert(schema.boards)
      .values({ ...v.values, ownerId: user.id, code: project ? await nextProjectCode(tx) : null, projectStatus: project ? "draft" : null })
      .returning({ id: schema.boards.id });
    await tx.insert(schema.boardMembers).values({ boardId: b.id, userId: user.id, role: "owner" });
    await scaffoldBoard(tx, b.id, project ? [{ name: "Planning", color: "c1" }, { name: "In progress", color: "c3" }, { name: "Done", color: "c2" }] : undefined);
    return b.id;
  });
  await audit({ actorId: user.id, action: "create", entity: project ? "project" : "board", entityId: v.values.name });
  refresh();
  redirect(`/projects/${id}`);
}

export async function updateBoard(_prev: FormState, fd: FormData): Promise<FormState> {
  const user = await verifyUser();
  const id = z.uuid().safeParse(fd.get("id"));
  if (!id.success) return { ok: false, error: "Invalid board." };
  const found = await managed(user, id.data);
  if (!found) return { ok: false, error: "Only the board owner, the department head or an admin can change this board." };
  fd.set("kind", found.board.kind === "project" ? "project" : "team");
  const v = await boardValues(user, fd, found.board);
  if ("error" in v) return v.error as FormState;
  const { kind: _k, ...rest } = v.values;
  void _k;
  await getDb().update(schema.boards).set(rest).where(eq(schema.boards.id, id.data));
  const changes: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(rest)) if ((found.board as Record<string, unknown>)[k] !== val) changes[k] = [(found.board as Record<string, unknown>)[k], val];
  await audit({ actorId: user.id, action: "update", entity: found.board.kind === "project" ? "project" : "board", entityId: rest.name, changes });
  refresh();
  return { ok: true, message: "Saved." };
}

/** Project → approval engine ("project" workflows). No active workflow → active at once. */
export async function submitProject(_prev: FormState, fd: FormData): Promise<FormState> {
  const user = await verifyUser();
  const id = z.uuid().safeParse(fd.get("id"));
  if (!id.success) return { ok: false, error: "Invalid project." };
  const found = await managed(user, id.data);
  if (!found || found.board.kind !== "project") return { ok: false, error: "Only the project owner can submit it." };
  if (found.board.projectStatus !== "draft") return { ok: false, error: "Only draft projects can be submitted." };
  const b = found.board;
  const res = await submitForApproval({ entityType: "project", entityId: b.id, amount: b.budget ?? 0, title: `${b.code} · ${b.name}`, link: `/projects/${b.id}`, requesterId: user.id });
  await getDb()
    .update(schema.boards)
    .set(res.status === "approved" ? { projectStatus: "active" } : { projectStatus: "pending_approval", approvalRequestId: res.requestId })
    .where(eq(schema.boards.id, b.id));
  await audit({ actorId: user.id, action: "submit", entity: "project", entityId: b.code ?? b.name, changes: { result: res.status } });
  refresh();
  return { ok: true, message: res.status === "approved" ? "No approval needed — the project is active." : "Sent for approval." };
}

const ProjectStatus = z.object({ id: z.uuid(), status: z.enum(["active", "on_hold", "completed", "cancelled"]) });

export async function setProjectStatus(_prev: FormState, fd: FormData): Promise<FormState> {
  const user = await verifyUser();
  const parsed = ProjectStatus.safeParse(formObject(fd));
  if (!parsed.success) return { ok: false, error: "Invalid status." };
  const found = await managed(user, parsed.data.id);
  if (!found || found.board.kind !== "project") return { ok: false, error: "Only the project owner can change its status." };
  const from = found.board.projectStatus;
  if (from === "draft" || from === "pending_approval") return { ok: false, error: "Submit the project for approval first." };
  await getDb().update(schema.boards).set({ projectStatus: parsed.data.status }).where(eq(schema.boards.id, found.board.id));
  await audit({ actorId: user.id, action: "update", entity: "project", entityId: found.board.code ?? found.board.name, changes: { status: [from, parsed.data.status] } });
  refresh();
  return { ok: true, message: "Status updated." };
}

export async function archiveBoard(_prev: FormState, fd: FormData): Promise<FormState> {
  const user = await verifyUser();
  const id = z.uuid().safeParse(fd.get("id"));
  if (!id.success) return { ok: false, error: "Invalid board." };
  const found = await managed(user, id.data);
  if (!found) return { ok: false, error: "Only the board owner, the department head or an admin can archive it." };
  const archived = !found.board.archivedAt;
  await getDb().update(schema.boards).set({ archivedAt: archived ? new Date() : null }).where(eq(schema.boards.id, id.data));
  await audit({ actorId: user.id, action: archived ? "archive" : "restore", entity: "board", entityId: found.board.name });
  refresh();
  return { ok: true, message: archived ? "Board archived." : "Board restored." };
}

/* ───────────── Members ───────────── */

const Member = z.object({ boardId: z.uuid(), userId: z.uuid("Choose a person."), role: z.enum(["owner", "editor", "viewer"]).default("editor"), editAssignedOnly: z.literal("on").optional() });

export async function saveBoardMember(_prev: FormState, fd: FormData): Promise<FormState> {
  const user = await verifyUser();
  const parsed = Member.safeParse(formObject(fd));
  if (!parsed.success) return fieldErrors(parsed.error);
  const d = parsed.data;
  const found = await managed(user, d.boardId);
  if (!found) return { ok: false, error: "Only the board owner, the department head or an admin can change members." };
  const [person] = await getDb().select({ name: schema.users.name, active: schema.users.active }).from(schema.users).where(eq(schema.users.id, d.userId));
  if (!person?.active) return { ok: false, error: "Choose an active person." };
  const only = d.role === "editor" && Boolean(d.editAssignedOnly);
  await getDb()
    .insert(schema.boardMembers)
    .values({ boardId: d.boardId, userId: d.userId, role: d.role, editAssignedOnly: only })
    .onConflictDoUpdate({ target: [schema.boardMembers.boardId, schema.boardMembers.userId], set: { role: d.role, editAssignedOnly: only } });
  await audit({ actorId: user.id, action: "update", entity: "board_member", entityId: found.board.name, changes: { person: person.name, role: d.role, editAssignedOnly: only } });
  refresh();
  return { ok: true, message: `${person.name} is ${d.role === "owner" ? "an owner" : `a${d.role === "editor" ? "n editor" : " viewer"}`}.` };
}

export async function removeBoardMember(_prev: FormState, fd: FormData): Promise<FormState> {
  const user = await verifyUser();
  const parsed = z.object({ boardId: z.uuid(), userId: z.uuid() }).safeParse(formObject(fd));
  if (!parsed.success) return { ok: false, error: "Invalid request." };
  const found = await managed(user, parsed.data.boardId);
  if (!found) return { ok: false, error: "Only the board owner, the department head or an admin can change members." };
  if (found.board.ownerId === parsed.data.userId) return { ok: false, error: "The board owner always stays a member." };
  await getDb().delete(schema.boardMembers).where(and(eq(schema.boardMembers.boardId, parsed.data.boardId), eq(schema.boardMembers.userId, parsed.data.userId)));
  await audit({ actorId: user.id, action: "delete", entity: "board_member", entityId: found.board.name, changes: { userId: parsed.data.userId } });
  refresh();
  return { ok: true, message: "Removed." };
}

/* ───────────── Groups ───────────── */

export async function createGroup(input: { boardId: string; name?: string }): Promise<Result> {
  const user = await verifyUser();
  const p = z.object({ boardId: z.uuid(), name: z.string().max(80).optional() }).safeParse(input);
  if (!p.success) return fail("Invalid request.");
  const found = await managed(user, p.data.boardId);
  if (!found) return fail("Only board owners can add groups.");
  const db = getDb();
  const [last] = await db.select({ position: schema.boardGroups.position }).from(schema.boardGroups).where(eq(schema.boardGroups.boardId, p.data.boardId)).orderBy(desc(schema.boardGroups.position)).limit(1);
  const [{ n }] = await db.select({ n: count() }).from(schema.boardGroups).where(eq(schema.boardGroups.boardId, p.data.boardId));
  const [g] = await db
    .insert(schema.boardGroups)
    .values({ boardId: p.data.boardId, name: p.data.name?.trim() || "New group", color: GROUP_COLORS[n % GROUP_COLORS.length], position: between(last?.position, null) })
    .returning({ id: schema.boardGroups.id });
  await audit({ actorId: user.id, action: "create", entity: "board_group", entityId: found.board.name, changes: { name: p.data.name ?? "New group" } });
  refresh();
  return { ok: true, id: g.id };
}

const GroupPatch = z.object({ groupId: z.uuid(), name: z.string().min(1).max(80).optional(), color: z.string().max(20).optional(), collapsed: z.boolean().optional() });

export async function updateGroup(input: z.input<typeof GroupPatch>): Promise<Result> {
  const user = await verifyUser();
  const p = GroupPatch.safeParse(input);
  if (!p.success) return fail("Invalid request.");
  const db = getDb();
  const [g] = await db.select().from(schema.boardGroups).where(eq(schema.boardGroups.id, p.data.groupId));
  if (!g) return fail("Group not found.");
  const found = await loadBoard(user, g.boardId);
  if (!found) return fail("Group not found.");
  // Collapsing is a personal-feeling action: any viewer may do it; renaming/colour needs manage rights.
  const structural = p.data.name !== undefined || p.data.color !== undefined;
  if (structural && !found.access.manage) return fail("Only board owners can rename groups.");
  if (p.data.color && !(GROUP_COLORS as readonly string[]).includes(p.data.color)) return fail("Unknown colour.");
  const { groupId: _g, ...patch } = p.data;
  void _g;
  await db.update(schema.boardGroups).set(patch).where(eq(schema.boardGroups.id, g.id));
  if (structural) await audit({ actorId: user.id, action: "update", entity: "board_group", entityId: found.board.name, changes: { name: [g.name, p.data.name ?? g.name], color: p.data.color } });
  return { ok: true };
}

export async function moveGroup(input: { groupId: string; direction: "up" | "down" }): Promise<Result> {
  const user = await verifyUser();
  const p = z.object({ groupId: z.uuid(), direction: z.enum(["up", "down"]) }).safeParse(input);
  if (!p.success) return fail("Invalid request.");
  const db = getDb();
  const [g] = await db.select().from(schema.boardGroups).where(eq(schema.boardGroups.id, p.data.groupId));
  if (!g || !(await managed(user, g.boardId))) return fail("Only board owners can reorder groups.");
  const up = p.data.direction === "up";
  const [neighbour] = await db
    .select()
    .from(schema.boardGroups)
    .where(and(eq(schema.boardGroups.boardId, g.boardId), up ? lt(schema.boardGroups.position, g.position) : gt(schema.boardGroups.position, g.position)))
    .orderBy(up ? desc(schema.boardGroups.position) : asc(schema.boardGroups.position))
    .limit(1);
  if (!neighbour) return { ok: true };
  await db.transaction(async (tx) => {
    await tx.update(schema.boardGroups).set({ position: neighbour.position }).where(eq(schema.boardGroups.id, g.id));
    await tx.update(schema.boardGroups).set({ position: g.position }).where(eq(schema.boardGroups.id, neighbour.id));
  });
  refresh();
  return { ok: true };
}

/** Deletes a group; its items move to `moveTo` (required when it isn't empty). */
export async function deleteGroup(input: { groupId: string; moveTo?: string }): Promise<Result> {
  const user = await verifyUser();
  const p = z.object({ groupId: z.uuid(), moveTo: z.uuid().optional() }).safeParse(input);
  if (!p.success) return fail("Invalid request.");
  const db = getDb();
  const [g] = await db.select().from(schema.boardGroups).where(eq(schema.boardGroups.id, p.data.groupId));
  if (!g) return fail("Group not found.");
  const found = await managed(user, g.boardId);
  if (!found) return fail("Only board owners can delete groups.");
  const [{ n }] = await db.select({ n: count() }).from(schema.boardGroups).where(eq(schema.boardGroups.boardId, g.boardId));
  if (n <= 1) return fail("A board needs at least one group.");
  const [{ items }] = await db.select({ items: count() }).from(schema.boardItems).where(eq(schema.boardItems.groupId, g.id));
  if (items > 0) {
    if (!p.data.moveTo || p.data.moveTo === g.id) return fail(`Move its ${items} items to another group first.`);
    const [target] = await db.select({ id: schema.boardGroups.id }).from(schema.boardGroups).where(and(eq(schema.boardGroups.id, p.data.moveTo), eq(schema.boardGroups.boardId, g.boardId)));
    if (!target) return fail("Target group not found.");
  }
  await db.transaction(async (tx) => {
    if (items > 0) await tx.update(schema.boardItems).set({ groupId: p.data.moveTo! }).where(eq(schema.boardItems.groupId, g.id));
    await tx.delete(schema.boardGroups).where(eq(schema.boardGroups.id, g.id));
  });
  await audit({ actorId: user.id, action: "delete", entity: "board_group", entityId: found.board.name, changes: { group: g.name, movedItems: items } });
  refresh();
  return { ok: true };
}

/* ───────────── Columns ───────────── */

const LabelInput = z.object({
  key: z.string().regex(/^[\w-]{1,40}$/),
  label: z.string().min(1, "Every label needs a name.").max(40),
  color: z.enum(Object.keys(LABEL_COLORS) as [keyof typeof LABEL_COLORS, ...(keyof typeof LABEL_COLORS)[]]),
  category: z.enum(STATUS_CATEGORIES).optional(),
});

export async function addColumn(input: { boardId: string; type: string; title?: string }): Promise<Result> {
  const user = await verifyUser();
  const p = z.object({ boardId: z.uuid(), type: z.enum(Object.keys(CUSTOM_TYPES) as [CustomType, ...CustomType[]]), title: z.string().max(60).optional() }).safeParse(input);
  if (!p.success) return fail("Choose a column type.");
  const found = await managed(user, p.data.boardId);
  if (!found) return fail("Only board owners can add columns.");
  const db = getDb();
  const [last] = await db.select({ position: schema.boardColumns.position }).from(schema.boardColumns).where(eq(schema.boardColumns.boardId, p.data.boardId)).orderBy(desc(schema.boardColumns.position)).limit(1);
  const key = `c_${crypto.randomUUID().slice(0, 8)}`;
  const settings: Record<string, unknown> =
    p.data.type === "status"
      ? { labels: DEFAULT_STATUS_LABELS.map((l) => ({ ...l })) }
      : p.data.type === "dropdown"
        ? { labels: [{ key: "opt1", label: "Option 1", color: "blue" }, { key: "opt2", label: "Option 2", color: "teal" }] }
        : p.data.type === "number"
          ? { prefix: "", unit: "" }
          : {};
  const title = p.data.title?.trim() || CUSTOM_TYPES[p.data.type];
  const [c] = await db
    .insert(schema.boardColumns)
    .values({ boardId: p.data.boardId, key, title, type: p.data.type, settings, position: between(last?.position, null), width: p.data.type === "long_text" ? 220 : 150 })
    .returning({ id: schema.boardColumns.id });
  await audit({ actorId: user.id, action: "create", entity: "board_column", entityId: found.board.name, changes: { title, type: p.data.type } });
  refresh();
  return { ok: true, id: c.id };
}

const ColumnPatch = z.object({
  columnId: z.uuid(),
  title: z.string().min(1).max(60).optional(),
  hidden: z.boolean().optional(),
  width: z.number().int().min(60).max(600).optional(),
  position: z.number().optional(),
  labels: z.array(LabelInput).min(1).max(30).optional(),
  prefix: z.string().max(6).optional(),
  unit: z.string().max(10).optional(),
});

export async function updateColumn(input: z.input<typeof ColumnPatch>): Promise<Result> {
  const user = await verifyUser();
  const p = ColumnPatch.safeParse(input);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Invalid request.");
  const db = getDb();
  const [c] = await db.select().from(schema.boardColumns).where(eq(schema.boardColumns.id, p.data.columnId));
  if (!c) return fail("Column not found.");
  const found = await managed(user, c.boardId);
  if (!found) return fail("Only board owners can change columns.");
  if (c.key === "name" && p.data.hidden) return fail("The item name can't be hidden.");
  const settings = { ...(c.settings ?? {}) };
  if (p.data.labels) {
    if (!["status", "priority", "dropdown"].includes(c.type)) return fail("This column has no labels.");
    if (c.type === "status" && p.data.labels.some((l) => !l.category)) return fail("Every status label needs a category.");
    if (new Set(p.data.labels.map((l) => l.key)).size !== p.data.labels.length) return fail("Labels must be unique.");
    if (c.type === "status" && !p.data.labels.some((l) => l.category === "done")) return fail("Keep at least one label in the Done category.");
    settings.labels = p.data.labels;
  }
  if (p.data.prefix !== undefined) settings.prefix = p.data.prefix;
  if (p.data.unit !== undefined) settings.unit = p.data.unit;
  await db
    .update(schema.boardColumns)
    .set({ title: p.data.title ?? c.title, hidden: p.data.hidden ?? c.hidden, width: p.data.width ?? c.width, position: p.data.position ?? c.position, settings })
    .where(eq(schema.boardColumns.id, c.id));
  // Width / order changes are layout, not data: keep them out of the audit trail.
  if (p.data.title || p.data.hidden !== undefined || p.data.labels || p.data.prefix !== undefined) {
    await audit({ actorId: user.id, action: "update", entity: "board_column", entityId: found.board.name, changes: { column: c.title, title: p.data.title, hidden: p.data.hidden, labels: p.data.labels?.map((l) => `${l.label} (${l.category ?? l.color})`) } });
  }
  if (p.data.title || p.data.hidden !== undefined || p.data.labels || p.data.position !== undefined || p.data.prefix !== undefined) refresh();
  return { ok: true };
}

export async function deleteColumn(input: { columnId: string }): Promise<Result> {
  const user = await verifyUser();
  const p = z.object({ columnId: z.uuid() }).safeParse(input);
  if (!p.success) return fail("Invalid request.");
  const db = getDb();
  const [c] = await db.select().from(schema.boardColumns).where(eq(schema.boardColumns.id, p.data.columnId));
  if (!c) return fail("Column not found.");
  if (c.isSystem) return fail("System columns can't be deleted — hide them instead.");
  const found = await managed(user, c.boardId);
  if (!found) return fail("Only board owners can delete columns.");
  await db.transaction(async (tx) => {
    await tx.delete(schema.boardColumns).where(eq(schema.boardColumns.id, c.id));
    await tx.update(schema.boardItems).set({ values: sql`${schema.boardItems.values} - ${c.key}` }).where(and(eq(schema.boardItems.boardId, c.boardId), isNull(schema.boardItems.archivedAt)));
  });
  await audit({ actorId: user.id, action: "delete", entity: "board_column", entityId: found.board.name, changes: { column: c.title, type: c.type } });
  refresh();
  return { ok: true };
}
