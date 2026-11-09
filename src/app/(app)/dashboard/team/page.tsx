import type { Metadata } from "next";
import { PageHeader } from "@/components/page/page-header";
import { Meter } from "@/components/ui/meter";
import { Empty, Panel } from "@/components/ui/panel";
import { Pill } from "@/components/ui/pill";
import { getCurrentUser } from "@/lib/auth";
import { monthLabel, rpk, ym } from "@/lib/format";
import { prevPeriod, repKpis } from "@/lib/queries/sales";
import { now, seesAll } from "@/lib/scope";

export const metadata: Metadata = { title: "Team & Sales KPI" };

export default async function TeamPage() {
  const user = await getCurrentUser();
  const period = ym(await now());
  const all = await repKpis(period);
  const rows = (seesAll(user) ? all : all.filter((r) => r.id === user.id)).filter((r) => r.role === "sales");

  return (
    <>
      <PageHeader href="/dashboard/team" />
      <Panel
        title={`Sales reps · ${monthLabel(period)}`}
        description={`Revenue to date vs target, ${monthLabel(prevPeriod(period), true)} for comparison, open pipeline and activity discipline.`}
        flush
      >
        {rows.length === 0 ? (
          <Empty>No sales reps.</Empty>
        ) : (
          <table className="tbl min-w-[1040px]">
            <thead>
              <tr>
                <th>Rep</th>
                <th className="num">Target</th>
                <th className="num">Achieved</th>
                <th>Progress</th>
                <th className="num">Last month</th>
                <th className="num">Open pipeline</th>
                <th className="num">Won deals</th>
                <th className="num">Visits</th>
                <th className="num">Done · 30d</th>
                <th>Overdue</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <p className="font-semibold">{r.name}</p>
                    <p className="text-xs text-muted">{r.region}</p>
                  </td>
                  <td className="num">{rpk(r.revenueTarget)}</td>
                  <td className="num font-semibold">{rpk(r.revenue)}</td>
                  <td className="w-44">
                    <Meter value={r.revenue} max={r.revenueTarget} label={`${r.name} vs target`} />
                  </td>
                  <td className="num">{rpk(r.lastMonthRevenue)}</td>
                  <td className="num">
                    {rpk(r.pipelineValue)}
                    <p className="text-xs text-muted">{r.openDeals} deals</p>
                  </td>
                  <td className="num">{r.dealsWon}</td>
                  <td className="num">
                    {r.visits}
                    {r.visitTarget ? <span className="text-muted"> / {r.visitTarget}</span> : null}
                  </td>
                  <td className="num">{r.activitiesDone}</td>
                  <td>{r.overdue ? <Pill tone="bad">{r.overdue} overdue</Pill> : <Pill tone="ok">On track</Pill>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </>
  );
}
