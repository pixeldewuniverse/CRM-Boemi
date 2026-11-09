import type { Metadata } from "next";
import Link from "next/link";
import { and, asc, eq, ilike, or } from "drizzle-orm";
import { PageHeader } from "@/components/page/page-header";
import { ExportLink } from "@/components/ui/export-link";
import { SearchBox } from "@/components/ui/filter-chips";
import { Empty, Panel } from "@/components/ui/panel";
import { Pill } from "@/components/ui/pill";
import { getDb, schema } from "@/db";
import { getCurrentUser } from "@/lib/auth";
import { customerScope } from "@/lib/customers";
import { fphone } from "@/lib/format";

export const metadata: Metadata = { title: "Contacts" };
const HREF = "/database/contacts";

export default async function ContactsPage({ searchParams }: PageProps<"/database/contacts">) {
  const user = await getCurrentUser();
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q.trim().slice(0, 100) : "";
  const p = schema.contacts;
  const rows = await getDb()
    .select({
      id: p.id,
      name: p.name,
      position: p.position,
      phone: p.phoneE164,
      email: p.email,
      dm: p.isDecisionMaker,
      accountId: schema.customers.id,
      account: schema.customers.name,
      segment: schema.customers.businessType,
    })
    .from(p)
    .innerJoin(schema.customers, eq(schema.customers.id, p.customerId))
    .where(and(customerScope(user), q ? or(ilike(p.name, `%${q}%`), ilike(schema.customers.name, `%${q}%`), ilike(p.position, `%${q}%`)) : undefined))
    .orderBy(asc(schema.customers.name), asc(p.name))
    .limit(300);

  return (
    <>
      <PageHeader
        href={HREF}
        actions={
          <ExportLink entity="contacts" />
        }
      />
      <SearchBox action={HREF} value={q} placeholder="Search name, account, position…" />
      <Panel flush>
        {rows.length === 0 ? (
          <Empty>No contacts.</Empty>
        ) : (
          <table className="tbl min-w-[860px]">
            <thead>
              <tr>
                <th>Name</th>
                <th>Account</th>
                <th>Phone</th>
                <th>Email</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <p className="font-semibold">
                      {r.name} {r.dm && <Pill tone="accent">Decision maker</Pill>}
                    </p>
                    <p className="text-xs text-muted">{r.position}</p>
                  </td>
                  <td>
                    <Link href={`/database/accounts/${r.accountId}`} className="hover:text-accent">
                      {r.account}
                    </Link>
                    <p className="text-xs text-muted">{r.segment}</p>
                  </td>
                  <td className="whitespace-nowrap">{fphone(r.phone)}</td>
                  <td className="break-all">{r.email ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </>
  );
}
