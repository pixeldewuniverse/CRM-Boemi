import type { Metadata } from "next";
import Link from "next/link";
import { and, asc, count, desc, eq, gte, inArray, lt, lte, notInArray, sql } from "drizzle-orm";
import { PageTitle } from "@/components/page/page-title";
import { TierBadge } from "@/components/tier-badge";
import { ColumnChart } from "@/components/ui/column-chart";
import { Meter } from "@/components/ui/meter";
import { Empty, Panel } from "@/components/ui/panel";
import { Stats } from "@/components/ui/stats";
import { getDb, schema } from "@/db";
import { getCurrentUser } from "@/lib/auth";
import { fday, monthLabel, rp, rpk, ym, ymd } from "@/lib/format";
import { projected, salesForecast } from "@/lib/reports/forecast";
import { projectPerformance } from "@/lib/reports/projects";
import { contactCounts } from "@/lib/qualification/contact";
import { canOpen, findNav } from "@/lib/nav";
import { repKpis, revenueBySegment } from "@/lib/queries/sales";
import { now, ownedBy, seesAll, visibleUserIds } from "@/lib/scope";
import { segmentSeries } from "@/lib/segments";

export const metadata: Metadata = { title: "Overview" };

export default async function DashboardPage() {
  const user = await getCurrentUser();
  const today = await now();
  const period = ym(today);
  const mine = !seesAll(user);
  const db = getDb();

  const [kpis, revenue, [leads30], [pipeline], overdueTasks, pendingFees, expiringQuotes, hotLeads] = await Promise.all([
    repKpis(period),
    revenueBySegment(period, 12, ownedBy(user, schema.orders.salesId)),
    db
      .select({ n: count() })
      .from(schema.leads)
      .where(and(ownedBy(user, schema.leads.ownerId), gte(schema.leads.createdAt, new Date(today.getTime() - 30 * 86_400_000)))),
    db
      .select({ n: count(), value: sql<number>`coalesce(sum(${schema.opportunities.value}),0)`.mapWith(Number) })
      .from(schema.opportunities)
      .where(and(ownedBy(user, schema.opportunities.ownerId), notInArray(schema.opportunities.stage, ["won", "lost"]))),
    db
      .select({ id: schema.tasks.id, title: schema.tasks.title, due: schema.tasks.dueAt, who: schema.users.name })
      .from(schema.tasks)
      .leftJoin(schema.users, eq(schema.users.id, schema.tasks.assigneeId))
      .where(
        and(
          ownedBy(user, schema.tasks.assigneeId),
          inArray(schema.tasks.status, ["open", "in_progress", "waiting_approval"]),
          lt(schema.tasks.dueAt, today),
        ),
      )
      .orderBy(asc(schema.tasks.dueAt))
      .limit(5),
    db
      .select({ id: schema.visitFees.id, amount: schema.visitFees.amount, account: schema.customers.name, who: schema.users.name })
      .from(schema.visitFees)
      .innerJoin(schema.visits, eq(schema.visits.id, schema.visitFees.visitId))
      .innerJoin(schema.customers, eq(schema.customers.id, schema.visits.customerId))
      .leftJoin(schema.users, eq(schema.users.id, schema.visits.salesId))
      .where(and(eq(schema.visitFees.status, "pending"), ownedBy(user, schema.visits.salesId)))
      .limit(5),
    db
      .select({ id: schema.quotations.id, no: schema.quotations.quoteNo, valid: schema.quotations.validUntil, account: schema.customers.name })
      .from(schema.quotations)
      .innerJoin(schema.customers, eq(schema.customers.id, schema.quotations.customerId))
      .where(
        and(
          ownedBy(user, schema.quotations.ownerId),
          eq(schema.quotations.status, "sent"),
          lte(schema.quotations.validUntil, new Date(today.getTime() + 7 * 86_400_000).toISOString().slice(0, 10)),
        ),
      )
      .orderBy(asc(schema.quotations.validUntil))
      .limit(5),
    db
      .select({
        id: schema.leads.id,
        company: schema.leads.company,
        score: schema.leads.qualificationScore,
        tier: schema.leads.qualificationTier,
        reason: schema.leads.qualificationReason,
      })
      .from(schema.leads)
      .where(and(ownedBy(user, schema.leads.ownerId), inArray(schema.leads.status, ["new", "contacted"])))
      .orderBy(desc(schema.leads.qualificationScore))
      .limit(5),
  ]);

  const exec = user.role === "admin" || user.role === "executive";
  const contactItem = findNav("/sales/contact-today")?.item;
  const contact = contactItem && canOpen(contactItem, user.role) ? await contactCounts(user, today) : null;
  const [forecast, projects, approvals] = await Promise.all([
    salesForecast(user, period, 1),
    exec ? projectPerformance(user, ymd(today), { includeClosed: false }) : null,
    exec
      ? db
          .select({ id: schema.approvalRequests.id, title: schema.approvalRequests.title, amount: schema.approvalRequests.amount, type: schema.approvalRequests.entityType, link: schema.approvalRequests.link, at: schema.approvalRequests.createdAt, who: schema.users.name, step: schema.approvalActions.label })
          .from(schema.approvalRequests)
          .leftJoin(schema.users, eq(schema.users.id, schema.approvalRequests.requesterId))
          .leftJoin(schema.approvalActions, and(eq(schema.approvalActions.requestId, schema.approvalRequests.id), eq(schema.approvalActions.position, schema.approvalRequests.currentStep)))
          .where(eq(schema.approvalRequests.status, "pending"))
          .orderBy(asc(schema.approvalRequests.createdAt))
      : [],
  ]);
  const visible = await visibleUserIds(user);
  const scope = visible ? kpis.filter((k) => visible.has(k.id)) : kpis;
  const target = scope.reduce((s, k) => s + k.revenueTarget, 0);
  const actual = mine ? (scope[0]?.revenue ?? 0) : revenue.rows.filter((r) => r.month === period).reduce((s, r) => s + r.value, 0);
  const chart = segmentSeries(revenue.periods, revenue.rows);
  const attention = overdueTasks.length + pendingFees.length + expiringQuotes.length;

  return (
    <>
      <PageTitle
        title={`Hello, ${user.name.split(" ")[0]}`}
        description={`${monthLabel(period)} so far${mine ? " — your accounts only" : ""}. Target vs actual, and what needs attention today.`}
      />
      <Stats
        cols={5}
        items={[
          {
            label: `Revenue · ${monthLabel(period, true)} to date`,
            value: rpk(actual),
            hint: target ? <Meter value={actual} max={target} label="Revenue vs target" /> : "No target set",
          },
          { label: "Open pipeline", value: rpk(pipeline.value), hint: `${pipeline.n} open deals` },
          {
            label: `Forecast · ${monthLabel(period, true)}`,
            value: <Link href="/sales/forecast" className="hover:text-accent">{rpk(projected(forecast.total))}</Link>,
            hint: forecast.total.target ? <Meter value={projected(forecast.total)} max={forecast.total.target} label="Forecast vs target" /> : `Actual ${rpk(forecast.total.actual)} + weighted ${rpk(forecast.total.weighted)}`,
          },
          { label: "New leads · 30 days", value: leads30.n },
          {
            label: "Needs attention",
            value: attention,
            tone: attention ? "bad" : "ok",
            hint: `${overdueTasks.length} overdue · ${pendingFees.length} fees · ${expiringQuotes.length} quotes`,
          },
        ]}
      />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Panel title="Revenue by channel · last 12 months" description="Orders incl. PPN, excluding cancelled. The current month is still in progress.">
          <ColumnChart {...chart} format={rpk} highlightLast caption="Monthly revenue by channel" />
        </Panel>

        <Panel title="Needs attention" flush>
          {attention === 0 ? (
            <Empty>All clear for today.</Empty>
          ) : (
            <ul className="divide-y divide-line text-[13px]">
              {overdueTasks.map((t) => (
                <li key={t.id} className="flex gap-3 px-4 py-2.5">
                  <span className="pill shrink-0 bg-bad-soft text-bad">Overdue</span>
                  <Link href="/sales/tasks" className="min-w-0 flex-1 hover:text-accent">
                    <p className="truncate">{t.title}</p>
                    <p className="text-xs text-muted">
                      {t.who} · due {fday(t.due)}
                    </p>
                  </Link>
                </li>
              ))}
              {pendingFees.map((f) => (
                <li key={f.id} className="flex gap-3 px-4 py-2.5">
                  <span className="pill shrink-0 bg-warn-soft text-warn">Fee</span>
                  <Link href="/sales/visits?fee=pending" className="min-w-0 flex-1 hover:text-accent">
                    <p className="truncate">
                      {rp(f.amount)} · {f.account}
                    </p>
                    <p className="text-xs text-muted">{f.who} · awaiting approval</p>
                  </Link>
                </li>
              ))}
              {expiringQuotes.map((q) => (
                <li key={q.id} className="flex gap-3 px-4 py-2.5">
                  <span className="pill shrink-0 bg-info-soft text-info">Quote</span>
                  <Link href="/sales/quotations?status=sent" className="min-w-0 flex-1 hover:text-accent">
                    <p className="truncate">
                      {q.no} · {q.account}
                    </p>
                    <p className="text-xs text-muted">valid until {fday(q.valid)}</p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      {projects && (
        <div className="grid gap-5 xl:grid-cols-2">
          <Panel title="Projects" description="Open projects across the company." actions={<Link href="/report/projects" className="text-[13px] font-semibold text-accent">Project report →</Link>}>
            <div className="grid grid-cols-2 gap-3 text-[13px] sm:grid-cols-4">
              {[
                { l: "Open", v: projects.totals.open },
                { l: "Late", v: projects.totals.late, bad: projects.totals.late > 0 },
                { l: "Avg. progress", v: `${projects.totals.avgProgress}%` },
                { l: "Overdue items", v: projects.totals.overdue, bad: projects.totals.overdue > 0 },
              ].map((x) => (
                <div key={x.l}>
                  <p className="text-xs text-muted">{x.l}</p>
                  <p className={`text-xl font-bold tabular-nums ${x.bad ? "text-bad" : ""}`}>{x.v}</p>
                </div>
              ))}
            </div>
            <ul className="mt-4 divide-y divide-line text-[13px]">
              {projects.rows
                .filter((r) => ["draft", "pending_approval", "active", "on_hold"].includes(r.status))
                .sort((a, b) => Number(b.late) - Number(a.late) || b.overdue - a.overdue)
                .slice(0, 5)
                .map((r) => (
                  <li key={r.id} className="flex items-center gap-3 py-2">
                    <Link href={`/projects/${r.id}`} className="min-w-0 flex-1 hover:text-accent">
                      <p className="truncate font-semibold">{r.name}</p>
                      <p className="text-xs text-muted">
                        {[r.code, r.department].filter(Boolean).join(" · ")}
                        {r.overdue ? ` · ${r.overdue} overdue` : ""}
                      </p>
                    </Link>
                    {r.late && <span className="pill bg-bad-soft text-bad">Late</span>}
                    <span className="w-36">
                      <Meter value={r.done} max={r.items || 1} label={`${r.name} progress`} />
                    </span>
                  </li>
                ))}
              {!projects.rows.length && <li className="py-2 text-muted">No projects yet.</li>}
            </ul>
          </Panel>
          <Panel title={`Waiting for approval · ${approvals.length}`} description="Every pending request in the company, oldest first." actions={<Link href="/approvals" className="text-[13px] font-semibold text-accent">Approvals →</Link>} flush>
            {approvals.length === 0 ? (
              <Empty>Nothing waiting.</Empty>
            ) : (
              <ul className="divide-y divide-line text-[13px]">
                {approvals.slice(0, 6).map((a) => {
                  const days = Math.floor((today.getTime() - a.at.getTime()) / 86_400_000);
                  return (
                    <li key={a.id} className="flex items-start gap-3 px-4 py-2.5">
                      <span className={`pill shrink-0 ${days >= 2 ? "bg-bad-soft text-bad" : "bg-warn-soft text-warn"}`}>{days ? `${days}d` : "today"}</span>
                      <Link href={a.link ?? "/approvals"} className="min-w-0 flex-1 hover:text-accent">
                        <p className="truncate">{a.title}</p>
                        <p className="text-xs text-muted">
                          {a.who ?? "Someone"}
                          {a.step ? ` · waiting for ${a.step}` : ""}
                        </p>
                      </Link>
                    </li>
                  );
                })}
                {approvals.length > 6 && <li className="px-4 py-2 text-xs text-muted">+{approvals.length - 6} more</li>}
              </ul>
            )}
          </Panel>
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-2">
        {contact ? (
          <Panel title={`Contact today · ${contact.overdue + contact.dueToday}`} description={`${contact.overdue} past SLA · ${contact.total} open leads in total. Every lead gets a call — this is the order.`} actions={<Link href="/sales/contact-today" className="text-[13px] font-semibold text-accent">Contact Today →</Link>} flush>
            {contact.top.length === 0 ? (
              <Empty>No open leads.</Empty>
            ) : (
              <ul className="divide-y divide-line text-[13px]">
                {contact.top.map((l) => (
                  <li key={l.id} className="flex items-start gap-3 px-4 py-2.5">
                    <span className="w-8 shrink-0 font-bold tabular-nums">{l.score ?? "—"}</span>
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold">{l.company}</p>
                      <p className={`truncate text-xs ${l.overdue ? "font-semibold text-bad" : "text-muted"}`}>{l.overdue ? "Past SLA" : l.firstContact ? "New — not contacted yet" : "Follow-up due"} · waiting {l.days}d</p>
                    </div>
                    <TierBadge tier={l.tier} />
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        ) : (
          <Panel title="Hottest open leads" description="Ranked by qualification score." flush>
            {hotLeads.length === 0 ? (
              <Empty>No open leads.</Empty>
            ) : (
              <ul className="divide-y divide-line text-[13px]">
                {hotLeads.map((l) => (
                  <li key={l.id} className="flex items-start gap-3 px-4 py-2.5">
                    <span className="w-8 shrink-0 font-bold tabular-nums">{l.score}</span>
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold">{l.company}</p>
                      <p className="truncate text-xs text-muted">{l.reason}</p>
                    </div>
                    <TierBadge tier={l.tier} />
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        )}

        <Panel title={`Team target · ${monthLabel(period)}`} flush>
          {scope.length === 0 ? (
            <Empty>No sales reps.</Empty>
          ) : (
            <table className="tbl">
              <thead>
                <tr>
                  <th>Rep</th>
                  <th className="num">Achieved</th>
                  <th>Progress</th>
                </tr>
              </thead>
              <tbody>
                {scope
                  .filter((k) => k.revenueTarget > 0)
                  .map((k) => (
                    <tr key={k.id}>
                      <td className="font-semibold">{k.name}</td>
                      <td className="num">{rpk(k.revenue)}</td>
                      <td className="w-48">
                        <Meter value={k.revenue} max={k.revenueTarget} label={`${k.name} vs target`} />
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          )}
        </Panel>
      </div>
    </>
  );
}
