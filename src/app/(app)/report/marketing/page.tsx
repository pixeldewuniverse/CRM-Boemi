import type { Metadata } from "next";
import { guard } from "@/components/page/guard";
import { desc } from "drizzle-orm";
import { PageHeader } from "@/components/page/page-header";
import { BarList } from "@/components/ui/column-chart";
import { Panel } from "@/components/ui/panel";
import { Stats } from "@/components/ui/stats";
import { getDb, schema } from "@/db";
import { num, rp, rpk } from "@/lib/format";

export const metadata: Metadata = { title: "Marketing & Event report" };

export default async function MarketingReportPage() {
  const { denied } = await guard("/report/marketing");
  if (denied) return denied;
  const db = getDb();
  const [campaigns, events] = await Promise.all([
    db.select().from(schema.campaigns).orderBy(desc(schema.campaigns.startsOn)),
    db.select().from(schema.events).orderBy(desc(schema.events.heldOn)),
  ]);
  const rows = [
    ...campaigns.map((c) => ({ kind: "Campaign", name: c.name, cost: c.budget ?? 0, leads: c.resultLeads, revenue: c.resultRevenue, done: c.status !== "scheduled" })),
    ...events
      .filter((e) => !e.campaignId)
      .map((e) => ({ kind: "Event", name: e.name, cost: e.actualCost, leads: e.leadsCount, revenue: e.revenue, done: e.status === "done" })),
  ];
  const active = rows.filter((r) => r.done);
  const spend = active.reduce((s, r) => s + r.cost, 0);
  const leads = active.reduce((s, r) => s + r.leads, 0);
  const revenue = active.reduce((s, r) => s + r.revenue, 0);

  return (
    <>
      <PageHeader href="/report/marketing" title="Marketing & Event" />
      <Stats
        items={[
          { label: "Spend", value: rpk(spend), hint: "Campaign budgets + event actual cost" },
          { label: "Leads", value: num(leads), hint: leads ? `${rpk(spend / leads)} per lead` : undefined },
          { label: "Revenue attributed", value: rpk(revenue) },
          { label: "Return", value: spend ? `${(revenue / spend).toFixed(1)}×` : "—", tone: revenue >= spend ? "ok" : "warn" },
        ]}
      />
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Cost per lead">
          <BarList rows={active.filter((r) => r.leads).map((r) => ({ label: r.name, value: r.cost / r.leads }))} format={rpk} color="c3" />
        </Panel>
        <Panel title="Revenue per Rp 1 spent">
          <BarList rows={active.filter((r) => r.cost).map((r) => ({ label: r.name, value: r.revenue / r.cost }))} format={(n) => `${n.toFixed(1)}×`} />
        </Panel>
      </div>
      <Panel title="All activities" description="Events linked to a campaign are counted once, under the campaign." flush>
        <table className="tbl min-w-[720px]">
          <thead>
            <tr>
              <th>Name</th>
              <th>Type</th>
              <th className="num">Cost</th>
              <th className="num">Leads</th>
              <th className="num">Revenue</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.kind + r.name}>
                <td className="font-semibold">
                  {r.name}
                  {!r.done && <span className="ml-2 text-xs font-normal text-muted">upcoming</span>}
                </td>
                <td>{r.kind}</td>
                <td className="num">{rp(r.cost)}</td>
                <td className="num">{r.leads}</td>
                <td className="num">{rp(r.revenue)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </>
  );
}
