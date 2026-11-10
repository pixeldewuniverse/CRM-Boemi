import type { Metadata } from "next";
import { guard } from "@/components/page/guard";
import { and, eq, sql } from "drizzle-orm";
import { PageHeader } from "@/components/page/page-header";
import { BarList } from "@/components/ui/column-chart";
import { Panel } from "@/components/ui/panel";
import { Stats } from "@/components/ui/stats";
import { getDb, schema } from "@/db";
import { num, pct, rp, rpk } from "@/lib/format";
import { STAGE, STAGES } from "@/lib/labels";
import { ownedBy } from "@/lib/scope";

export const metadata: Metadata = { title: "Pipeline & Funnel" };

export default async function FunnelPage() {
  const { user, denied } = await guard("/report/funnel");
  if (denied) return denied;
  const db = getDb();
  const o = schema.opportunities;
  const l = schema.leads;
  const [stages, lost, leadStatus] = await Promise.all([
    db
      .select({ stage: o.stage, n: sql<number>`count(*)`.mapWith(Number), value: sql<number>`coalesce(sum(${o.value}),0)`.mapWith(Number) })
      .from(o)
      .where(ownedBy(user, o.ownerId))
      .groupBy(o.stage),
    db
      .select({ reason: o.lostReason, n: sql<number>`count(*)`.mapWith(Number) })
      .from(o)
      .where(and(eq(o.stage, "lost"), ownedBy(user, o.ownerId)))
      .groupBy(o.lostReason),
    db
      .select({ status: l.status, n: sql<number>`count(*)`.mapWith(Number) })
      .from(l)
      .where(ownedBy(user, l.ownerId))
      .groupBy(l.status),
  ]);
  const get = (s: string) => stages.find((x) => x.stage === s) ?? { n: 0, value: 0 };
  const won = get("won");
  const lostN = get("lost").n;
  const open = STAGES.filter((s) => s !== "won" && s !== "lost");
  const openValue = open.reduce((s, st) => s + get(st).value, 0);
  const openN = open.reduce((s, st) => s + get(st).n, 0);
  const leadsTotal = leadStatus.reduce((s, x) => s + x.n, 0);

  // "Reached at least this stage": a deal now in Negotiation passed through earlier stages.
  const reached = STAGES.filter((s) => s !== "lost").map((s, i, arr) => ({
    stage: s,
    n: arr.slice(i).reduce((sum, st) => sum + get(st).n, 0),
  }));

  return (
    <>
      <PageHeader href="/report/funnel" />
      <Stats
        items={[
          { label: "Open pipeline", value: rpk(openValue), hint: `${openN} deals` },
          { label: "Win rate", value: pct(won.n + lostN ? (won.n / (won.n + lostN)) * 100 : null), hint: `${won.n} won · ${lostN} lost` },
          { label: "Average won deal", value: won.n ? rpk(won.value / won.n) : "—" },
          { label: "Leads in system", value: num(leadsTotal) },
        ]}
      />
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Funnel" description="Deals that reached each stage (current stage or beyond).">
          <BarList
            rows={reached.map((r, i) => ({
              label: STAGE[r.stage].label,
              value: r.n,
              hint: i > 0 && reached[i - 1].n ? pct((r.n / reached[i - 1].n) * 100) : undefined,
            }))}
            format={num}
          />
        </Panel>
        <Panel title="Lost reasons">
          {lost.length ? (
            <BarList color="c4" rows={lost.map((r) => ({ label: r.reason ?? "Not given", value: r.n }))} format={num} />
          ) : (
            <p className="text-muted">No lost deals.</p>
          )}
        </Panel>
      </div>
      <Panel title="Value by stage" flush>
        <table className="tbl min-w-[620px]">
          <thead>
            <tr>
              <th>Stage</th>
              <th className="num">Deals</th>
              <th className="num">Value</th>
              <th className="num">Probability</th>
              <th className="num">Weighted</th>
            </tr>
          </thead>
          <tbody>
            {STAGES.map((s) => (
              <tr key={s}>
                <td className="font-semibold">{STAGE[s].label}</td>
                <td className="num">{get(s).n}</td>
                <td className="num">{rp(get(s).value)}</td>
                <td className="num">{STAGE[s].probability}%</td>
                <td className="num">{rp((get(s).value * STAGE[s].probability) / 100)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </>
  );
}
