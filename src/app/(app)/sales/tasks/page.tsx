import type { Metadata } from "next";
import { and, asc, desc, eq, gte, inArray } from "drizzle-orm";
import { PageHeader } from "@/components/page/page-header";
import { FilterChips } from "@/components/ui/filter-chips";
import { Empty, Panel } from "@/components/ui/panel";
import { Pill } from "@/components/ui/pill";
import { getDb, schema } from "@/db";
import { getCurrentUser } from "@/lib/auth";
import { TaskBoard } from "@/components/board/task-board";
import { fdate, ymd } from "@/lib/format";
import { now, ownedBy, seesAll } from "@/lib/scope";

export const metadata: Metadata = { title: "Tasks & Follow-up" };
const HREF = "/sales/tasks";
const MANAGES = ["admin", "sales_manager"];

export default async function TasksPage({ searchParams }: PageProps<"/sales/tasks">) {
  const user = await getCurrentUser();
  const params = await searchParams;
  const today = await now();
  const db = getDb();
  const t = schema.tasks;

  const people = seesAll(user)
    ? await db
        .selectDistinct({ id: schema.users.id, name: schema.users.name })
        .from(t)
        .innerJoin(schema.users, eq(schema.users.id, t.assigneeId))
        .orderBy(asc(schema.users.name))
    : [];
  const who = people.some((p) => p.id === params.who) ? (params.who as string) : undefined;
  const base = and(ownedBy(user, t.assigneeId), who ? eq(t.assigneeId, who) : undefined);

  const select = {
    id: t.id,
    title: t.title,
    type: t.type,
    status: t.status,
    assigneeId: t.assigneeId,
    due: t.dueAt,
    done: t.completedAt,
    accountId: schema.customers.id,
    account: schema.customers.name,
    assignee: schema.users.name,
  };
  const [open, log] = await Promise.all([
    db
      .select(select)
      .from(t)
      .leftJoin(schema.customers, eq(schema.customers.id, t.customerId))
      .leftJoin(schema.users, eq(schema.users.id, t.assigneeId))
      .where(and(base, inArray(t.status, ["open", "in_progress", "waiting_approval", "done"])))
      .orderBy(asc(t.dueAt)),
    db
      .select(select)
      .from(t)
      .leftJoin(schema.customers, eq(schema.customers.id, t.customerId))
      .leftJoin(schema.users, eq(schema.users.id, t.assigneeId))
      .where(and(base, eq(t.status, "done"), gte(t.completedAt, new Date(today.getTime() - 30 * 86_400_000))))
      .orderBy(desc(t.completedAt))
      .limit(20),
  ]);
  const overdue = open.filter((x) => x.status !== "done" && x.due && x.due < today).length;

  return (
    <>
      <PageHeader href={HREF} />
      <div className="flex flex-wrap items-center gap-3">
        {people.length > 0 && (
          <FilterChips
            pathname={HREF}
            param="who"
            value={who}
            options={[{ value: undefined, label: "Everyone" }, ...people.map((p) => ({ value: p.id, label: p.name }))]}
          />
        )}
        {overdue > 0 && (
          <span className="ml-auto">
            <Pill tone="bad">{overdue} overdue</Pill>
          </span>
        )}
      </div>

      <TaskBoard
        today={ymd(today)}
        tasks={open.map((c) => ({
          id: c.id,
          title: c.title,
          column: c.status,
          movable: c.assigneeId === user.id || MANAGES.includes(user.role),
          type: c.type,
          due: c.due ? ymd(c.due) : null,
          account: c.account,
          accountId: c.accountId,
          assignee: c.assignee,
        }))}
      />

      <Panel title="Completed in the last 30 days" flush>
        {log.length === 0 ? (
          <Empty>No completed activities yet.</Empty>
        ) : (
          <table className="tbl min-w-[720px]">
            <thead>
              <tr>
                <th>Activity</th>
                <th>Account</th>
                <th>By</th>
                <th className="num">Completed</th>
              </tr>
            </thead>
            <tbody>
              {log.map((c) => (
                <tr key={c.id}>
                  <td>
                    <span className="mr-2 text-xs font-semibold text-muted">{c.type}</span>
                    {c.title}
                  </td>
                  <td>{c.account ?? "—"}</td>
                  <td>{c.assignee}</td>
                  <td className="num">{fdate(c.done)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </>
  );
}
