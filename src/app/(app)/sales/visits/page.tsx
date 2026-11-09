import type { Metadata } from "next";
import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { PageHeader } from "@/components/page/page-header";
import { FilterChips } from "@/components/ui/filter-chips";
import { Empty, Panel } from "@/components/ui/panel";
import { StatusPill } from "@/components/ui/pill";
import { Stats } from "@/components/ui/stats";
import { getDb, schema } from "@/db";
import { getCurrentUser } from "@/lib/auth";
import { fdate, ftime, rp, ym } from "@/lib/format";
import { FEE_STATUS } from "@/lib/labels";
import { now, ownedBy } from "@/lib/scope";

export const metadata: Metadata = { title: "Visits" };
const HREF = "/sales/visits";
const FEES = ["pending", "approved", "rejected"] as const;
type Fee = (typeof FEES)[number];
const APPROVERS = ["admin", "sales_manager", "finance"];

export default async function VisitsPage({ searchParams }: PageProps<"/sales/visits">) {
  const user = await getCurrentUser();
  const params = await searchParams;
  const fee = FEES.includes(params.fee as Fee) ? (params.fee as Fee) : undefined;
  const today = await now();
  const monthStart = new Date(`${ym(today)}-01T00:00:00+07:00`);
  const db = getDb();
  const v = schema.visits;
  const f = schema.visitFees;
  const decider = alias(schema.users, "decider");

  const rows = await db
    .select({
      id: v.id,
      at: v.checkedInAt,
      lat: v.latitude,
      lng: v.longitude,
      notes: v.notes,
      photo: v.photoKey,
      accountId: schema.customers.id,
      account: schema.customers.name,
      city: schema.customers.city,
      sales: schema.users.name,
      feeAmount: f.amount,
      feeStatus: f.status,
      feeNote: f.decisionNote,
      decidedBy: decider.name,
    })
    .from(v)
    .innerJoin(schema.customers, eq(schema.customers.id, v.customerId))
    .leftJoin(schema.users, eq(schema.users.id, v.salesId))
    .leftJoin(f, eq(f.visitId, v.id))
    .leftJoin(decider, eq(decider.id, f.decidedBy))
    .where(ownedBy(user, v.salesId))
    .orderBy(desc(v.checkedInAt))
    .limit(200);

  const shown = fee ? rows.filter((r) => r.feeStatus === fee) : rows;
  const thisMonth = rows.filter((r) => r.at && r.at >= monthStart).length;
  const pending = rows.filter((r) => r.feeStatus === "pending");
  const approved = rows.filter((r) => r.feeStatus === "approved" || r.feeStatus === "paid");
  const canApprove = APPROVERS.includes(user.role);

  return (
    <>
      <PageHeader href={HREF} />
      <Stats
        items={[
          { label: "Visits this month", value: thisMonth },
          {
            label: "Fees awaiting approval",
            value: rp(pending.reduce((s, r) => s + (r.feeAmount ?? 0), 0)),
            hint: `${pending.length} visits${canApprove ? " · you can approve" : ""}`,
            tone: pending.length ? "warn" : "default",
          },
          { label: "Fees approved", value: rp(approved.reduce((s, r) => s + (r.feeAmount ?? 0), 0)) },
          { label: "Visits logged", value: rows.length, hint: "GPS + photo check-in" },
        ]}
      />
      <FilterChips
        pathname={HREF}
        param="fee"
        value={fee}
        options={[
          { value: undefined, label: "All visits", count: rows.length },
          ...FEES.map((s) => ({ value: s, label: `Fee ${FEE_STATUS[s].label.toLowerCase()}`, count: rows.filter((r) => r.feeStatus === s).length })),
        ]}
      />
      <Panel flush>
        {shown.length === 0 ? (
          <Empty>No visits.</Empty>
        ) : (
          <table className="tbl min-w-[960px]">
            <thead>
              <tr>
                <th>Check-in</th>
                <th>Account</th>
                <th>Sales</th>
                <th>Location</th>
                <th>Notes</th>
                <th className="num">Visit fee</th>
                <th>Approval</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id}>
                  <td className="whitespace-nowrap">
                    <p className="font-semibold">{fdate(r.at)}</p>
                    <p className="text-xs text-muted">{ftime(r.at)}</p>
                  </td>
                  <td>
                    <Link href={`/database/accounts/${r.accountId}`} className="font-semibold hover:text-accent">
                      {r.account}
                    </Link>
                    <p className="text-xs text-muted">{r.city}</p>
                  </td>
                  <td>{r.sales}</td>
                  <td className="whitespace-nowrap">
                    {r.lat != null && r.lng != null ? (
                      <a
                        href={`https://www.google.com/maps?q=${r.lat},${r.lng}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-accent hover:underline"
                      >
                        {r.lat.toFixed(4)}, {r.lng.toFixed(4)} ↗
                      </a>
                    ) : (
                      "—"
                    )}
                    <p className="text-xs text-muted">{r.photo ? "Photo attached" : "Photo: demo"}</p>
                  </td>
                  <td className="max-w-xs text-muted">{r.notes}</td>
                  <td className="num font-semibold">{rp(r.feeAmount)}</td>
                  <td>
                    <StatusPill map={FEE_STATUS} value={r.feeStatus} />
                    {r.decidedBy && <p className="mt-1 text-xs text-muted">by {r.decidedBy}</p>}
                    {r.feeNote && <p className="mt-1 max-w-48 text-xs text-bad">{r.feeNote}</p>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </>
  );
}
