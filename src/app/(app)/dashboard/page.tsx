import type { Metadata } from "next";
import { connection } from "next/server";
import { and, count, eq, inArray, lt } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { getCurrentUser } from "@/lib/auth";
import { customerScope } from "@/lib/customers";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const user = await getCurrentUser();
  await connection(); // "overdue" depends on the current time
  const db = getDb();
  const scope = customerScope(user);
  const openStatuses = ["open", "in_progress"] as const;

  const [[customers], [hot], [openTasks], [overdue], [pendingFees]] = await Promise.all([
    db.select({ n: count() }).from(schema.customers).where(scope),
    db
      .select({ n: count() })
      .from(schema.customers)
      .where(and(scope, eq(schema.customers.qualificationTier, "hot"))),
    db
      .select({ n: count() })
      .from(schema.tasks)
      .where(and(eq(schema.tasks.assigneeId, user.id), inArray(schema.tasks.status, [...openStatuses]))),
    db
      .select({ n: count() })
      .from(schema.tasks)
      .where(
        and(
          eq(schema.tasks.assigneeId, user.id),
          inArray(schema.tasks.status, [...openStatuses]),
          lt(schema.tasks.dueAt, new Date()),
        ),
      ),
    db.select({ n: count() }).from(schema.visitFees).where(eq(schema.visitFees.status, "pending")),
  ]);

  const stats = [
    { label: "Customers", value: customers.n },
    { label: "Hot leads", value: hot.n },
    { label: "Tugas aktif", value: openTasks.n },
    { label: "Tugas terlambat", value: overdue.n, alert: overdue.n > 0 },
    { label: "Visit fee menunggu approval", value: pendingFees.n },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Halo, {user.name.split(" ")[0]}</h1>
        <p className="text-sm text-muted">Ringkasan pekerjaan kamu hari ini.</p>
      </div>
      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {stats.map((s) => (
          <div key={s.label} className="rounded-xl border border-border bg-surface p-4">
            <dt className="text-xs text-muted">{s.label}</dt>
            <dd className={`mt-1 text-2xl font-semibold tabular-nums ${s.alert ? "text-hot" : ""}`}>
              {s.value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
