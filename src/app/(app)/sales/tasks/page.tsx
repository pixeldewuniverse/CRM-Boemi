import type { Metadata } from "next";
import Link from "next/link";
import { and, asc, desc, eq, gte, inArray } from "drizzle-orm";
import { PageHeader } from "@/components/page/page-header";
import { FilterChips } from "@/components/ui/filter-chips";
import { Empty, Panel } from "@/components/ui/panel";
import { Pill } from "@/components/ui/pill";
import { getDb, schema } from "@/db";
import { getCurrentUser } from "@/lib/auth";
import { daysBetween, fdate, fday, initials } from "@/lib/format";
import { TASK_COLUMNS, TASK_STATUS } from "@/lib/labels";
import { now, ownedBy, seesAll } from "@/lib/scope";

export const metadata: Metadata = { title: "Tasks & Follow-up" };
const HREF = "/sales/tasks";

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

      <div className="-mx-4 overflow-x-auto px-4 pb-2 md:-mx-6 md:px-6">
        <div className="grid min-w-[960px] grid-cols-4 gap-3">
          {TASK_COLUMNS.map((col) => {
            const cards = open.filter((x) => x.status === col);
            return (
              <section key={col} className="flex flex-col gap-2 rounded-xl bg-surface-2/60 p-2">
                <header className="flex items-baseline justify-between px-1 pt-1">
                  <h2 className="text-[13px] font-bold">{TASK_STATUS[col].label}</h2>
                  <span className="text-xs tabular-nums text-muted">{cards.length}</span>
                </header>
                {cards.map((c) => {
                  const days = c.due ? daysBetween(today, c.due) : null;
                  const late = col !== "done" && days !== null && days < 0;
                  const dueToday = col !== "done" && days === 0;
                  return (
                    <article key={c.id} className="panel flex flex-col gap-1.5 p-3 text-[13px]">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-muted">{c.type ?? "Task"}</span>
                        <span
                          title={c.assignee ?? ""}
                          className="grid size-6 place-items-center rounded-full bg-accent-soft text-[10px] font-bold text-accent"
                        >
                          {initials(c.assignee ?? "?")}
                        </span>
                      </div>
                      <p className={`leading-snug ${col === "done" ? "text-muted line-through" : "font-semibold"}`}>{c.title}</p>
                      {c.account && (
                        <Link href={`/database/accounts/${c.accountId}`} className="truncate text-xs text-muted hover:text-accent">
                          {c.account}
                        </Link>
                      )}
                      <p className={`text-xs ${late ? "font-semibold text-bad" : dueToday ? "font-semibold text-warn" : "text-muted"}`}>
                        {late ? `Overdue · ${fday(c.due)}` : dueToday ? "Due today" : `Due ${fday(c.due)}`}
                      </p>
                    </article>
                  );
                })}
                {cards.length === 0 && <p className="px-1 py-4 text-center text-xs text-muted">Nothing here</p>}
              </section>
            );
          })}
        </div>
      </div>

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
