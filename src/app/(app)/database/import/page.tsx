import type { Metadata } from "next";
import { and, count, desc, eq } from "drizzle-orm";
import { ImportButton } from "@/components/forms/import-wizard";
import { PageHeader } from "@/components/page/page-header";
import { ExportLink } from "@/components/ui/export-link";
import { Empty, Panel } from "@/components/ui/panel";
import { getDb, schema } from "@/db";
import { getCurrentUser } from "@/lib/auth";
import { fdatetime, num } from "@/lib/format";
import { IMPORT_FIELDS, type ImportEntity } from "@/lib/import/fields";
import { canImport, canImportEntity } from "@/lib/permissions";
import { assignableReps } from "@/lib/queries/options";

export const metadata: Metadata = { title: "Import / Export" };

const ENTITY_LABEL: Record<string, string> = { customer: "Accounts", accounts: "Accounts", contacts: "Contacts", leads: "Leads", products: "Products", employees: "Employees", kpi_target: "Sales targets" };

export default async function ImportExportPage() {
  const user = await getCurrentUser();
  const db = getDb();
  const importer = canImport(user);
  const [[leads], [accounts], [contacts], [products], [orders], [users], [targets], owners, recent] = await Promise.all([
    db.select({ n: count() }).from(schema.leads),
    db.select({ n: count() }).from(schema.customers),
    db.select({ n: count() }).from(schema.contacts),
    db.select({ n: count() }).from(schema.products),
    db.select({ n: count() }).from(schema.orders),
    db.select({ n: count() }).from(schema.users),
    db.select({ n: count() }).from(schema.kpiTargets),
    importer ? assignableReps() : Promise.resolve([]),
    importer
      ? db
          .select({ id: schema.auditLogs.id, entity: schema.auditLogs.entity, file: schema.auditLogs.entityId, changes: schema.auditLogs.changes, at: schema.auditLogs.createdAt, who: schema.users.name })
          .from(schema.auditLogs)
          .leftJoin(schema.users, eq(schema.users.id, schema.auditLogs.actorId))
          .where(and(eq(schema.auditLogs.action, "import")))
          .orderBy(desc(schema.auditLogs.createdAt))
          .limit(8)
      : Promise.resolve([]),
  ]);
  const cols = (e: ImportEntity) =>
    IMPORT_FIELDS[e]
      .map((f) => f.label + (f.required ? "*" : ""))
      .join(", ");
  const entities: { key: string; label: string; n: number; importKey?: ImportEntity; columns: string; owners?: boolean }[] = [
    { key: "accounts", label: "Accounts", n: accounts.n, importKey: "accounts", columns: cols("accounts"), owners: true },
    { key: "contacts", label: "Contacts", n: contacts.n, importKey: "contacts", columns: cols("contacts") },
    { key: "leads", label: "Leads", n: leads.n, importKey: "leads", columns: cols("leads"), owners: true },
    { key: "products", label: "Products", n: products.n, importKey: "products", columns: cols("products") },
    { key: "employees", label: "Employees", n: users.n, importKey: "employees", columns: cols("employees") },
    { key: "targets", label: "Sales targets", n: targets.n, importKey: "targets", columns: cols("targets") },
    { key: "orders", label: "Orders", n: orders.n, columns: "Export only" },
  ];
  const EXPORTABLE = ["leads", "accounts", "contacts", "products", "orders"];

  return (
    <>
      <PageHeader href="/database/import" />
      <Panel flush>
        <table className="tbl min-w-[860px]">
          <thead>
            <tr>
              <th>Data</th>
              <th className="num">Records</th>
              <th>Import columns (* required)</th>
              <th className="text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {entities.map((e) => {
              const allowed = e.importKey && canImportEntity(user, e.importKey);
              return (
                <tr key={e.key}>
                  <td className="font-semibold">{e.label}</td>
                  <td className="num">{num(e.n)}</td>
                  <td className="max-w-md text-xs text-muted">{e.columns}</td>
                  <td>
                    <span className="flex flex-wrap justify-end gap-2">
                      {allowed && (
                        <>
                          <a href={`/api/import/template/${e.importKey}`} className="btn">
                            Template
                          </a>
                          <ImportButton entity={e.importKey!} owners={e.owners ? owners : []} />
                        </>
                      )}
                      {e.importKey && !allowed && (
                        <button type="button" className="btn" disabled title={e.key === "employees" && importer ? "Admins only" : "Admins and sales managers only"}>
                          Import CSV
                        </button>
                      )}
                      {EXPORTABLE.includes(e.key) && <ExportLink entity={e.key} />}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Panel>
      <p className="text-[13px] text-muted">
        Exports include only the records you can see. Phone numbers start with an apostrophe (&apos;+62…) so spreadsheets keep them as text instead of turning them into formulas.
        Imports check every row first (phone numbers become +62…, duplicates are matched by phone, email, SKU or user email) — nothing is saved until you confirm. Imported employees stay inactive until they&apos;re invited.
      </p>
      {importer && (
        <Panel title="Recent imports" flush>
          {recent.length === 0 ? (
            <Empty>No imports yet.</Empty>
          ) : (
            <table className="tbl min-w-[640px]">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Data</th>
                  <th>File</th>
                  <th className="num">Rows</th>
                  <th>Result</th>
                  <th>By</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((r) => {
                  const c = (r.changes ?? {}) as Record<string, number>;
                  return (
                    <tr key={r.id}>
                      <td className="whitespace-nowrap">{fdatetime(r.at)}</td>
                      <td>{ENTITY_LABEL[r.entity] ?? r.entity}</td>
                      <td className="max-w-56 truncate" title={r.file ?? ""}>
                        {r.file}
                      </td>
                      <td className="num">{num(c.rows)}</td>
                      <td className="text-xs">
                        {num(c.created)} added · {num(c.updated)} updated · {num(c.skipped)} skipped
                        {c.failed ? <span className="text-bad"> · {num(c.failed)} failed</span> : null}
                      </td>
                      <td>{r.who}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Panel>
      )}
    </>
  );
}
