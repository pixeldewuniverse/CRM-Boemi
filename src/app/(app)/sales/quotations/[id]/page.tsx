import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq, inArray } from "drizzle-orm";
import { EditQuotationButton } from "@/components/forms/doc-forms";
import { QuoteStatusActions } from "@/components/forms/doc-actions";
import { PageTitle } from "@/components/page/page-title";
import { Panel } from "@/components/ui/panel";
import { Pill, StatusPill } from "@/components/ui/pill";
import { getDb, schema } from "@/db";
import { getCurrentUser } from "@/lib/auth";
import { daysBetween, fdate, fdatetime, rp } from "@/lib/format";
import { QUOTE_APPROVAL, QUOTE_STATUS } from "@/lib/labels";
import { PRICE_TIERS, type PriceTier } from "@/lib/pricing";
import { canApproveDiscounts } from "@/lib/permissions";
import { docFormOptions } from "@/lib/queries/docs";
import { actionLabel, recordHistory } from "@/lib/queries/history";
import { loadQuotation } from "@/lib/records";
import { now, ownedBy } from "@/lib/scope";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata({ params }: PageProps<"/sales/quotations/[id]">): Promise<Metadata> {
  const [{ id }, user] = await Promise.all([params, getCurrentUser()]);
  if (!UUID.test(id)) return { title: "Quotation" };
  const [row] = await getDb()
    .select({ no: schema.quotations.quoteNo })
    .from(schema.quotations)
    .where(and(eq(schema.quotations.id, id), ownedBy(user, schema.quotations.ownerId)));
  return { title: row?.no ?? "Quotation" };
}

export default async function QuotationPage({ params }: PageProps<"/sales/quotations/[id]">) {
  const user = await getCurrentUser();
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const q = await loadQuotation(user, id);
  if (!q) notFound();
  const db = getDb();
  const quote = q.quote;
  const people = [quote.ownerId, quote.approvedBy].filter((x): x is string => Boolean(x));
  const [items, users, deal, order, history, form, today] = await Promise.all([
    db
      .select({ id: schema.quotationItems.id, productId: schema.quotationItems.productId, quantity: schema.quotationItems.quantity, unitPrice: schema.quotationItems.unitPrice, subtotal: schema.quotationItems.subtotal, sku: schema.products.sku, name: schema.products.name, variant: schema.products.variant, unit: schema.products.unit })
      .from(schema.quotationItems)
      .leftJoin(schema.products, eq(schema.products.id, schema.quotationItems.productId))
      .where(eq(schema.quotationItems.quotationId, id))
      .orderBy(asc(schema.products.name)),
    people.length ? db.select({ id: schema.users.id, name: schema.users.name }).from(schema.users).where(inArray(schema.users.id, people)) : [],
    quote.opportunityId ? db.select({ id: schema.opportunities.id, title: schema.opportunities.title }).from(schema.opportunities).where(eq(schema.opportunities.id, quote.opportunityId)).then((r) => r[0]) : undefined,
    db.select({ id: schema.orders.id, no: schema.orders.orderNo }).from(schema.orders).where(eq(schema.orders.quotationId, id)).then((r) => r[0]),
    recordHistory("quotation", quote.quoteNo),
    q.editable && quote.status === "draft" ? docFormOptions(user, quote.customerId) : null,
    now(),
  ]);
  const name = (uid: string | null) => users.find((u) => u.id === uid)?.name ?? "—";
  const discount = Math.round((quote.subtotal * quote.discountPct) / 100);
  const left = quote.validUntil ? daysBetween(today, quote.validUntil) : null;

  return (
    <>
      <Link href="/sales/quotations" className="text-[13px] text-muted hover:text-accent">
        ← Quotations
      </Link>
      <PageTitle
        title={quote.quoteNo}
        description={`${q.account} · ${PRICE_TIERS[(quote.priceTier ?? "retail") as PriceTier]?.label ?? "Retail"} prices · owner ${name(quote.ownerId)}`}
        actions={
          <>
            <StatusPill map={QUOTE_STATUS} value={quote.status} />
            <Link href={`/print/quotations/${id}`} target="_blank" className="btn">
              Print / PDF
            </Link>
            {form && (
              <EditQuotationButton
                {...form}
                edit={{
                  id,
                  customerId: quote.customerId,
                  segment: q.segment,
                  opportunityId: quote.opportunityId,
                  issuedOn: quote.issuedOn,
                  validUntil: quote.validUntil,
                  discountPct: quote.discountPct,
                  ppn: quote.ppn,
                  notes: quote.notes,
                  terms: quote.terms,
                  lines: items.filter((i) => i.productId).map((i) => ({ productId: i.productId!, quantity: i.quantity })),
                }}
              />
            )}
            <QuoteStatusActions
              id={id}
              quoteNo={quote.quoteNo}
              status={quote.status}
              approval={quote.approval}
              editable={q.editable}
              canReview={canApproveDiscounts(user)}
              hasOrder={Boolean(order)}
            />
          </>
        }
      />

      {quote.approval !== "not_required" && (
        <div
          className={`rounded-xl border px-4 py-3 text-[13px] ${
            quote.approval === "pending" ? "border-warn bg-warn-soft" : quote.approval === "rejected" ? "border-bad bg-bad-soft" : "border-line bg-surface"
          }`}
        >
          <p className="font-semibold">
            {QUOTE_APPROVAL[quote.approval].label} · {quote.discountPct}% discount
          </p>
          <p className="text-muted">
            {quote.approval === "pending"
              ? "A sales manager must approve this discount before the quotation can be sent."
              : `${quote.approval === "approved" ? "Approved" : "Rejected"} by ${name(quote.approvedBy)} on ${fdatetime(quote.approvedAt)}.`}
            {quote.approvalNote && ` “${quote.approvalNote}”`}
            {quote.approval === "rejected" && " Lower the discount and save to ask again."}
          </p>
        </div>
      )}
      {order && (
        <p className="rounded-xl border border-ok bg-ok-soft px-4 py-3 text-[13px]">
          Converted to order{" "}
          <Link href={`/sales/orders/${order.id}`} className="font-semibold text-ok underline">
            {order.no}
          </Link>
          .
        </p>
      )}

      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Panel title="Items" flush className="self-start">
          <table className="tbl min-w-[620px]">
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
                    <p className="font-semibold">{i.name ?? "Deleted product"}</p>
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
                <td className="num px-4 pt-3">{rp(quote.subtotal)}</td>
              </tr>
              {quote.discountPct > 0 && (
                <tr>
                  <td colSpan={3} className="px-4 text-right text-muted">Discount {quote.discountPct}%</td>
                  <td className="num px-4">− {rp(discount)}</td>
                </tr>
              )}
              <tr>
                <td colSpan={3} className="px-4 text-right text-muted">{quote.ppn ? "PPN 11%" : "No PPN"}</td>
                <td className="num px-4">{rp(quote.taxAmount)}</td>
              </tr>
              <tr>
                <td colSpan={3} className="px-4 pb-3 text-right font-bold">Total</td>
                <td className="num px-4 pb-3 text-base font-bold">{rp(quote.total)}</td>
              </tr>
            </tfoot>
          </table>
        </Panel>

        <div className="flex flex-col gap-5">
          <Panel title="Details">
            <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-2 text-[13px]">
              <dt className="text-muted">Account</dt>
              <dd>
                <Link href={`/database/accounts/${quote.customerId}`} className="font-semibold hover:text-accent">
                  {q.account}
                </Link>
                <p className="text-xs text-muted">{q.segment}</p>
              </dd>
              <dt className="text-muted">Deal</dt>
              <dd>{deal?.title ?? "—"}</dd>
              <dt className="text-muted">Issued</dt>
              <dd>{fdate(quote.issuedOn)}</dd>
              <dt className="text-muted">Valid until</dt>
              <dd>
                {fdate(quote.validUntil)}
                {quote.status === "sent" && left !== null && left <= 7 && (
                  <span className="ml-2">
                    <Pill tone="warn">{left < 0 ? "Expires tonight" : `${left} days left`}</Pill>
                  </span>
                )}
              </dd>
              <dt className="text-muted">Sent</dt>
              <dd>{fdatetime(quote.sentAt)}</dd>
              {quote.decidedAt && (
                <>
                  <dt className="text-muted">Closed</dt>
                  <dd>{fdatetime(quote.decidedAt)}</dd>
                </>
              )}
            </dl>
            {quote.notes && <p className="mt-3 whitespace-pre-line border-t border-line pt-3 text-[13px]">{quote.notes}</p>}
          </Panel>
          {quote.terms && (
            <Panel title="Terms & conditions">
              <p className="whitespace-pre-line text-[13px] text-muted">{quote.terms}</p>
            </Panel>
          )}
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
