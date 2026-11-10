import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { CompanySettingsForm, OrderSettingsForm, QuotationSettingsForm } from "@/components/forms/settings-forms";
import { guard } from "@/components/page/guard";
import { PageHeader } from "@/components/page/page-header";
import { Panel } from "@/components/ui/panel";
import { getDb, schema } from "@/db";
import { formatNumber, numberParts } from "@/lib/doc-number";
import { canEditSettings } from "@/lib/permissions";
import { now } from "@/lib/scope";
import { getSetting, type Settings } from "@/lib/settings";

export const metadata: Metadata = { title: "Document Templates" };
const HREF = "/settings/templates";

/** The number the next document will get with the saved settings. */
async function nextNumber(docType: "quotation" | "order", s: Settings<"quotation"> | Settings<"order">, at: Date) {
  const p = numberParts(at);
  const period = s.reset === "month" ? `${p.YYYY}${p.MM}` : s.reset === "year" ? p.YYYY : "all";
  const counters = await getDb().select().from(schema.documentCounters).where(eq(schema.documentCounters.docType, docType));
  const last = counters.find((c) => c.period === period)?.lastSeq ?? 0;
  return formatNumber(s.format, s.prefix, last + 1, s.seqDigits, at);
}

export default async function TemplatesPage() {
  const { user, denied } = await guard(HREF);
  if (denied) return denied;
  const at = await now();
  const [company, quotation, order] = await Promise.all([getSetting("company"), getSetting("quotation"), getSetting("order")]);
  const [nextQuote, nextOrder] = await Promise.all([nextNumber("quotation", quotation, at), nextNumber("order", order, at)]);
  const editable = canEditSettings(user);

  return (
    <>
      <PageHeader href={HREF} />
      {!editable && <p className="text-[13px] text-muted">Read-only. Only Admins and Sales Managers can change these settings.</p>}
      <div className="grid gap-5 xl:grid-cols-2">
        <Panel title="Quotation" description={`Next number: ${nextQuote}`}>
          {editable ? <QuotationSettingsForm v={quotation} /> : <Readout rows={[["Format", quotation.format], ["Valid for", `${quotation.validDays} days`], ["Max discount without approval", `${quotation.salesDiscountLimit}%`], ["Terms", quotation.terms]]} />}
        </Panel>
        <Panel title="Sales order" description={`Next number: ${nextOrder}`}>
          {editable ? <OrderSettingsForm v={order} /> : <Readout rows={[["Format", order.format], ["Default deposit", `${order.defaultDepositPct}%`], ["Terms", order.terms]]} />}
        </Panel>
        <Panel title="Company details" description="Printed on the header of quotations." className="xl:col-span-2">
          {editable ? <CompanySettingsForm v={company} /> : <Readout rows={[["Name", company.name], ["Address", company.address], ["Bank", company.bank || "—"]]} />}
        </Panel>
      </div>
    </>
  );
}

function Readout({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="grid grid-cols-[9rem_1fr] gap-x-3 gap-y-2 text-[13px]">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted">{k}</dt>
          <dd className="whitespace-pre-line">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
