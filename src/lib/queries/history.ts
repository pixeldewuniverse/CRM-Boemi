import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";

/** Audit trail rows for one record (entity + its display id). */
export async function recordHistory(entity: string, entityId: string, limit = 12) {
  return getDb()
    .select({ id: schema.auditLogs.id, action: schema.auditLogs.action, changes: schema.auditLogs.changes, at: schema.auditLogs.createdAt, actor: schema.users.name })
    .from(schema.auditLogs)
    .leftJoin(schema.users, eq(schema.users.id, schema.auditLogs.actorId))
    .where(and(eq(schema.auditLogs.entity, entity), eq(schema.auditLogs.entityId, entityId)))
    .orderBy(desc(schema.auditLogs.createdAt))
    .limit(limit);
}

const ACTION_LABEL: Record<string, string> = {
  create: "Created",
  update: "Updated",
  send: "Marked as sent",
  accepted: "Marked accepted",
  rejected: "Marked rejected",
  expire: "Expired automatically",
  convert: "Converted to order",
  approve: "Discount approved",
  reject: "Discount rejected",
  record_payment: "Payment recorded",
  delete_payment: "Payment removed",
};
export const actionLabel = (a: string) => ACTION_LABEL[a] ?? a.replaceAll("_", " ");
