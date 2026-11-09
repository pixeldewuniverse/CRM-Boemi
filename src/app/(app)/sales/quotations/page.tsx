import type { Metadata } from "next";
import Link from "next/link";
import { and, count, desc, eq } from "drizzle-orm";
import { PageHeader } from "@/components/page/page-header";
import { FilterChips } from "@/components/ui/filter-chips";
import { Empty, Panel } from "@/components/ui/panel";
import { StatusPill } from "@/components/ui/pill";
import { getDb, schema } from "@/db";
import { getCurrentUser } from "@/lib/auth";
import { daysBetween, fdate, rp } from "@/lib/format";
import { QUOTE_STATUS } from "@/lib/labels";
import { PRICE_TIERS, type PriceTier } from "@/lib/pricing";
import { now, ownedBy } from "@/lib/scope";

export const metadata: Metadata = { title: "Quotations" };
const HREF = "/sales/quotations";
const STATUSES = ["draft", "sent", "accepted", "rejected", "expired"] as const;
type Status = (typeof STATUSES)[number];

export default async function QuotationsPage({ searchParams }: PageProps<"/sales/quotations">) {
  const user = await getCurrentUser();
  const params = await searchParams;
  const status = STATUSES.includes(params.status as Status) ? (params.status as Status) : undefined;
  const today = await now();
  const db = getDb();
  const qt = schema.quotations;
  const scope = ownedBy(user, qt.ownerId);

  const [rows, counts, itemCounts] = await Promise.all([
    db
      .select({
        id: qt.id,
        no: qt.quoteNo,
        status: qt.status,
        issued: qt.issuedOn,
        valid: qt.validUntil,
        tier: qt.priceTier,
        discount: qt.discountPct,
        total: qt.total,
        accountId: schema.customers.id,
        account: schema.customers.name,
        deal: schema.opportunities.title,
        owner: schema.users.name,
      })
      .from(qt)
      .innerJoin(schema.customers, eq(schema.customers.id, qt.customerId))
      .leftJoin(schema.opportunities, eq(schema.opportunities.id, qt.opportunityId))
      .leftJoin(schema.users, eq(schema.users.id, qt.ownerId))
      .where(and(scope, status ? eq(qt.status, status) : undefined))
      .orderBy(desc(qt.issuedOn)),
    db.select({ status: qt.status, n: count() }).from(qt).where(scope).groupBy(qt.status),
    db
      .select({ id: schema.quotationItems.quotationId, n: count() })
      .from(schema.quotationItems)
      .groupBy(schema.quotationItems.quotationId),
  ]);
  const byStatus = Object.fromEntries(counts.map((c) => [c.status, c.n]));
  const lines = Object.fromEntries(itemCounts.map((c) => [c.id, c.n]));

  return (
    <>
      <PageHeader href={HREF} />
      <FilterChips
        pathname={HREF}
        param="status"
        value={status}
        options={[
          { value: undefined, label: "All", count: counts.reduce((s, c) => s + c.n, 0) },
          ...STATUSES.map((s) => ({ value: s, label: QUOTE_STATUS[s].label, count: byStatus[s] ?? 0 })),
        ]}
      />
      <Panel flush>
        {rows.length === 0 ? (
          <Empty>No quotations.</Empty>
        ) : (
          <table className="tbl min-w-[960px]">
            <thead>
              <tr>
                <th>Quotation</th>
                <th>Account / deal</th>
                <th>Price tier</th>
                <th className="num">Issued</th>
                <th className="num">Valid until</th>
                <th className="num">Total (incl. PPN)</th>
                <th>Status</th>
                <th>Owner</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const left = r.valid ? daysBetween(today, r.valid) : null;
                const expiring = r.status === "sent" && left !== null && left <= 7;
                return (
                  <tr key={r.id}>
                    <td>
                      <p className="font-semibold">{r.no}</p>
                      <p className="text-xs text-muted">{lines[r.id] ?? 0} items{r.discount ? ` · ${r.discount}% off` : ""}</p>
                    </td>
                    <td>
                      <Link href={`/database/accounts/${r.accountId}`} className="font-semibold hover:text-accent">
                        {r.account}
                      </Link>
                      <p className="text-xs text-muted">{r.deal ?? "—"}</p>
                    </td>
                    <td>{r.tier ? PRICE_TIERS[r.tier as PriceTier]?.label : "—"}</td>
                    <td className="num">{fdate(r.issued)}</td>
                    <td className="num">
                      <span className={expiring ? "font-semibold text-warn" : ""}>{fdate(r.valid)}</span>
                      {expiring && <p className="text-xs text-warn">{left! < 0 ? "Expired" : `${left} days left`}</p>}
                    </td>
                    <td className="num font-semibold">{rp(r.total)}</td>
                    <td>
                      <StatusPill map={QUOTE_STATUS} value={r.status} />
                    </td>
                    <td>{r.owner}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Panel>
    </>
  );
}
