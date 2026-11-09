import type { Metadata } from "next";
import { and, eq, ne, sql } from "drizzle-orm";
import { PageHeader } from "@/components/page/page-header";
import { BarList } from "@/components/ui/column-chart";
import { Panel } from "@/components/ui/panel";
import { getDb, schema } from "@/db";
import { getCurrentUser } from "@/lib/auth";
import { num, pct, rp, rpk } from "@/lib/format";
import { LEAD_SOURCES } from "@/lib/labels";
import { ownedBy } from "@/lib/scope";

export const metadata: Metadata = { title: "Lead Sources & Attribution" };

export default async function AttributionPage() {
  const user = await getCurrentUser();
  const db = getDb();
  const l = schema.leads;
  const c = schema.customers;
  const o = schema.orders;

  const [leadRows, accountRows] = await Promise.all([
    db
      .select({
        source: l.source,
        n: sql<number>`count(*)`.mapWith(Number),
        worked: sql<number>`count(*) filter (where ${l.status} in ('contacted','qualified'))`.mapWith(Number),
        qualified: sql<number>`count(*) filter (where ${l.status} = 'qualified')`.mapWith(Number),
        disq: sql<number>`count(*) filter (where ${l.status} = 'disqualified')`.mapWith(Number),
      })
      .from(l)
      .where(ownedBy(user, l.ownerId))
      .groupBy(l.source),
    db
      .select({
        source: c.source,
        accounts: sql<number>`count(distinct ${c.id})`.mapWith(Number),
        revenue: sql<number>`coalesce(sum(${o.total}), 0)`.mapWith(Number),
      })
      .from(c)
      .leftJoin(o, and(eq(o.customerId, c.id), ne(o.status, "cancelled")))
      .where(ownedBy(user, c.ownerId))
      .groupBy(c.source),
  ]);

  const sources = [...new Set([...LEAD_SOURCES, ...leadRows.map((r) => r.source), ...accountRows.map((r) => r.source ?? "Unknown")])];
  const table = sources.map((s) => {
    const lr = leadRows.find((r) => r.source === s);
    const ar = accountRows.find((r) => (r.source ?? "Unknown") === s);
    return {
      source: s,
      leads: lr?.n ?? 0,
      worked: lr?.worked ?? 0,
      qualified: lr?.qualified ?? 0,
      disq: lr?.disq ?? 0,
      accounts: ar?.accounts ?? 0,
      revenue: ar?.revenue ?? 0,
    };
  });

  return (
    <>
      <PageHeader href="/marketing/attribution" />
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Leads by source" description="All leads in the system.">
          <BarList rows={table.filter((r) => r.leads).sort((a, b) => b.leads - a.leads).map((r) => ({ label: r.source, value: r.leads }))} format={num} />
        </Panel>
        <Panel title="Account revenue by original source" description="Lifetime orders of accounts, by where they first came from.">
          <BarList
            color="c2"
            rows={table.filter((r) => r.revenue).sort((a, b) => b.revenue - a.revenue).map((r) => ({ label: r.source, value: r.revenue }))}
            format={rpk}
          />
        </Panel>
      </div>
      <Panel title="Source performance" flush>
        <table className="tbl min-w-[820px]">
          <thead>
            <tr>
              <th>Source</th>
              <th className="num">Leads</th>
              <th className="num">Being worked</th>
              <th className="num">Disqualified</th>
              <th className="num">Disqualify rate</th>
              <th className="num">Accounts</th>
              <th className="num">Account revenue</th>
            </tr>
          </thead>
          <tbody>
            {table.map((r) => (
              <tr key={r.source}>
                <td className="font-semibold">{r.source}</td>
                <td className="num">{r.leads}</td>
                <td className="num">{r.worked + r.qualified}</td>
                <td className="num">{r.disq}</td>
                <td className="num">{pct(r.leads ? (r.disq / r.leads) * 100 : null)}</td>
                <td className="num">{r.accounts}</td>
                <td className="num font-semibold">{rp(r.revenue)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </>
  );
}
