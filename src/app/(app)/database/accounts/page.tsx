import type { Metadata } from "next";
import Link from "next/link";
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { getCurrentUser } from "@/lib/auth";
import { customerScope } from "@/lib/customers";
import { PageTitle } from "@/components/page/page-title";
import { TierBadge } from "@/components/tier-badge";

export const metadata: Metadata = { title: "Accounts" };

const TIERS = ["hot", "warm", "cold"] as const;
type Tier = (typeof TIERS)[number];

export default async function AccountsPage({ searchParams }: PageProps<"/database/accounts">) {
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
    <>
      <PageTitle
        title="Accounts"
        description="Master data for B2B customers, sorted by qualification score."
      />

      <div className="flex flex-wrap items-center gap-2">
        {[undefined, ...TIERS].map((t) => (
          <Link
            key={t ?? "all"}
            href={{ pathname: "/database/accounts", query: { ...(t ? { tier: t } : {}), ...(q ? { q } : {}) } }}
            className={`rounded-full border px-3 py-1 text-[13px] font-semibold capitalize ${
              t === tier ? "border-accent bg-accent-soft text-accent" : "border-line bg-surface text-muted hover:text-fg"
            }`}
          >
            {t ?? "All"}
          </Link>
        ))}
        <form className="ml-auto" action="/database/accounts">
          {tier && <input type="hidden" name="tier" value={tier} />}
          <input
            name="q"
            defaultValue={q}
            placeholder="Search name, city, phone…"
            aria-label="Search accounts"
            className="input w-60"
          />
        </form>
      </div>

      <div className="panel overflow-x-auto">
        <table className="w-full min-w-[760px] text-left">
          <thead className="border-b border-line text-xs text-muted">
            <tr>
              {["Account", "City", "Status", "Source", "Score", "Why", "Owner"].map((h) => (
                <th key={h} className="px-4 py-3 font-semibold">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-muted">
                  No accounts yet.
                </td>
              </tr>
            )}
            {rows.map((c) => (
              <tr key={c.id} className="border-b border-line last:border-0 hover:bg-surface-2/60">
                <td className="px-4 py-3 font-semibold">{c.name}</td>
                <td className="px-4 py-3">{c.city ?? "—"}</td>
                <td className="px-4 py-3 capitalize">{c.status}</td>
                <td className="px-4 py-3">{c.source ?? "—"}</td>
                <td className="whitespace-nowrap px-4 py-3">
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
    </>
  );
}
