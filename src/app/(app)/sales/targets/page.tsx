import type { Metadata } from "next";
import { PageHeader } from "@/components/page/page-header";
import { Meter } from "@/components/ui/meter";
import { Empty, Panel } from "@/components/ui/panel";
import { Stats } from "@/components/ui/stats";
import { getCurrentUser } from "@/lib/auth";
import { monthLabel, rp, rpk, ym } from "@/lib/format";
import { repKpis } from "@/lib/queries/sales";
import { now, seesAll } from "@/lib/scope";

export const metadata: Metadata = { title: "Targets" };

export default async function TargetsPage() {
  const user = await getCurrentUser();
  const period = ym(await now());
  const all = await repKpis(period);
  const rows = (seesAll(user) ? all : all.filter((r) => r.id === user.id)).filter((r) => r.revenueTarget > 0 || r.revenue > 0);
  const target = rows.reduce((s, r) => s + r.revenueTarget, 0);
  const actual = rows.reduce((s, r) => s + r.revenue, 0);

  return (
    <>
      <PageHeader href="/sales/targets" />
      <Stats
        cols={3}
        items={[
          { label: `Target · ${monthLabel(period)}`, value: rpk(target) },
          { label: "Achieved to date", value: rpk(actual), hint: target ? `${Math.round((actual / target) * 100)}% of target` : undefined },
          { label: "Gap to target", value: rpk(Math.max(target - actual, 0)), tone: actual >= target ? "ok" : "warn" },
        ]}
      />
      <Panel title={`Revenue targets · ${monthLabel(period)}`} description="Orders incl. PPN, excluding cancelled. Visit target counts GPS check-ins." flush>
        {rows.length === 0 ? (
          <Empty>No targets set for this month.</Empty>
        ) : (
          <table className="tbl min-w-[820px]">
            <thead>
              <tr>
                <th>Sales rep</th>
                <th className="num">Target</th>
                <th className="num">Achieved</th>
                <th>Progress</th>
                <th className="num">Open pipeline</th>
                <th className="num">Visits</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <p className="font-semibold">{r.name}</p>
                    <p className="text-xs text-muted">{r.region}</p>
                  </td>
                  <td className="num">{rp(r.revenueTarget)}</td>
                  <td className="num font-semibold">{rp(r.revenue)}</td>
                  <td className="w-56">
                    <Meter value={r.revenue} max={r.revenueTarget} label={`${r.name} revenue vs target`} />
                  </td>
                  <td className="num">{rpk(r.pipelineValue)}</td>
                  <td className="num">
                    {r.visits}
                    {r.visitTarget ? <span className="text-muted"> / {r.visitTarget}</span> : null}
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
