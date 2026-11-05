import type { Metadata } from "next";
import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { getCurrentUser } from "@/lib/auth";
import { markAllRead } from "@/app/actions/notifications";

export const metadata: Metadata = { title: "Notifikasi" };

export default async function NotificationsPage() {
  const user = await getCurrentUser();
  const items = await getDb()
    .select()
    .from(schema.notifications)
    .where(eq(schema.notifications.userId, user.id))
    .orderBy(desc(schema.notifications.createdAt))
    .limit(50);

  return (
    <div className="max-w-2xl space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Notifikasi</h1>
        <form action={markAllRead}>
          <button type="submit" className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-surface">
            Tandai semua dibaca
          </button>
        </form>
      </div>
      <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
        {items.length === 0 && <li className="px-4 py-10 text-center text-sm text-muted">Belum ada notifikasi.</li>}
        {items.map((n) => (
          <li key={n.id} className={`px-4 py-3 ${n.readAt ? "" : "border-l-2 border-l-accent"}`}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className={`text-sm ${n.readAt ? "" : "font-semibold"}`}>
                  {n.link ? <Link href={n.link}>{n.title}</Link> : n.title}
                </p>
                {n.body && <p className="mt-0.5 text-sm text-muted">{n.body}</p>}
              </div>
              <time className="shrink-0 text-xs text-muted" dateTime={n.createdAt.toISOString()}>
                {n.createdAt.toLocaleString("id-ID", { timeZone: "Asia/Jakarta", dateStyle: "medium", timeStyle: "short" })}
              </time>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
