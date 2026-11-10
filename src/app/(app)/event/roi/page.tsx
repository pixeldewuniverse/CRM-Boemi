import type { Metadata } from "next";
import { desc } from "drizzle-orm";
import { PageHeader } from "@/components/page/page-header";
import { BarList } from "@/components/ui/column-chart";
import { Empty, Panel } from "@/components/ui/panel";
import { Pill } from "@/components/ui/pill";
import { Stats } from "@/components/ui/stats";
import { getDb, schema } from "@/db";
import { getCurrentUser } from "@/lib/auth";
import { fdate, rp, rpk } from "@/lib/format";

export const metadata: Metadata = { title: "Event Budget & ROI" };

export default async function EventRoiPage() {
  await getCurrentUser();
  const all = await getDb().select().from(schema.events).orderBy(desc(schema.events.heldOn));
  const done = all.filter((e) => e.status === "done");
  const cost = done.reduce((s, e) => s + e.actualCost, 0);
  const revenue = done.reduce((s, e) => s + e.revenue, 0);
  const leads = done.reduce((s, e) => s + e.leadsCount, 0);

  return (
    <>
      <PageHeader href="/event/roi" />
      <Stats
        items={[
          { label: "Spent on finished events", value: rpk(cost) },
          { label: "Revenue attributed", value: rpk(revenue) },
          { label: "Return", value: cost ? `${(revenue / cost).toFixed(2)}×` : "—", tone: revenue >= cost ? "ok" : "warn" },
          { label: "Cost per lead", value: leads ? rpk(cost / leads) : "—", hint: `${leads} leads` },
        ]}
      />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
        <Panel title="Revenue per Rp 1 spent" description="Finished events.">
          <BarList
            rows={done.map((e) => ({ label: e.name, value: e.actualCost ? e.revenue / e.actualCost : 0 }))}
            format={(n) => `${n.toFixed(2)}×`}
          />
        </Panel>
        <Panel title="Budget vs actual" flush>
          {all.length === 0 ? (
            <Empty>No events.</Empty>
          ) : (
            <table className="tbl min-w-[720px]">
              <thead>
                <tr>
                  <th>Event</th>
                  <th className="num">Budget</th>
                  <th className="num">Actual</th>
                  <th className="num">Revenue</th>
                  <th className="num">Deals</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {all.map((e) => {
                  const roi = e.actualCost ? e.revenue / e.actualCost : null;
                  return (
                    <tr key={e.id}>
                      <td>
                        <p className="font-semibold">{e.name}</p>
                        <p className="text-xs text-muted">{fdate(e.heldOn)}</p>
                      </td>
                      <td className="num">{rp(e.budget)}</td>
                      <td className="num">
                        {e.actualCost ? rp(e.actualCost) : "—"}
                        {e.actualCost > e.budget && <p className="text-xs text-bad">over budget</p>}
                      </td>
                      <td className="num font-semibold">{e.revenue ? rp(e.revenue) : "—"}</td>
                      <td className="num">{e.dealsCount || "—"}</td>
                      <td>
                        {roi === null ? (
                          <Pill tone="info">Upcoming</Pill>
                        ) : roi >= 1 ? (
                          <Pill tone="ok">{roi.toFixed(1)}× return</Pill>
                        ) : (
                          <Pill tone="warn">{roi.toFixed(1)}× return</Pill>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Panel>
      </div>
    </>
  );
}
