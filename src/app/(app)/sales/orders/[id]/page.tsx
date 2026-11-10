import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, desc, eq } from "drizzle-orm";
import { DeletePaymentButton, OrderStatusActions, RecordPaymentButton } from "@/components/forms/doc-actions";
import { PageTitle } from "@/components/page/page-title";
import { Empty, Panel } from "@/components/ui/panel";
import { PaymentPill } from "@/components/ui/payment-pill";
import { StatusPill } from "@/components/ui/pill";
import { Stats } from "@/components/ui/stats";
import { getDb, schema } from "@/db";
import { getCurrentUser } from "@/lib/auth";
import { fdate, fdatetime, rp } from "@/lib/format";
import { DELIVERY_STATUS, ORDER_STATUS, PAYMENT_KIND } from "@/lib/labels";
import { canRecordPayments } from "@/lib/permissions";
import { actionLabel, recordHistory } from "@/lib/queries/history";
import { loadOrder } from "@/lib/records";
import { ownedBy } from "@/lib/scope";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata({ params }: PageProps<"/sales/orders/[id]">): Promise<Metadata> {
  const [{ id }, user] = await Promise.all([params, getCurrentUser()]);
  if (!UUID.test(id)) return { title: "Order" };
  const [row] = await getDb()
    .select({ no: schema.orders.orderNo })
    .from(schema.orders)
    .where(and(eq(schema.orders.id, id), ownedBy(user, schema.orders.salesId)));
  return { title: row?.no ?? "Order" };
}

export default async function OrderPage({ params }: PageProps<"/sales/orders/[id]">) {
  const user = await getCurrentUser();
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const o = await loadOrder(user, id);
  if (!o) notFound();
  const db = getDb();
  const order = o.order;
  const [items, payments, [sales], quote, deal, history] = await Promise.all([
    db
      .select({ id: schema.orderItems.id, quantity: schema.orderItems.quantity, unitPrice: schema.orderItems.unitPrice, subtotal: schema.orderItems.subtotal, description: schema.orderItems.description, sku: schema.products.sku, name: schema.products.name, variant: schema.products.variant, unit: schema.products.unit })
      .from(schema.orderItems)
      .leftJoin(schema.products, eq(schema.products.id, schema.orderItems.productId))
      .where(eq(schema.orderItems.orderId, id))
      .orderBy(asc(schema.products.name)),
    db
      .select({ id: schema.orderPayments.id, kind: schema.orderPayments.kind, amount: schema.orderPayments.amount, paidOn: schema.orderPayments.paidOn, method: schema.orderPayments.method, reference: schema.orderPayments.reference, note: schema.orderPayments.note, by: schema.users.name })
      .from(schema.orderPayments)
      .leftJoin(schema.users, eq(schema.users.id, schema.orderPayments.recordedBy))
      .where(eq(schema.orderPayments.orderId, id))
      .orderBy(desc(schema.orderPayments.paidOn), desc(schema.orderPayments.createdAt)),
    order.salesId ? db.select({ name: schema.users.name }).from(schema.users).where(eq(schema.users.id, order.salesId)) : Promise.resolve([undefined]),
    order.quotationId ? db.select({ id: schema.quotations.id, no: schema.quotations.quoteNo }).from(schema.quotations).where(eq(schema.quotations.id, order.quotationId)).then((r) => r[0]) : undefined,
    order.opportunityId ? db.select({ title: schema.opportunities.title }).from(schema.opportunities).where(eq(schema.opportunities.id, order.opportunityId)).then((r) => r[0]) : undefined,
    recordHistory("order", order.orderNo),
  ]);
  const outstanding = order.total - order.paidAmount;
  const depositDue = Math.max(Math.round((order.total * order.depositPct) / 100) - order.paidAmount, 0);
  const live = order.status !== "draft" && order.status !== "cancelled";
  const canPay = live && outstanding > 0 && (o.editable || canRecordPayments(user));
  const discount = Math.round((order.subtotal * order.discountPct) / 100);

  return (
    <>
      <Link href="/sales/orders" className="text-[13px] text-muted hover:text-accent">
        ← Orders
      </Link>
      <PageTitle
        title={order.orderNo}
        description={`${o.account} · ordered ${fdate(order.orderedAt)} · sales ${sales?.name ?? "—"}`}
        actions={
          <>
            <StatusPill map={ORDER_STATUS} value={order.status} />
            <OrderStatusActions
              id={id}
              orderNo={order.orderNo}
              status={order.status}
              delivery={order.deliveryStatus}
              editable={o.editable}
              canDelete={order.status === "draft" && order.paidAmount === 0}
              details={{ depositPct: order.depositPct, reference: order.reference, notes: order.notes }}
            />
          </>
        }
      />
      <Stats
        items={[
          { label: "Total (incl. PPN)", value: rp(order.total) },
          { label: "Paid", value: rp(order.paidAmount), hint: <PaymentPill status={order.paymentStatus} depositPct={order.depositPct} /> },
          { label: "Outstanding", value: rp(outstanding), tone: outstanding > 0 && live ? "warn" : "ok", hint: depositDue > 0 && live ? `Deposit ${order.depositPct}% due: ${rp(depositDue)}` : undefined },
          {
            label: "Delivery",
            value: DELIVERY_STATUS[order.deliveryStatus].label,
            hint: order.deliveredAt ? `Delivered ${fdate(order.deliveredAt)}` : order.shippedAt ? `Shipped ${fdate(order.shippedAt)}` : undefined,
          },
        ]}
      />

      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-5">
          <Panel title="Items" flush>
            <table className="tbl min-w-[600px]">
              <thead>
                <tr>
                  <th>Product</th>
                  <th className="num">Qty</th>
                  <th className="num">Unit price</th>
                  <th className="num">Subtotal</th>
                </tr>
              </thead>
              <tbody>
                {items.map((i) => (
                  <tr key={i.id}>
                    <td>
                      <p className="font-semibold">{i.name ?? i.description ?? "Item"}</p>
                      <p className="text-xs text-muted">{[i.sku, i.variant].filter(Boolean).join(" · ")}</p>
                    </td>
                    <td className="num">
                      {i.quantity} <span className="text-muted">{i.unit}</span>
                    </td>
                    <td className="num">{rp(i.unitPrice)}</td>
                    <td className="num font-semibold">{rp(i.subtotal)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="text-[13px] [&_td]:border-0 [&_td]:py-1">
                <tr>
                  <td colSpan={3} className="px-4 pt-3 text-right text-muted">Subtotal</td>
                  <td className="num px-4 pt-3">{rp(order.subtotal)}</td>
                </tr>
                {order.discountPct > 0 && (
                  <tr>
                    <td colSpan={3} className="px-4 text-right text-muted">Discount {order.discountPct}%</td>
                    <td className="num px-4">− {rp(discount)}</td>
                  </tr>
                )}
                <tr>
                  <td colSpan={3} className="px-4 text-right text-muted">{order.ppn ? "PPN 11%" : "No PPN"}</td>
                  <td className="num px-4">{rp(order.taxAmount)}</td>
                </tr>
                <tr>
                  <td colSpan={3} className="px-4 pb-3 text-right font-bold">Total</td>
                  <td className="num px-4 pb-3 text-base font-bold">{rp(order.total)}</td>
                </tr>
              </tfoot>
            </table>
          </Panel>
          <Panel title="Payments" description="Deposits and settlements. Payment status follows these entries." actions={canPay && <RecordPaymentButton orderId={id} outstanding={outstanding} depositDue={depositDue} />} flush>
            {payments.length === 0 ? (
              <Empty>No payments yet.</Empty>
            ) : (
              <table className="tbl min-w-[560px]">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Type</th>
                    <th>Method / reference</th>
                    <th className="num">Amount</th>
                    {canRecordPayments(user) && (
                      <th>
                        <span className="sr-only">Actions</span>
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {payments.map((p) => (
                    <tr key={p.id}>
                      <td className="whitespace-nowrap">{fdate(p.paidOn)}</td>
                      <td>
                        <StatusPill map={PAYMENT_KIND} value={p.kind} />
                      </td>
                      <td>
                        <p>{[p.method, p.reference].filter(Boolean).join(" · ") || "—"}</p>
                        <p className="text-xs text-muted">
                          {p.note ? `${p.note} · ` : ""}by {p.by ?? "—"}
                        </p>
                      </td>
                      <td className="num font-semibold">{rp(p.amount)}</td>
                      {canRecordPayments(user) && (
                        <td className="text-right">
                          <DeletePaymentButton id={p.id} />
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>
        </div>

        <div className="flex flex-col gap-5">
          <Panel title="Details">
            <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-2 text-[13px]">
              <dt className="text-muted">Account</dt>
              <dd>
                <Link href={`/database/accounts/${order.customerId}`} className="font-semibold hover:text-accent">
                  {o.account}
                </Link>
                <p className="text-xs text-muted">{o.segment}</p>
              </dd>
              <dt className="text-muted">Quotation</dt>
              <dd>
                {quote ? (
                  <Link href={`/sales/quotations/${quote.id}`} className="hover:text-accent">
                    {quote.no}
                  </Link>
                ) : (
                  "Direct order"
                )}
              </dd>
              <dt className="text-muted">Deal</dt>
              <dd>{deal?.title ?? "—"}</dd>
              <dt className="text-muted">Deposit</dt>
              <dd>{order.depositPct}%</dd>
              <dt className="text-muted">Reference</dt>
              <dd>{order.reference ?? "—"}</dd>
            </dl>
            {order.notes && <p className="mt-3 whitespace-pre-line border-t border-line pt-3 text-[13px]">{order.notes}</p>}
          </Panel>
          <Panel title="History" flush>
            <ul className="divide-y divide-line text-[13px]">
              {history.map((h) => (
                <li key={h.id} className="px-4 py-2">
                  <p>
                    <span className="font-semibold">{actionLabel(h.action)}</span> · {h.actor ?? "System"}
                  </p>
                  <p className="text-xs text-muted">{fdatetime(h.at)}</p>
                </li>
              ))}
              {history.length === 0 && <li className="px-4 py-3 text-muted">No changes recorded yet.</li>}
            </ul>
          </Panel>
        </div>
      </div>
    </>
  );
}
