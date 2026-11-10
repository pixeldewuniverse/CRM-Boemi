import type { Metadata } from "next";
import { and, eq, gte, sql } from "drizzle-orm";
import { PageHeader } from "@/components/page/page-header";
import { BarList } from "@/components/ui/column-chart";
import { Empty, Panel } from "@/components/ui/panel";
import { Stats } from "@/components/ui/stats";
import { getDb, schema } from "@/db";
import { getCurrentUser } from "@/lib/auth";
import { num, rp } from "@/lib/format";
import { now, ownedBy } from "@/lib/scope";

export const metadata: Metadata = { title: "Visits & Fees report" };

export default async function VisitsReportPage() {
  const user = await getCurrentUser();
  const since = new Date((await now()).getTime() - 90 * 86_400_000);
  const v = schema.visits;
  const f = schema.visitFees;
  const rows = await getDb()
    .select({
      name: schema.users.name,
      visits: sql<number>`count(distinct ${v.id})`.mapWith(Number),
      accounts: sql<number>`count(distinct ${v.customerId})`.mapWith(Number),
      requested: sql<number>`coalesce(sum(${f.amount}),0)`.mapWith(Number),
      approved: sql<number>`coalesce(sum(${f.amount}) filter (where ${f.status} in ('approved','paid')),0)`.mapWith(Number),
      pending: sql<number>`coalesce(sum(${f.amount}) filter (where ${f.status} = 'pending'),0)`.mapWith(Number),
      rejected: sql<number>`count(*) filter (where ${f.status} = 'rejected')`.mapWith(Number),
    })
    .from(v)
    .innerJoin(schema.users, eq(schema.users.id, v.salesId))
    .leftJoin(f, eq(f.visitId, v.id))
    .where(and(ownedBy(user, v.salesId), gte(v.checkedInAt, since)))
    .groupBy(schema.users.name)
    .orderBy(schema.users.name);

  const total = (k: keyof (typeof rows)[number]) => rows.reduce((s, r) => s + (r[k] as number), 0);

  return (
    <>
      <PageHeader href="/report/visits" title="Visits & Fees" />
      <Stats
        items={[
          { label: "Visits · 90 days", value: num(total("visits")) },
          { label: "Fees requested", value: rp(total("requested")) },
          { label: "Fees approved", value: rp(total("approved")), tone: "ok" },
          { label: "Fees pending", value: rp(total("pending")), tone: total("pending") ? "warn" : "default" },
        ]}
      />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
        <Panel title="Visits per rep · 90 days">
          {rows.length ? <BarList rows={rows.map((r) => ({ label: r.name, value: r.visits }))} format={num} /> : <p className="text-muted">No visits.</p>}
        </Panel>
        <Panel title="Fees per rep" flush>
          {rows.length === 0 ? (
            <Empty>No visits.</Empty>
          ) : (
            <table className="tbl min-w-[620px]">
              <thead>
                <tr>
                  <th>Rep</th>
                  <th className="num">Accounts</th>
                  <th className="num">Requested</th>
                  <th className="num">Approved</th>
                  <th className="num">Pending</th>
                  <th className="num">Rejected</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.name}>
                    <td className="font-semibold">{r.name}</td>
                    <td className="num">{r.accounts}</td>
                    <td className="num">{rp(r.requested)}</td>
                    <td className="num">{rp(r.approved)}</td>
                    <td className="num">{rp(r.pending)}</td>
                    <td className="num">{r.rejected}</td>
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
