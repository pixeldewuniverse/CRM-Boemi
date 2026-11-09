import type { Metadata } from "next";
import { guard } from "@/components/page/guard";
import { PageHeader } from "@/components/page/page-header";
import { Panel } from "@/components/ui/panel";
import { PPN_RATE } from "@/lib/pricing";

export const metadata: Metadata = { title: "Document Templates" };
const HREF = "/settings/templates";

const DOCS = [
  {
    name: "Quotation",
    numbering: "Q-YYMM-NNN (e.g. Q-2611-012)",
    rules: ["Price tier chosen from the account segment", `PPN ${PPN_RATE * 100}% shown separately`, "Valid for 30 days", "Discount up to 10% without manager approval"],
    terms: "Prices in Rupiah. Delivery within Bali 3–5 working days after payment of deposit.",
  },
  {
    name: "Sales order",
    numbering: "SO-YYMM-NNN (e.g. SO-2611-004)",
    rules: ["Created from an accepted quotation or as a repeat order", "Default deposit 50% for new hotel accounts", "Retail partners on 30-day terms"],
    terms: "Goods remain our property until paid in full. Complaints within 7 days of delivery.",
  },
  {
    name: "Consignment settlement",
    numbering: "CS-YYMM-<account>",
    rules: ["Monthly per outlet", "Commission per agreement (20–30%)"],
    terms: "Settlement invoice issued by the 5th of the following month.",
  },
];

export default async function TemplatesPage() {
  const { denied } = await guard(HREF);
  if (denied) return denied;
  return (
    <>
      <PageHeader href={HREF} />
      <div className="grid gap-5 lg:grid-cols-3">
        {DOCS.map((d) => (
          <Panel key={d.name} title={d.name} description={d.numbering}>
            <ul className="list-disc space-y-1 pl-5 text-[13px]">
              {d.rules.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
            <p className="mt-3 border-t border-line pt-3 text-[13px] text-muted">
              <span className="font-semibold text-fg">Terms: </span>
              {d.terms}
            </p>
          </Panel>
        ))}
      </div>
      <p className="text-[13px] text-muted">Editing templates and PDF output come with the quotation module build.</p>
    </>
  );
}
