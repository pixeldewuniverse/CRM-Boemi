import "server-only";
import { getDb, schema } from "@/db";

export async function audit(entry: {
  actorId: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  changes?: Record<string, unknown>;
}) {
  try {
    await getDb().insert(schema.auditLogs).values({
      actorId: entry.actorId,
      action: entry.action,
      entity: entry.entity,
      entityId: entry.entityId ?? null,
      changes: entry.changes,
    });
  } catch (err) {
    // The audit trail must never break the user's action.
    console.error("audit log failed", err);
  }
}
