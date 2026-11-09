import type { Metadata } from "next";
import { desc, eq } from "drizzle-orm";
import { PageHeader } from "@/components/page/page-header";
import { Empty, Panel } from "@/components/ui/panel";
import { StatusPill } from "@/components/ui/pill";
import { Stats } from "@/components/ui/stats";
import { getDb, schema } from "@/db";
import { getCurrentUser } from "@/lib/auth";
import { fday, num, rp, rpk } from "@/lib/format";
import { CAMPAIGN_STATUS } from "@/lib/labels";

export const metadata: Metadata = { title: "Campaigns" };

export default async function CampaignsPage() {
  await getCurrentUser();
  const c = schema.campaigns;
  const rows = await getDb()
    .select({
      id: c.id,
      name: c.name,
      type: c.type,
      channel: c.channel,
      starts: c.startsOn,
      ends: c.endsOn,
      budget: c.budget,
      status: c.status,
      leads: c.resultLeads,
      revenue: c.resultRevenue,
      owner: schema.users.name,
    })
    .from(c)
    .leftJoin(schema.users, eq(schema.users.id, c.ownerId))
    .orderBy(desc(c.startsOn));

  const budget = rows.reduce((s, r) => s + (r.budget ?? 0), 0);
  const leads = rows.reduce((s, r) => s + r.leads, 0);
  const revenue = rows.reduce((s, r) => s + r.revenue, 0);

  return (
    <>
      <PageHeader href="/marketing/campaigns" />
      <Stats
        items={[
          { label: "Running now", value: rows.filter((r) => r.status === "running").length },
          { label: "Total budget", value: rpk(budget) },
          { label: "Leads generated", value: num(leads), hint: budget && leads ? `${rpk(budget / leads)} per lead` : undefined },
          { label: "Attributed revenue", value: rpk(revenue), hint: budget ? `${(revenue / budget).toFixed(1)}× budget` : undefined },
        ]}
      />
      <Panel flush>
        {rows.length === 0 ? (
          <Empty>No campaigns yet.</Empty>
        ) : (
          <table className="tbl min-w-[960px]">
            <thead>
              <tr>
                <th>Campaign</th>
                <th>Period</th>
                <th className="num">Budget</th>
                <th className="num">Leads</th>
                <th className="num">Revenue</th>
                <th className="num">Return</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <p className="font-semibold">{r.name}</p>
                    <p className="text-xs text-muted">
                      {r.type} · {r.channel}
                    </p>
                  </td>
                  <td className="whitespace-nowrap">
                    {fday(r.starts)} – {fday(r.ends)}
                  </td>
                  <td className="num">{rp(r.budget)}</td>
                  <td className="num">{r.leads}</td>
                  <td className="num font-semibold">{rp(r.revenue)}</td>
                  <td className="num">{r.budget && r.revenue ? `${(r.revenue / r.budget).toFixed(1)}×` : "—"}</td>
                  <td>
                    <StatusPill map={CAMPAIGN_STATUS} value={r.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </>
  );
}
