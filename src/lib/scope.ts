import "server-only";
import { eq, isNull, or, sql, type AnyColumn, type SQL } from "drizzle-orm";
import { connection } from "next/server";
import { getDb, schema } from "@/db";
import type { CurrentUser } from "./auth";
import { ROLE_SCOPE } from "./roles";

/**
 * Data scope per role (Access Matrix v2.0):
 *  - all  → admin, executive, finance, marketing, designer
 *  - team → Department Head / Manager: everyone in their department (and its
 *           sub-departments), their direct reports, themselves, and unassigned records
 *  - own  → sales, staff, project manager: only their own records
 */
export const scopeLevel = (user: CurrentUser) => ROLE_SCOPE[user.role];

/** True for everyone who isn't limited to their own records (all + team). */
export const seesAll = (user: CurrentUser) => scopeLevel(user) !== "own";

/** SQL list of user ids a manager may see. */
export function teamMemberIds(user: CurrentUser): SQL {
  return sql`(select ${schema.users.id} from ${schema.users} where ${schema.users.id} = ${user.id} or ${schema.users.managerId} = ${user.id}${
    user.departmentId
      ? sql` or ${schema.users.departmentId} in (select ${schema.departments.id} from ${schema.departments} where ${schema.departments.id} = ${user.departmentId} or ${schema.departments.parentId} = ${user.departmentId})`
      : sql``
  })`;
}

/** WHERE condition limiting rows to the owners the user may see (undefined = no limit). */
export function ownedBy(user: CurrentUser, column: AnyColumn): SQL | undefined {
  const level = scopeLevel(user);
  if (level === "all") return undefined;
  if (level === "own") return eq(column, user.id);
  return or(isNull(column), sql`${column} in ${teamMemberIds(user)}`);
}

/** Ids of the people whose records the user may see (null = everyone). */
export async function visibleUserIds(user: CurrentUser): Promise<Set<string> | null> {
  const level = scopeLevel(user);
  if (level === "all") return null;
  if (level === "own") return new Set([user.id]);
  const rows = await getDb().execute<{ id: string }>(sql`select id from ${teamMemberIds(user)} t(id)`);
  return new Set((rows as unknown as { id: string }[]).map((r) => r.id));
}

/** Current time for request-time rendering (Cache Components). */
export async function now(): Promise<Date> {
  await connection();
  return new Date();
}

/**
 * May the user change a record owned by `ownerId`? The owner always; Super
 * Admin always; a Department Head / Manager when the owner is in their team
 * (or the record has no owner yet).
 */
export async function mayManage(user: CurrentUser, ownerId: string | null | undefined): Promise<boolean> {
  if (user.role === "admin" || (ownerId && ownerId === user.id)) return true;
  if (user.role !== "sales_manager") return false;
  if (!ownerId) return true;
  return (await visibleUserIds(user))?.has(ownerId) ?? true;
}
