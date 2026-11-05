import type { Metadata } from "next";
import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { getCurrentUser } from "@/lib/auth";
import { markAllRead } from "@/app/actions/notifications";
import { PageTitle } from "@/components/page/page-title";

export const metadata: Metadata = { title: "Notifications" };

export default async function NotificationsPage() {
  const user = await getCurrentUser();
  const items = await getDb()
    .select()
    .from(schema.notifications)
    .where(eq(schema.notifications.userId, user.id))
    .orderBy(desc(schema.notifications.createdAt))
    .limit(50);

  return (
    <>
      <PageTitle
        title="Notifications"
        description="Updates, approvals and deadlines for you."
        actions={
          <form action={markAllRead}>
            <button type="submit" className="btn">
              Mark all as read
            </button>
          </form>
        }
      />
      <ul className="panel max-w-3xl divide-y divide-line">
        {items.length === 0 && <li className="px-4 py-10 text-center text-muted">No notifications yet.</li>}
        {items.map((n) => (
          <li key={n.id} className={`px-4 py-3 ${n.readAt ? "" : "border-l-2 border-l-accent"}`}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className={n.readAt ? "" : "font-semibold"}>
                  {n.link ? <Link href={n.link}>{n.title}</Link> : n.title}
                </p>
                {n.body && <p className="mt-0.5 text-muted">{n.body}</p>}
              </div>
              <time className="shrink-0 text-xs text-muted" dateTime={n.createdAt.toISOString()}>
                {n.createdAt.toLocaleString("en-GB", { timeZone: "Asia/Jakarta", dateStyle: "medium", timeStyle: "short" })}
              </time>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
