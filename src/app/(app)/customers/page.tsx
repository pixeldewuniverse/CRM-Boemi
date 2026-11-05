import type { Metadata } from "next";
import Link from "next/link";
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { getCurrentUser } from "@/lib/auth";
import { customerScope } from "@/lib/customers";
import { TierBadge } from "@/components/tier-badge";

export const metadata: Metadata = { title: "Customers" };

const TIERS = ["hot", "warm", "cold"] as const;
type Tier = (typeof TIERS)[number];

export default async function CustomersPage({ searchParams }: PageProps<"/customers">) {
  const user = await getCurrentUser();
  const params = await searchParams;
  const tier = TIERS.includes(params.tier as Tier) ? (params.tier as Tier) : undefined;
  const q = typeof params.q === "string" ? params.q.trim().slice(0, 100) : "";

  const rows = await getDb()
    .select({
      id: schema.customers.id,
      name: schema.customers.name,
      city: schema.customers.city,
      status: schema.customers.status,
      source: schema.customers.source,
      score: schema.customers.qualificationScore,
      tier: schema.customers.qualificationTier,
      reason: schema.customers.qualificationReason,
      owner: schema.users.name,
    })
    .from(schema.customers)
    .leftJoin(schema.users, eq(schema.users.id, schema.customers.ownerId))
    .where(
      and(
        customerScope(user),
        tier ? eq(schema.customers.qualificationTier, tier) : undefined,
        q
          ? or(
              ilike(schema.customers.name, `%${q}%`),
              ilike(schema.customers.city, `%${q}%`),
              ilike(schema.customers.phoneE164, `%${q.replace(/\D/g, "") || q}%`),
            )
          : undefined,
      ),
    )
    .orderBy(sql`${schema.customers.qualificationScore} desc nulls last`, desc(schema.customers.createdAt))
    .limit(100);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Customers</h1>
          <p className="text-sm text-muted">Diurutkan berdasarkan skor kualifikasi.</p>
        </div>
        <form className="flex gap-2" action="/customers">
          {tier && <input type="hidden" name="tier" value={tier} />}
          <input
            name="q"
            defaultValue={q}
            placeholder="Cari nama, kota, no. HP…"
            className="w-56 rounded-lg border border-border bg-surface px-3 py-2 text-sm"
          />
        </form>
      </div>

      <div className="flex gap-2 text-sm">
        {[undefined, ...TIERS].map((t) => (
          <Link
            key={t ?? "all"}
            href={{ pathname: "/customers", query: { ...(t ? { tier: t } : {}), ...(q ? { q } : {}) } }}
            className={`rounded-full border px-3 py-1 capitalize ${
              t === tier ? "border-primary bg-primary text-primary-foreground" : "border-border"
            }`}
          >
            {t ?? "Semua"}
          </Link>
        ))}
      </div>

      <div className="overflow-x-auto rounded-xl border border-border bg-surface">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="border-b border-border text-xs text-muted">
            <tr>
              <th className="px-4 py-3 font-medium">Nama</th>
              <th className="px-4 py-3 font-medium">Kota</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Sumber</th>
              <th className="px-4 py-3 font-medium">Skor</th>
              <th className="px-4 py-3 font-medium">Alasan</th>
              <th className="px-4 py-3 font-medium">Sales</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-muted">
                  Belum ada customer.
                </td>
              </tr>
            )}
            {rows.map((c) => (
              <tr key={c.id} className="border-b border-border last:border-0">
                <td className="px-4 py-3 font-medium">{c.name}</td>
                <td className="px-4 py-3">{c.city ?? "—"}</td>
                <td className="px-4 py-3 capitalize">{c.status}</td>
                <td className="px-4 py-3">{c.source ?? "—"}</td>
                <td className="px-4 py-3">
                  <span className="mr-2 tabular-nums">{c.score ?? "—"}</span>
                  <TierBadge tier={c.tier} />
                </td>
                <td className="max-w-xs px-4 py-3 text-muted">{c.reason ?? "—"}</td>
                <td className="px-4 py-3">{c.owner ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
