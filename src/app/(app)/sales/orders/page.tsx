import type { Metadata } from "next";
import Link from "next/link";
import { and, count, desc, eq, gte, ne, sql, sum } from "drizzle-orm";
import { PageHeader } from "@/components/page/page-header";
import { FilterChips } from "@/components/ui/filter-chips";
import { Empty, Panel } from "@/components/ui/panel";
import { PaymentPill } from "@/components/ui/payment-pill";
import { StatusPill } from "@/components/ui/pill";
import { Stats } from "@/components/ui/stats";
import { getDb, schema } from "@/db";
import { getCurrentUser } from "@/lib/auth";
import { fdate, rp, rpk, ym } from "@/lib/format";
import { DELIVERY_STATUS, ORDER_FLOW, ORDER_STATUS } from "@/lib/labels";
import { NewOrderButton } from "@/components/forms/doc-forms";
import { docFormOptions } from "@/lib/queries/docs";
import { now, ownedBy } from "@/lib/scope";

export const metadata: Metadata = { title: "Orders" };
const HREF = "/sales/orders";
const STATUSES = ORDER_FLOW;
type Status = (typeof STATUSES)[number];

export default async function OrdersPage({ searchParams }: PageProps<"/sales/orders">) {
  const user = await getCurrentUser();
  const params = await searchParams;
  const status = STATUSES.includes(params.status as Status) ? (params.status as Status) : undefined;
  const today = await now();
  const monthStart = new Date(`${ym(today)}-01T00:00:00+07:00`);
  const db = getDb();
  const o = schema.orders;
  const scope = ownedBy(user, o.salesId);

  const [rows, counts, [month], [outstanding], form] = await Promise.all([
    db
      .select({
        id: o.id,
        no: o.orderNo,
        at: o.orderedAt,
        status: o.status,
        total: o.total,
        paid: o.paidAmount,
        payment: o.paymentStatus,
        delivery: o.deliveryStatus,
        dp: o.depositPct,
        reference: o.reference,
        accountId: schema.customers.id,
        account: schema.customers.name,
        segment: schema.customers.businessType,
        owner: schema.users.name,
        lines: sql<number>`(select count(*)::int from ${schema.orderItems} where ${schema.orderItems.orderId} = ${o.id})`,
      })
      .from(o)
      .innerJoin(schema.customers, eq(schema.customers.id, o.customerId))
      .leftJoin(schema.users, eq(schema.users.id, o.salesId))
      .where(and(scope, status ? eq(o.status, status) : undefined))
      .orderBy(desc(o.orderedAt))
      .limit(100),
    db.select({ status: o.status, n: count() }).from(o).where(scope).groupBy(o.status),
    db
      .select({ n: count(), value: sum(o.total).mapWith(Number) })
      .from(o)
      .where(and(scope, gte(o.orderedAt, monthStart), ne(o.status, "cancelled"))),
    db
      .select({ value: sql<number>`coalesce(sum(${o.total} - ${o.paidAmount}), 0)`.mapWith(Number) })
      .from(o)
      .where(and(scope, ne(o.status, "cancelled"), ne(o.status, "draft"), ne(o.paymentStatus, "paid"))),
    docFormOptions(user),
  ]);
  const byStatus = Object.fromEntries(counts.map((c) => [c.status, c.n]));
  const inProgress = (byStatus.confirmed ?? 0) + (byStatus.processing ?? 0);

  return (
    <>
      <PageHeader href={HREF} actions={form && <NewOrderButton {...form} />} />
      <Stats
        items={[
          { label: "Orders this month", value: month.n },
          { label: "Revenue this month", value: rpk(month.value ?? 0), hint: "Incl. PPN, excl. cancelled" },
          { label: "In progress", value: inProgress, hint: "Confirmed or processing" },
          { label: "Outstanding payments", value: rpk(outstanding.value), tone: outstanding.value ? "warn" : "default" },
        ]}
      />
      <FilterChips
        pathname={HREF}
        param="status"
        value={status}
        options={[
          { value: undefined, label: "All", count: counts.reduce((s, c) => s + c.n, 0) },
          ...STATUSES.map((s) => ({ value: s, label: ORDER_STATUS[s].label, count: byStatus[s] ?? 0 })),
        ]}
      />
      <Panel flush>
        {rows.length === 0 ? (
          <Empty>No orders.</Empty>
        ) : (
          <table className="tbl min-w-[960px]">
            <thead>
              <tr>
                <th>Order</th>
                <th>Account</th>
                <th className="num">Date</th>
                <th className="num">Total</th>
                <th>Payment</th>
                <th>Status</th>
                <th>Sales</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link href={`${HREF}/${r.id}`} className="font-semibold text-accent hover:underline">
                      {r.no}
                    </Link>
                    <p className="text-xs text-muted">
                      {r.lines} items · {r.reference ?? "—"}
                    </p>
                  </td>
                  <td>
                    <Link href={`/database/accounts/${r.accountId}`} className="font-semibold hover:text-accent">
                      {r.account}
                    </Link>
                    <p className="text-xs text-muted">{r.segment}</p>
                  </td>
                  <td className="num">{fdate(r.at)}</td>
                  <td className="num font-semibold">{rp(r.total)}</td>
                  <td>
                    <PaymentPill status={r.payment} depositPct={r.dp} />
                    {r.payment !== "paid" && r.status !== "cancelled" && (
                      <p className="mt-1 text-xs tabular-nums text-muted">Due {rp(r.total - r.paid)}</p>
                    )}
                  </td>
                  <td>
                    <StatusPill map={ORDER_STATUS} value={r.status} />
                    {r.status !== "cancelled" && r.status !== "draft" && (
                      <p className="mt-1">
                        <StatusPill map={DELIVERY_STATUS} value={r.delivery} />
                      </p>
                    )}
                  </td>
                  <td>{r.owner}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </>
  );
}
