import { and, count, eq, isNull } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { getCurrentUser } from "@/lib/auth";

export async function UnreadBadge() {
  const user = await getCurrentUser();
  const [row] = await getDb()
    .select({ n: count() })
    .from(schema.notifications)
    .where(and(eq(schema.notifications.userId, user.id), isNull(schema.notifications.readAt)));
  if (!row?.n) return null;
  return (
    <span className="rounded-full bg-accent px-2 py-0.5 text-xs font-medium text-primary-foreground">
      {row.n > 99 ? "99+" : row.n}
    </span>
  );
}
