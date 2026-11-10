import "server-only";
import { and, eq, ne } from "drizzle-orm";
import { getDb, schema } from "@/db";

/**
 * Who manages a user: their own manager if set, otherwise the head of their
 * department, otherwise every active Department Head / Manager. `exclude` drops people who already know (the actor).
 */
export async function managersOf(userId: string | null | undefined, exclude: (string | null | undefined)[] = []): Promise<string[]> {
  const db = getDb();
  let ids: string[] = [];
  if (userId) {
    const [u] = await db
      .select({ managerId: schema.users.managerId, active: schema.users.active, departmentId: schema.users.departmentId })
      .from(schema.users)
      .where(eq(schema.users.id, userId));
    if (u?.managerId) {
      const [m] = await db
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(and(eq(schema.users.id, u.managerId), eq(schema.users.active, true)));
      if (m) ids = [m.id];
    }
    if (!ids.length && u?.departmentId) {
      const [d] = await db
        .select({ head: schema.users.id })
        .from(schema.departments)
        .innerJoin(schema.users, eq(schema.users.id, schema.departments.headUserId))
        .where(and(eq(schema.departments.id, u.departmentId), eq(schema.users.active, true), ne(schema.users.id, userId)));
      if (d) ids = [d.head];
    }
  }
  if (!ids.length) {
    ids = (
      await db
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(and(eq(schema.users.role, "sales_manager"), eq(schema.users.active, true)))
    ).map((r) => r.id);
  }
  const skip = new Set(exclude.filter(Boolean));
  return ids.filter((id) => !skip.has(id));
}
