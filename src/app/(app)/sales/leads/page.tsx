import type { Metadata } from "next";
import { and, count, desc, eq, ilike, or, sql } from "drizzle-orm";
import { PageHeader } from "@/components/page/page-header";
import { TierBadge } from "@/components/tier-badge";
import { FilterChips, SearchBox } from "@/components/ui/filter-chips";
import { Empty, Panel } from "@/components/ui/panel";
import { StatusPill } from "@/components/ui/pill";
import { getDb, schema } from "@/db";
import { getCurrentUser } from "@/lib/auth";
import { NewLeadButton } from "@/components/forms/sales-forms";
import { AssignLead, LeadActions } from "@/components/forms/row-actions";
import { canAddLeads, canEditOwned, isManager } from "@/lib/permissions";
import { assignableReps, campaignOptions, repOptions } from "@/lib/queries/options";
import { fdate, fphone } from "@/lib/format";
import { LEAD_SOURCES, LEAD_STATUS } from "@/lib/labels";
import { ownedBy } from "@/lib/scope";

export const metadata: Metadata = { title: "Leads" };
const HREF = "/sales/leads";
const STATUSES = ["new", "contacted", "qualified", "disqualified"] as const;
type Status = (typeof STATUSES)[number];

export default async function LeadsPage({ searchParams }: PageProps<"/sales/leads">) {
  const user = await getCurrentUser();
  const params = await searchParams;
  const status = STATUSES.includes(params.status as Status) ? (params.status as Status) : undefined;
  const q = typeof params.q === "string" ? params.q.trim().slice(0, 100) : "";
  const source = (LEAD_SOURCES as readonly string[]).includes(params.source as string) ? (params.source as string) : undefined;
  const canAssign = isManager(user) || user.role === "marketing";
  const db = getDb();
  const l = schema.leads;
  const scope = ownedBy(user, l.ownerId);

  const [rows, counts, reps, campaigns, sourceCounts, assignable] = await Promise.all([
    db
      .select({
        id: l.id,
        company: l.company,
        pic: l.picName,
        phone: l.phoneE164,
        segment: l.segment,
        city: l.city,
        source: l.source,
        status: l.status,
        note: l.note,
        score: l.qualificationScore,
        tier: l.qualificationTier,
        reason: l.qualificationReason,
        received: l.receivedOn,
        ownerId: l.ownerId,
        disqReason: l.disqualifyReason,
        instagram: l.instagram,
        email: l.email,
        consent: l.marketingConsent,
        interests: l.interests,
        owner: schema.users.name,
      })
      .from(l)
      .leftJoin(schema.users, eq(schema.users.id, l.ownerId))
      .where(
        and(
          scope,
          status ? eq(l.status, status) : undefined,
          source ? eq(l.source, source) : undefined,
          q ? or(ilike(l.company, `%${q}%`), ilike(l.picName, `%${q}%`), ilike(l.city, `%${q}%`)) : undefined,
        ),
      )
      .orderBy(sql`${l.qualificationScore} desc nulls last`, desc(l.receivedOn))
      .limit(200),
    db.select({ status: l.status, n: count() }).from(l).where(scope).groupBy(l.status),
    repOptions(user),
    campaignOptions(),
    db.select({ source: l.source, n: count() }).from(l).where(scope).groupBy(l.source),
    canAssign ? assignableReps() : Promise.resolve([]),
  ]);
  const byStatus = Object.fromEntries(counts.map((c) => [c.status, c.n]));
  const total = counts.reduce((s, c) => s + c.n, 0);

  return (
    <>
      <PageHeader href={HREF} actions={canAddLeads(user) ? <NewLeadButton reps={reps} campaigns={campaigns} /> : undefined} />
      <div className="flex flex-wrap items-center gap-3">
        <FilterChips
          pathname={HREF}
          param="status"
          value={status}
          keep={{ q, source }}
          options={[
            { value: undefined, label: "All", count: total },
            ...STATUSES.map((s) => ({ value: s, label: LEAD_STATUS[s].label, count: byStatus[s] ?? 0 })),
          ]}
        />
        <div className="ml-auto">
          <SearchBox action={HREF} value={q} placeholder="Search company, PIC, city…" keep={{ status, source }} />
        </div>
      </div>
      {sourceCounts.length > 1 && (
        <FilterChips
          pathname={HREF}
          param="source"
          value={source}
          keep={{ q, status }}
          options={[
            { value: undefined, label: "Any source" },
            ...sourceCounts.sort((a, b) => b.n - a.n).map((s) => ({ value: s.source, label: s.source, count: s.n })),
          ]}
        />
      )}
      <Panel flush>
        {rows.length === 0 ? (
          <Empty>No leads match this filter.</Empty>
        ) : (
          <table className="tbl min-w-[1180px]">
            <thead>
              <tr>
                <th>Company</th>
                <th>Segment</th>
                <th>Source</th>
                <th>Qualification</th>
                <th>Status</th>
                <th>Owner</th>
                <th className="num">Received</th>
                <th className="sr-only">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <p className="font-semibold">{r.company}</p>
                    <p className="text-xs text-muted">
                      {r.pic !== r.company && `${r.pic} · `}
                      {fphone(r.phone)}
                      {r.instagram && ` · @${r.instagram}`}
                      {!r.phone && !r.instagram && r.email}
                    </p>
                    {r.consent && <p className="text-xs text-ok">Agreed to offers</p>}
                    {r.note && <p className="mt-1 max-w-sm text-xs text-muted">{r.note}</p>}
                  </td>
                  <td>
                    {r.segment}
                    <p className="text-xs text-muted">{r.city}</p>
                  </td>
                  <td>{r.source}</td>
                  <td className="max-w-64">
                    <span className="mr-2 font-semibold tabular-nums">{r.score ?? "—"}</span>
                    <TierBadge tier={r.tier} />
                    {r.reason && <p className="mt-1 text-xs text-muted">{r.reason}</p>}
                  </td>
                  <td>
                    <StatusPill map={LEAD_STATUS} value={r.status} />
                    {r.disqReason && <p className="mt-1 text-xs text-muted">{r.disqReason}</p>}
                  </td>
                  <td>
                    {r.owner ?? <span className="text-warn">Unassigned</span>}
                    {canAssign && r.status !== "qualified" && r.status !== "disqualified" && (
                      <div className="mt-1">
                        <AssignLead leadId={r.id} company={r.company} reps={assignable} current={r.ownerId} />
                      </div>
                    )}
                  </td>
                  <td className="num">{fdate(r.received)}</td>
                  <td>{canEditOwned(user, r.ownerId) && <LeadActions leadId={r.id} company={r.company} status={r.status} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </>
  );
}
