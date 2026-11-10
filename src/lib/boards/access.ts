import "server-only";
import { and, eq, exists, inArray, or, sql, type SQL } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { CurrentUser } from "@/lib/auth";

/**
 * Board access — used by EVERY board action and query.
 *
 *   Super Admin            view + manage everything
 *   Executive              view everything (also private boards)
 *   Department Head        manage every board of their department (and sub-departments)
 *   board owner / owner member   manage that board
 *   editor member          edit items (only their own items when editAssignedOnly)
 *   viewer member          view
 *   anyone else            visibility: shared → view, department → view if in that department,
 *                          private → nothing
 */
export type BoardAccess = {
  view: boolean;
  /** Board settings: columns, groups, members, metadata, archive. */
  manage: boolean;
  /** Create/edit items (see editAssignedOnly). */
  edit: boolean;
  editAssignedOnly: boolean;
  memberRole: "owner" | "editor" | "viewer" | null;
};

export const NO_ACCESS: BoardAccess = { view: false, manage: false, edit: false, editAssignedOnly: false, memberRole: null };

type BoardLike = { id: string; departmentId: string | null; ownerId: string | null; visibility: "department" | "private" | "shared"; archivedAt?: Date | null };

/** Roles that may create boards and projects. */
export const canCreateBoards = (u: CurrentUser) => ["admin", "sales_manager", "project_manager", "executive"].includes(u.role);

/** Department ids a Department Head looks after (own + direct sub-departments). */
export async function headedDepartments(user: CurrentUser): Promise<string[]> {
  if (user.role !== "sales_manager" || !user.departmentId) return [];
  const subs = await getDb().select({ id: schema.departments.id }).from(schema.departments).where(eq(schema.departments.parentId, user.departmentId));
  return [user.departmentId, ...subs.map((s) => s.id)];
}

export async function boardAccess(user: CurrentUser, board: BoardLike | null | undefined): Promise<BoardAccess> {
  if (!board) return NO_ACCESS;
  if (user.role === "admin") return { view: true, manage: true, edit: true, editAssignedOnly: false, memberRole: "owner" };
  const [member] = await getDb()
    .select({ role: schema.boardMembers.role, only: schema.boardMembers.editAssignedOnly })
    .from(schema.boardMembers)
    .where(and(eq(schema.boardMembers.boardId, board.id), eq(schema.boardMembers.userId, user.id)));
  const headOf = board.departmentId ? (await headedDepartments(user)).includes(board.departmentId) : false;
  const owner = board.ownerId === user.id || member?.role === "owner";
  const manage = owner || headOf;
  const edit = manage || member?.role === "editor";
  const view =
    edit ||
    Boolean(member) ||
    user.role === "executive" ||
    board.visibility === "shared" ||
    (board.visibility === "department" && Boolean(board.departmentId) && board.departmentId === user.departmentId);
  return { view, manage, edit, editAssignedOnly: !manage && member?.role === "editor" && member.only, memberRole: member?.role ?? (owner ? "owner" : null) };
}

/** May the user change this item? (assigned-only editors: only items they're on). */
export function canEditItem(access: BoardAccess, assigneeIds: string[], userId: string) {
  if (!access.edit) return false;
  return !access.editAssignedOnly || assigneeIds.includes(userId);
}

/** WHERE condition for boards the user may see (undefined = all). */
export async function visibleBoardsWhere(user: CurrentUser): Promise<SQL | undefined> {
  if (user.role === "admin" || user.role === "executive") return undefined;
  const b = schema.boards;
  const heads = await headedDepartments(user);
  return or(
    eq(b.ownerId, user.id),
    eq(b.visibility, "shared"),
    user.departmentId ? and(eq(b.visibility, "department"), eq(b.departmentId, user.departmentId)) : undefined,
    heads.length ? inArray(b.departmentId, heads) : undefined,
    exists(
      getDb()
        .select({ one: sql`1` })
        .from(schema.boardMembers)
        // Outer column qualified explicitly: single-table selects render bare column names.
        .where(and(sql`${schema.boardMembers.boardId} = ${sql.identifier("boards")}.${sql.identifier("id")}`, eq(schema.boardMembers.userId, user.id))),
    ),
  );
}

/** Loads a board row and the user's access in one go (archived boards: still viewable). */
export async function loadBoard(user: CurrentUser, boardId: string) {
  const [board] = await getDb().select().from(schema.boards).where(eq(schema.boards.id, boardId));
  const access = await boardAccess(user, board);
  return access.view ? { board, access } : null;
}

/** An item with its board and the user's rights on both. */
export async function loadItem(user: CurrentUser, itemId: string) {
  const db = getDb();
  const [item] = await db.select().from(schema.boardItems).where(eq(schema.boardItems.id, itemId));
  if (!item) return null;
  const found = await loadBoard(user, item.boardId);
  if (!found) return null;
  const assignees = (await db.select({ userId: schema.boardItemAssignees.userId }).from(schema.boardItemAssignees).where(eq(schema.boardItemAssignees.itemId, item.id))).map((a) => a.userId);
  return { item, board: found.board, access: found.access, assignees, editable: canEditItem(found.access, assignees, user.id) };
}
