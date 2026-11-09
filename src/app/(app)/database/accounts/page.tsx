import type { Metadata } from "next";
import Link from "next/link";
import { and, desc, eq, ilike, ne, or, sql } from "drizzle-orm";
import { PageHeader } from "@/components/page/page-header";
import { ExportLink } from "@/components/ui/export-link";
import { TierBadge } from "@/components/tier-badge";
import { FilterChips, SearchBox } from "@/components/ui/filter-chips";
import { Empty, Panel } from "@/components/ui/panel";
import { StatusPill } from "@/components/ui/pill";
import { getDb, schema } from "@/db";
import { getCurrentUser } from "@/lib/auth";
import { customerScope } from "@/lib/customers";
import { fdate, rpk } from "@/lib/format";
import { CUSTOMER_STATUS, SEGMENTS } from "@/lib/labels";

export const metadata: Metadata = { title: "Accounts" };
const HREF = "/database/accounts";
const TIERS = ["hot", "warm", "cold"] as const;
type Tier = (typeof TIERS)[number];

export default async function AccountsPage({ searchParams }: PageProps<"/database/accounts">) {
  const user = await getCurrentUser();
  const params = await searchParams;
  const tier = TIERS.includes(params.tier as Tier) ? (params.tier as Tier) : undefined;
  const segment = (SEGMENTS as readonly string[]).includes(params.segment as string) ? (params.segment as string) : undefined;
  const q = typeof params.q === "string" ? params.q.trim().slice(0, 100) : "";
  const c = schema.customers;
  const o = schema.orders;

  const rows = await getDb()
    .select({
      id: c.id,
      name: c.name,
      segment: c.businessType,
      city: c.city,
      status: c.status,
      source: c.source,
      score: c.qualificationScore,
      tier: c.qualificationTier,
      reason: c.qualificationReason,
      owner: schema.users.name,
      revenue: sql<number>`coalesce(sum(${o.total}), 0)`.mapWith(Number),
      lastOrder: sql<Date | null>`max(${o.orderedAt})`,
    })
    .from(c)
    .leftJoin(schema.users, eq(schema.users.id, c.ownerId))
    .leftJoin(o, and(eq(o.customerId, c.id), ne(o.status, "cancelled")))
    .where(
      and(
        customerScope(user),
        tier ? eq(c.qualificationTier, tier) : undefined,
        segment ? eq(c.businessType, segment) : undefined,
        q ? or(ilike(c.name, `%${q}%`), ilike(c.city, `%${q}%`), ilike(c.phoneE164, `%${q.replace(/\D/g, "") || q}%`)) : undefined,
      ),
    )
    .groupBy(c.id, schema.users.name)
    .orderBy(sql`${c.qualificationScore} desc nulls last`, desc(c.createdAt))
    .limit(200);

  return (
    <>
      <PageHeader
        href={HREF}
        actions={
          <ExportLink entity="accounts" />
        }
      />
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <FilterChips
            pathname={HREF}
            param="segment"
            value={segment}
            keep={{ tier, q }}
            options={[{ value: undefined, label: "All segments" }, ...SEGMENTS.map((s) => ({ value: s, label: s }))]}
          />
          <div className="ml-auto">
            <SearchBox action={HREF} value={q} placeholder="Search name, city, phone…" keep={{ tier, segment }} />
          </div>
        </div>
        <FilterChips
          pathname={HREF}
          param="tier"
          value={tier}
          keep={{ segment, q }}
          options={[{ value: undefined, label: "Any score" }, ...TIERS.map((t) => ({ value: t, label: t[0].toUpperCase() + t.slice(1) }))]}
        />
      </div>

      <Panel flush>
        {rows.length === 0 ? (
          <Empty>No accounts match this filter.</Empty>
        ) : (
          <table className="tbl min-w-[1000px]">
            <thead>
              <tr>
                <th>Account</th>
                <th>Segment</th>
                <th>Qualification</th>
                <th>Status</th>
                <th className="num">Lifetime revenue</th>
                <th className="num">Last order</th>
                <th>Owner</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link href={`${HREF}/${r.id}`} className="font-semibold hover:text-accent">
                      {r.name}
                    </Link>
                    <p className="text-xs text-muted">
                      {r.city} · via {r.source ?? "—"}
                    </p>
                  </td>
                  <td>{r.segment}</td>
                  <td className="max-w-64">
                    <span className="mr-2 font-semibold tabular-nums">{r.score ?? "—"}</span>
                    <TierBadge tier={r.tier} />
                    {r.reason && <p className="mt-1 text-xs text-muted">{r.reason}</p>}
                  </td>
                  <td>
                    <StatusPill map={CUSTOMER_STATUS} value={r.status} />
                  </td>
                  <td className="num font-semibold">{r.revenue ? rpk(r.revenue) : "—"}</td>
                  <td className="num">{fdate(r.lastOrder)}</td>
                  <td>{r.owner ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </>
  );
}
