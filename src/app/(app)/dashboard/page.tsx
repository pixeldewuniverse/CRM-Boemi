import type { Metadata } from "next";
import { connection } from "next/server";
import { and, count, eq, inArray, lt } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { getCurrentUser } from "@/lib/auth";
import { customerScope } from "@/lib/customers";
import { PageTitle } from "@/components/page/page-title";

export const metadata: Metadata = { title: "Overview" };

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
    { label: "Accounts", value: customers.n },
    { label: "Hot leads", value: hot.n },
    { label: "Open tasks", value: openTasks.n },
    { label: "Overdue tasks", value: overdue.n, alert: overdue.n > 0 },
    { label: "Visit fees awaiting approval", value: pendingFees.n },
  ];

  return (
    <>
      <PageTitle
        title={`Hello, ${user.name.split(" ")[0]}`}
        description="Today's work and what needs your attention."
      />
      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {stats.map((s) => (
          <div key={s.label} className="panel p-4">
            <dt className="text-xs text-muted">{s.label}</dt>
            <dd className={`mt-1 text-2xl font-bold tabular-nums ${s.alert ? "text-bad" : ""}`}>
              {s.value}
            </dd>
          </div>
        ))}
      </dl>
    </>
  );
}
