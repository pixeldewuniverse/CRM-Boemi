import Link from "next/link";
import { cache } from "react";
import { and, count, eq, inArray, isNull, lt } from "drizzle-orm";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { logout } from "@/app/actions/auth";
import { Avatar } from "@/components/avatar";
import { Icon } from "@/components/icon";
import { UserMenu } from "./user-menu";
import { getDb, schema } from "@/db";
import { countPendingFor } from "@/lib/approvals";
import { getCurrentUser } from "@/lib/auth";
import { NAV } from "@/lib/nav";
import { ROLE_LABEL } from "@/lib/roles";

/** Sidebar counters, computed once per request. */
const getCounts = cache(async (): Promise<Record<string, number>> => {
  const user = await getCurrentUser();
  await connection(); // "overdue" depends on the current time
  const db = getDb();

  const [[overdue], approvals, [unread]] = await Promise.all([
    db
      .select({ n: count() })
      .from(schema.tasks)
      .where(
        and(
          eq(schema.tasks.assigneeId, user.id),
          inArray(schema.tasks.status, ["open", "in_progress"]),
          lt(schema.tasks.dueAt, new Date()),
        ),
      ),
    countPendingFor(user),
    db
      .select({ n: count() })
      .from(schema.notifications)
      .where(and(eq(schema.notifications.userId, user.id), isNull(schema.notifications.readAt))),
  ]);

  return { tasks: overdue.n, approvals, notifications: unread.n };
});

function Pill({ n }: { n: number }) {
  if (!n) return null;
  return (
    <span className="rounded-full bg-bad px-[7px] text-[11px] font-semibold text-white">
      {n > 99 ? "99+" : n}
    </span>
  );
}

export async function ItemCount({ itemKey }: { itemKey: string }) {
  const counts = await getCounts();
  return <Pill n={counts[itemKey] ?? 0} />;
}

export async function CategoryCount({ categoryKey }: { categoryKey: string }) {
  const counts = await getCounts();
  const cat = NAV.find((c) => c.key === categoryKey);
  const total = cat?.items.reduce((sum, item) => sum + (counts[item.key] ?? 0), 0) ?? 0;
  return <Pill n={total} />;
}

export async function TopRight() {
  const [user, counts] = await Promise.all([getCurrentUser(), getCounts()]);
  return (
    <div className="flex items-center gap-2">
      <Link
        href="/notifications"
        aria-label={`Notifications${counts.notifications ? `, ${counts.notifications} unread` : ""}`}
        className="relative rounded-lg p-1.5 text-muted hover:bg-surface-2 hover:text-fg"
      >
        <Icon name="bell" className="size-[18px]" />
        {counts.notifications > 0 && (
          <span className="absolute -right-0.5 -top-0.5 grid min-w-4 place-items-center rounded-full bg-bad px-1 text-[10px] font-semibold leading-4 text-white">
            {counts.notifications > 9 ? "9+" : counts.notifications}
          </span>
        )}
      </Link>
      <UserMenu avatar={<Avatar name={user.name} avatarKey={user.avatarKey} />} name={user.name} role={ROLE_LABEL[user.role]} />
    </div>
  );
}

export async function SideFooter() {
  const user = await getCurrentUser();
  return (
    <>
      <span>
        Signed in as <b className="text-fg">{user.name}</b>
        <br />
        {ROLE_LABEL[user.role]}
        {user.role === "sales" ? " · own data only" : ""}
      </span>
      <form action={logout}>
        <button type="submit" className="btn w-full justify-center py-1 text-xs">
          Sign out
        </button>
      </form>
    </>
  );
}

/** Temporary password (new account / admin reset): nothing else until it's changed. */
export async function PasswordGate() {
  const user = await getCurrentUser();
  if (user.mustChangePassword) redirect("/change-password");
  return null;
}
