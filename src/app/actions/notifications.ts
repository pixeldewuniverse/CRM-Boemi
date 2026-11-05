"use server";

import { and, eq, isNull } from "drizzle-orm";
import { refresh } from "next/cache";
import { getDb, schema } from "@/db";
import { verifyUser } from "@/lib/auth";

export async function markAllRead() {
  const user = await verifyUser();
  await getDb()
    .update(schema.notifications)
    .set({ readAt: new Date() })
    .where(and(eq(schema.notifications.userId, user.id), isNull(schema.notifications.readAt)));
  refresh();
}
