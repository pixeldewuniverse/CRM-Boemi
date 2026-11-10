import type { Metadata } from "next";
import Link from "next/link";
import { and, asc, eq, ne } from "drizzle-orm";
import { PageHeader } from "@/components/page/page-header";
import { Empty, Panel } from "@/components/ui/panel";
import { PaymentPill } from "@/components/ui/payment-pill";
import { Pill } from "@/components/ui/pill";
import { Stats } from "@/components/ui/stats";
import { getDb, schema } from "@/db";
import { getCurrentUser } from "@/lib/auth";
import { daysBetween, fdate, rp, rpk } from "@/lib/format";
import { now, ownedBy } from "@/lib/scope";

export const metadata: Metadata = { title: "Receivables & Deposits" };
const BUCKETS = [
  { label: "0–30 days", max: 30 },
  { label: "31–60 days", max: 60 },
  { label: "Over 60 days", max: Infinity },
];

export default async function ReceivablesPage() {
  const user = await getCurrentUser();
  const today = await now();
  const o = schema.orders;
  const rows = await getDb()
    .select({
      id: o.id,
      no: o.orderNo,
      at: o.orderedAt,
      total: o.total,
      paid: o.paidAmount,
      payment: o.paymentStatus,
      dp: o.depositPct,
      status: o.status,
      accountId: schema.customers.id,
      account: schema.customers.name,
      sales: schema.users.name,
    })
    .from(o)
    .innerJoin(schema.customers, eq(schema.customers.id, o.customerId))
    .leftJoin(schema.users, eq(schema.users.id, o.salesId))
    .where(and(ownedBy(user, o.salesId), ne(o.status, "cancelled"), ne(o.status, "draft"), ne(o.paymentStatus, "paid")))
    .orderBy(asc(o.orderedAt));

  const withAge = rows.map((r) => ({ ...r, due: r.total - r.paid, age: daysBetween(r.at, today) }));
  const outstanding = withAge.reduce((s, r) => s + r.due, 0);
  const deposits = withAge.filter((r) => r.payment === "deposit").reduce((s, r) => s + r.paid, 0);
  const aging = BUCKETS.map((b, i) => {
    const min = i === 0 ? -Infinity : BUCKETS[i - 1].max;
    const inBucket = withAge.filter((r) => r.age > min && r.age <= b.max);
    return { ...b, n: inBucket.length, value: inBucket.reduce((s, r) => s + r.due, 0) };
  });

  return (
    <>
      <PageHeader href="/report/receivables" />
      <Stats
        items={[
          { label: "Outstanding", value: rpk(outstanding), tone: outstanding ? "warn" : "ok", hint: `${withAge.length} orders` },
          { label: "Deposits received", value: rpk(deposits), hint: "On orders not yet fully paid" },
          ...aging.slice(1).map((a) => ({ label: a.label, value: rpk(a.value), hint: `${a.n} orders`, tone: (a.value ? "bad" : "default") as "bad" | "default" })),
        ]}
      />
      <Panel title="Unpaid and partly paid orders" description="Oldest first." flush>
        {withAge.length === 0 ? (
          <Empty>Everything is paid.</Empty>
        ) : (
          <table className="tbl min-w-[900px]">
            <thead>
              <tr>
                <th>Order</th>
                <th>Account</th>
                <th className="num">Order date</th>
                <th className="num">Age</th>
                <th className="num">Total</th>
                <th className="num">Paid</th>
                <th className="num">Outstanding</th>
                <th>Payment</th>
              </tr>
            </thead>
            <tbody>
              {withAge.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link href={`/sales/orders/${r.id}`} className="font-semibold text-accent hover:underline">
                      {r.no}
                    </Link>
                    <p className="text-xs text-muted">{r.sales}</p>
                  </td>
                  <td>
                    <Link href={`/database/accounts/${r.accountId}`} className="hover:text-accent">
                      {r.account}
                    </Link>
                  </td>
                  <td className="num">{fdate(r.at)}</td>
                  <td className="num">{r.age > 30 ? <Pill tone={r.age > 60 ? "bad" : "warn"}>{r.age} days</Pill> : `${r.age} days`}</td>
                  <td className="num">{rp(r.total)}</td>
                  <td className="num">{rp(r.paid)}</td>
                  <td className="num font-semibold">{rp(r.due)}</td>
                  <td>
                    <PaymentPill status={r.payment} depositPct={r.dp} />
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
