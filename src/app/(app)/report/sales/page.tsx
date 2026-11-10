import type { Metadata } from "next";
import { guard } from "@/components/page/guard";
import { and, desc, eq, gte, lt, ne, sql } from "drizzle-orm";
import { PageHeader } from "@/components/page/page-header";
import { BarList, ColumnChart } from "@/components/ui/column-chart";
import { Panel } from "@/components/ui/panel";
import { Stats } from "@/components/ui/stats";
import { getDb, schema } from "@/db";
import { num, pct, rp, rpk, ym } from "@/lib/format";
import { nextPeriod, periodStart, revenueBySegment } from "@/lib/queries/sales";
import { now, ownedBy } from "@/lib/scope";
import { segmentSeries } from "@/lib/segments";

export const metadata: Metadata = { title: "Sales report" };

export default async function SalesReportPage() {
  const { user, denied } = await guard("/report/sales");
  if (denied) return denied;
  const period = ym(await now());
  const db = getDb();
  const o = schema.orders;
  const oi = schema.orderItems;

  const revenue = await revenueBySegment(period, 12, ownedBy(user, o.salesId));
  const from = periodStart(revenue.periods[0]);
  const to = periodStart(nextPeriod(period));
  const window = and(ownedBy(user, o.salesId), gte(o.orderedAt, from), lt(o.orderedAt, to), ne(o.status, "cancelled"));

  const [byRep, byProduct] = await Promise.all([
    db
      .select({ name: schema.users.name, value: sql<number>`sum(${o.total})`.mapWith(Number), n: sql<number>`count(*)`.mapWith(Number) })
      .from(o)
      .leftJoin(schema.users, eq(schema.users.id, o.salesId))
      .where(window)
      .groupBy(schema.users.name)
      .orderBy(desc(sql`sum(${o.total})`)),
    db
      .select({
        name: schema.products.name,
        sku: schema.products.sku,
        qty: sql<number>`sum(${oi.quantity})`.mapWith(Number),
        value: sql<number>`sum(${oi.subtotal})`.mapWith(Number),
      })
      .from(oi)
      .innerJoin(o, eq(o.id, oi.orderId))
      .innerJoin(schema.products, eq(schema.products.id, oi.productId))
      .where(window)
      .groupBy(schema.products.name, schema.products.sku)
      .orderBy(desc(sql`sum(${oi.subtotal})`))
      .limit(10),
  ]);

  const chart = segmentSeries(revenue.periods, revenue.rows);
  const total = revenue.rows.reduce((s, r) => s + r.value, 0);
  const orders = byRep.reduce((s, r) => s + r.n, 0);
  const prev = chart.series.reduce((s, x) => s + x.values[x.values.length - 2], 0);
  const prev2 = chart.series.reduce((s, x) => s + x.values[x.values.length - 3], 0);

  return (
    <>
      <PageHeader href="/report/sales" title="Sales" />
      <Stats
        items={[
          { label: "Revenue · 12 months", value: rpk(total) },
          { label: "Orders · 12 months", value: num(orders), hint: orders ? `Avg ${rpk(total / orders)} per order` : undefined },
          { label: "Last full month", value: rpk(prev), hint: prev2 ? `${prev >= prev2 ? "+" : ""}${pct(((prev - prev2) / prev2) * 100)} vs month before` : undefined },
          { label: "Channels", value: chart.series.filter((s) => s.values.some(Boolean)).length },
        ]}
      />
      <Panel title="Revenue by channel" description="Incl. PPN, excluding cancelled orders. Current month still in progress.">
        <ColumnChart {...chart} format={rpk} highlightLast caption="Monthly revenue by channel, last 12 months" />
      </Panel>
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Revenue by sales rep · 12 months">
          <BarList rows={byRep.map((r) => ({ label: r.name ?? "Unassigned", value: r.value, hint: `${r.n} orders` }))} format={rpk} />
        </Panel>
        <Panel title="Top 10 products · 12 months" description="Net of tier pricing, before discount and PPN." flush>
          <table className="tbl">
            <thead>
              <tr>
                <th>Product</th>
                <th className="num">Units</th>
                <th className="num">Sales</th>
              </tr>
            </thead>
            <tbody>
              {byProduct.map((p) => (
                <tr key={p.sku}>
                  <td>
                    <p className="font-semibold">{p.name}</p>
                    <p className="font-mono text-xs text-muted">{p.sku}</p>
                  </td>
                  <td className="num">{num(p.qty)}</td>
                  <td className="num">{rp(p.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </div>
    </>
  );
}
