import type { Metadata } from "next";
import { count } from "drizzle-orm";
import { PageHeader } from "@/components/page/page-header";
import { ExportLink } from "@/components/ui/export-link";
import { Panel } from "@/components/ui/panel";
import { getDb, schema } from "@/db";
import { getCurrentUser } from "@/lib/auth";
import { num } from "@/lib/format";

export const metadata: Metadata = { title: "Import / Export" };

export default async function ImportExportPage() {
  await getCurrentUser();
  const db = getDb();
  const [[leads], [accounts], [contacts], [products], [orders]] = await Promise.all([
    db.select({ n: count() }).from(schema.leads),
    db.select({ n: count() }).from(schema.customers),
    db.select({ n: count() }).from(schema.contacts),
    db.select({ n: count() }).from(schema.products),
    db.select({ n: count() }).from(schema.orders),
  ]);
  const entities = [
    { key: "leads", label: "Leads", n: leads.n, columns: "Company, PIC, phone, segment, city, source" },
    { key: "accounts", label: "Accounts", n: accounts.n, columns: "Name, segment, city, phone, email, source, owner" },
    { key: "contacts", label: "Contacts", n: contacts.n, columns: "Account, name, position, phone, email" },
    { key: "products", label: "Products", n: products.n, columns: "SKU, name, size, category, retail price, stock" },
    { key: "orders", label: "Orders", n: orders.n, columns: "Export only" },
  ];

  return (
    <>
      <PageHeader href="/database/import" />
      <Panel flush>
        <table className="tbl min-w-[760px]">
          <thead>
            <tr>
              <th>Data</th>
              <th className="num">Records</th>
              <th>Import columns</th>
              <th className="text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {entities.map((e) => (
              <tr key={e.key}>
                <td className="font-semibold">{e.label}</td>
                <td className="num">{num(e.n)}</td>
                <td className="text-muted">{e.columns}</td>
                <td className="text-right">
                  <span className="inline-flex gap-2">
                    {e.key !== "orders" && (
                      <button type="button" className="btn" disabled title="Coming in the next build">
                        Import CSV
                      </button>
                    )}
                    <ExportLink entity={e.key} />
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
      <p className="text-[13px] text-muted">
        Exports include only the records you can see. Phone numbers start with an apostrophe (&apos;+62…) so spreadsheets keep them as text instead of turning them into formulas.
        Import will check duplicates by phone number and email before saving.
      </p>
    </>
  );
}
