import type { Metadata } from "next";
import Link from "next/link";
import { TargetGrid, type TargetRow } from "@/components/forms/target-grid";
import { PageHeader } from "@/components/page/page-header";
import { Meter } from "@/components/ui/meter";
import { Empty, Panel } from "@/components/ui/panel";
import { Stats } from "@/components/ui/stats";
import { getCurrentUser } from "@/lib/auth";
import { monthLabel, num, rp, rpk, ym } from "@/lib/format";
import { TARGET_METRICS, type TargetMetric } from "@/lib/labels";
import { canManageTargets } from "@/lib/permissions";
import { nextPeriod, prevPeriod, repKpis } from "@/lib/queries/sales";
import { now, seesAll } from "@/lib/scope";

export const metadata: Metadata = { title: "Targets" };
const HREF = "/sales/targets";
const METRICS = Object.keys(TARGET_METRICS) as TargetMetric[];

export default async function TargetsPage({ searchParams }: PageProps<"/sales/targets">) {
  const user = await getCurrentUser();
  const current = ym(await now());
  const params = await searchParams;
  const asked = typeof params.period === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(params.period) ? params.period : current;
  const period = asked;
  const all = await repKpis(period);
  const scoped = seesAll(user) ? all : all.filter((r) => r.id === user.id);
  const rows: TargetRow[] = scoped.map((r) => ({
    id: r.id,
    name: r.name,
    region: r.region,
    cells: {
      revenue: { target: r.revenueTarget, actual: r.revenue },
      orders: { target: r.ordersTarget, actual: r.orders },
      visits: { target: r.visitTarget, actual: r.visits },
      new_customers: { target: r.newCustomersTarget, actual: r.newCustomers },
    },
  }));
  const sum = (m: TargetMetric, k: "target" | "actual") => rows.reduce((s, r) => s + r.cells[m][k], 0);
  const editable = canManageTargets(user);
  const prev = prevPeriod(period);
  const next = nextPeriod(period);

  return (
    <>
      <PageHeader href={HREF} />
      <nav aria-label="Month" className="flex items-center gap-2">
        <Link href={{ pathname: HREF, query: { period: prev } }} className="btn" aria-label={`Previous month, ${monthLabel(prev)}`}>
          ←
        </Link>
        <h2 className="min-w-36 text-center font-bold">{monthLabel(period)}</h2>
        <Link href={{ pathname: HREF, query: { period: next } }} className="btn" aria-label={`Next month, ${monthLabel(next)}`}>
          →
        </Link>
        {period !== current && (
          <Link href={HREF} className="text-[13px] font-semibold text-accent">
            This month
          </Link>
        )}
      </nav>
      <Stats
        cols={4}
        items={METRICS.map((m) => {
          const t = sum(m, "target");
          const a = sum(m, "actual");
          const money = TARGET_METRICS[m].money;
          return {
            label: TARGET_METRICS[m].label,
            value: money ? rpk(a) : num(a),
            hint: t ? `${Math.round((a / t) * 100)}% of ${money ? rpk(t) : num(t)}` : "No target",
            tone: t && a >= t ? "ok" : "default",
          };
        })}
      />
      {editable ? (
        <Panel
          title={`Targets · ${monthLabel(period)}`}
          description="Revenue = orders incl. PPN, excl. cancelled. Visits = GPS check-ins. New customers = accounts with their first order this month."
          flush
        >
          {rows.length === 0 ? <Empty>No active sales reps.</Empty> : <TargetGrid period={period} previous={monthLabel(prev)} rows={rows} />}
        </Panel>
      ) : (
        <Panel title={`Actual vs target · ${monthLabel(period)}`} description="Targets are set by your sales manager." flush>
          {rows.length === 0 ? (
            <Empty>No targets for this month.</Empty>
          ) : (
            <table className="tbl min-w-[760px]">
              <thead>
                <tr>
                  <th>Sales rep</th>
                  {METRICS.map((m) => (
                    <th key={m}>{TARGET_METRICS[m].label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <p className="font-semibold">{r.name}</p>
                      <p className="text-xs text-muted">{r.region}</p>
                    </td>
                    {METRICS.map((m) => {
                      const c = r.cells[m];
                      const money = TARGET_METRICS[m].money;
                      return (
                        <td key={m} className="min-w-40">
                          <p className="text-[13px] tabular-nums">
                            <span className="font-semibold">{money ? rp(c.actual) : num(c.actual)}</span>
                            <span className="text-muted"> / {c.target ? (money ? rpk(c.target) : num(c.target)) : "—"}</span>
                          </p>
                          {c.target > 0 && <Meter value={c.actual} max={c.target} label={`${r.name} ${TARGET_METRICS[m].label}`} />}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      )}
    </>
  );
}
