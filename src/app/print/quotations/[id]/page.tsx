import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, desc, eq } from "drizzle-orm";
import { PrintButton } from "@/components/print-button";
import { getDb, schema } from "@/db";
import { getCurrentUser } from "@/lib/auth";
import { fdate, fphone, rp } from "@/lib/format";
import { QUOTE_STATUS } from "@/lib/labels";
import { loadQuotation } from "@/lib/records";
import { ownedBy } from "@/lib/scope";
import { getSetting } from "@/lib/settings";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata({ params }: PageProps<"/print/quotations/[id]">): Promise<Metadata> {
  const [{ id }, user] = await Promise.all([params, getCurrentUser()]);
  if (!UUID.test(id)) return { title: "Quotation" };
  const [row] = await getDb()
    .select({ no: schema.quotations.quoteNo })
    .from(schema.quotations)
    .where(and(eq(schema.quotations.id, id), ownedBy(user, schema.quotations.ownerId)));
  // The PDF file name defaults to the page title.
  return { title: { absolute: row ? `Quotation ${row.no}` : "Quotation" } };
}

/** A4 quotation for the customer. Uses the browser's "Save as PDF". */
export default async function PrintQuotation({ params }: PageProps<"/print/quotations/[id]">) {
  const user = await getCurrentUser();
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const q = await loadQuotation(user, id);
  if (!q) notFound();
  const db = getDb();
  const quote = q.quote;
  const [items, [customer], [contact], [owner], company] = await Promise.all([
    db
      .select({ id: schema.quotationItems.id, quantity: schema.quotationItems.quantity, unitPrice: schema.quotationItems.unitPrice, subtotal: schema.quotationItems.subtotal, sku: schema.products.sku, name: schema.products.name, variant: schema.products.variant, unit: schema.products.unit })
      .from(schema.quotationItems)
      .leftJoin(schema.products, eq(schema.products.id, schema.quotationItems.productId))
      .where(eq(schema.quotationItems.quotationId, id))
      .orderBy(asc(schema.products.name)),
    db.select({ name: schema.customers.name, address: schema.customers.address, city: schema.customers.city, phone: schema.customers.phoneE164, email: schema.customers.email }).from(schema.customers).where(eq(schema.customers.id, quote.customerId)),
    db
      .select({ name: schema.contacts.name, position: schema.contacts.position })
      .from(schema.contacts)
      .where(eq(schema.contacts.customerId, quote.customerId))
      .orderBy(desc(schema.contacts.isDecisionMaker), asc(schema.contacts.createdAt))
      .limit(1),
    quote.ownerId ? db.select({ name: schema.users.name, email: schema.users.email, phone: schema.users.phone }).from(schema.users).where(eq(schema.users.id, quote.ownerId)) : Promise.resolve([undefined]),
    getSetting("company"),
  ]);
  const discount = Math.round((quote.subtotal * quote.discountPct) / 100);
  const draft = quote.status === "draft";

  return (
    <>
      <style>{`@page { size: A4; margin: 14mm; } @media print { body { background: #fff !important; } }`}</style>
      <div className="mx-auto mb-4 flex max-w-[210mm] flex-wrap items-center gap-2 px-4 print:hidden">
        <Link href={`/sales/quotations/${id}`} className="text-[13px] text-muted hover:text-accent">
          ← Back to {quote.quoteNo}
        </Link>
        <span className="ml-auto" />
        {draft && <span className="text-[13px] text-warn">Draft — printed with a DRAFT mark.</span>}
        <PrintButton />
      </div>
      <article className="relative mx-auto min-h-[297mm] max-w-[210mm] bg-white p-[14mm] text-[12px] leading-relaxed text-neutral-900 shadow-panel print:min-h-0 print:max-w-none print:p-0 print:shadow-none">
        {draft && (
          <p aria-hidden="true" className="pointer-events-none absolute inset-0 flex items-center justify-center text-[120px] font-black tracking-widest text-neutral-200/70 [transform:rotate(-24deg)]">
            DRAFT
          </p>
        )}
        <header className="relative flex flex-wrap items-start justify-between gap-6 border-b-2 border-neutral-900 pb-4">
          <div>
            <p className="text-xl font-extrabold tracking-wide">{company.name}</p>
            <p className="whitespace-pre-line text-neutral-600">{company.address}</p>
            <p className="text-neutral-600">{[company.phone, company.email].filter(Boolean).join(" · ")}</p>
            {company.taxId && <p className="text-neutral-600">NPWP {company.taxId}</p>}
          </div>
          <div className="text-right">
            <h1 className="text-2xl font-extrabold tracking-[0.2em]">QUOTATION</h1>
            <p className="font-semibold">{quote.quoteNo}</p>
            {!["draft", "sent"].includes(quote.status) && <p className="text-neutral-600">Status: {QUOTE_STATUS[quote.status].label}</p>}
          </div>
        </header>

        <section className="relative mt-5 grid grid-cols-2 gap-6">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">To</p>
            <p className="font-bold">{customer.name}</p>
            {contact && <p>Attn. {contact.name}{contact.position ? `, ${contact.position}` : ""}</p>}
            {customer.address && <p>{customer.address}</p>}
            {customer.city && <p>{customer.city}</p>}
            <p className="text-neutral-600">{[customer.phone ? fphone(customer.phone) : null, customer.email].filter(Boolean).join(" · ")}</p>
          </div>
          <dl className="grid grid-cols-[auto_1fr] content-start gap-x-4 gap-y-0.5 justify-self-end text-right">
            <dt className="text-neutral-500">Date</dt>
            <dd className="font-semibold">{fdate(quote.issuedOn)}</dd>
            <dt className="text-neutral-500">Valid until</dt>
            <dd className="font-semibold">{fdate(quote.validUntil)}</dd>
            {owner && (
              <>
                <dt className="text-neutral-500">Sales</dt>
                <dd>{owner.name}</dd>
              </>
            )}
          </dl>
        </section>

        <table className="relative mt-6 w-full border-collapse text-left">
          <thead>
            <tr className="border-y border-neutral-900 text-[11px] uppercase tracking-wider">
              <th className="py-2 pr-2">#</th>
              <th className="py-2 pr-2">Product</th>
              <th className="py-2 pr-2 text-right">Qty</th>
              <th className="py-2 pr-2 text-right">Unit price</th>
              <th className="py-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {items.map((i, n) => (
              <tr key={i.id} className="break-inside-avoid border-b border-neutral-200 align-top">
                <td className="py-2 pr-2 text-neutral-500">{n + 1}</td>
                <td className="py-2 pr-2">
                  <p className="font-semibold">{i.name ?? "Product"}</p>
                  <p className="text-neutral-500">{[i.sku, i.variant].filter(Boolean).join(" · ")}</p>
                </td>
                <td className="whitespace-nowrap py-2 pr-2 text-right tabular-nums">
                  {i.quantity} {i.unit}
                </td>
                <td className="whitespace-nowrap py-2 pr-2 text-right tabular-nums">{rp(i.unitPrice)}</td>
                <td className="whitespace-nowrap py-2 text-right tabular-nums">{rp(i.subtotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <dl className="relative ml-auto mt-3 grid w-72 grid-cols-[1fr_auto] gap-x-4 gap-y-1 tabular-nums">
          <dt className="text-neutral-600">Subtotal</dt>
          <dd className="text-right">{rp(quote.subtotal)}</dd>
          {quote.discountPct > 0 && (
            <>
              <dt className="text-neutral-600">Discount {quote.discountPct}%</dt>
              <dd className="text-right">− {rp(discount)}</dd>
            </>
          )}
          <dt className="text-neutral-600">{quote.ppn ? "PPN 11%" : "PPN"}</dt>
          <dd className="text-right">{quote.ppn ? rp(quote.taxAmount) : "Not included"}</dd>
          <dt className="border-t border-neutral-900 pt-1 text-sm font-bold">Total</dt>
          <dd className="border-t border-neutral-900 pt-1 text-right text-sm font-bold">{rp(quote.total)}</dd>
        </dl>

        {quote.notes && (
          <section className="relative mt-6 break-inside-avoid">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">Notes</p>
            <p className="whitespace-pre-line">{quote.notes}</p>
          </section>
        )}
        {quote.terms && (
          <section className="relative mt-4 break-inside-avoid">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">Terms & conditions</p>
            <p className="whitespace-pre-line text-neutral-700">{quote.terms}</p>
          </section>
        )}
        {company.bank && (
          <section className="relative mt-4 break-inside-avoid">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">Payment</p>
            <p className="whitespace-pre-line">{company.bank}</p>
          </section>
        )}

        <footer className="relative mt-12 grid break-inside-avoid grid-cols-2 gap-10">
          <div>
            <p className="text-neutral-500">Prepared by</p>
            <p className="mt-14 border-t border-neutral-400 pt-1 font-semibold">{owner?.name ?? company.name}</p>
            <p className="text-neutral-500">{[owner?.phone ? fphone(owner.phone) : null, owner?.email].filter(Boolean).join(" · ")}</p>
          </div>
          <div>
            <p className="text-neutral-500">Accepted by</p>
            <p className="mt-14 border-t border-neutral-400 pt-1 text-neutral-500">Name, signature & company stamp</p>
          </div>
        </footer>
      </article>
    </>
  );
}
