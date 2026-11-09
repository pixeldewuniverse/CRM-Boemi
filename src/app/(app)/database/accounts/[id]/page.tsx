import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq, ne } from "drizzle-orm";
import { PageTitle } from "@/components/page/page-title";
import { TierBadge } from "@/components/tier-badge";
import { Empty, Panel } from "@/components/ui/panel";
import { PaymentPill } from "@/components/ui/payment-pill";
import { StatusPill } from "@/components/ui/pill";
import { Stats } from "@/components/ui/stats";
import { getDb, schema } from "@/db";
import { getCurrentUser } from "@/lib/auth";
import { CheckInButton, NewDealButton, NewTaskButton } from "@/components/forms/sales-forms";
import { canSell } from "@/lib/permissions";
import { repOptions } from "@/lib/queries/options";
import { customerScope } from "@/lib/customers";
import { fdate, fday, fphone, rp, rpk } from "@/lib/format";
import { CUSTOMER_STATUS, FEE_STATUS, ORDER_STATUS, STAGE, TASK_STATUS } from "@/lib/labels";
import { PRICE_TIERS, tierForSegment } from "@/lib/pricing";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata({ params }: PageProps<"/database/accounts/[id]">): Promise<Metadata> {
  const [{ id }, user] = await Promise.all([params, getCurrentUser()]);
  if (!UUID.test(id)) return { title: "Account" };
  const [row] = await getDb()
    .select({ name: schema.customers.name })
    .from(schema.customers)
    .where(and(eq(schema.customers.id, id), customerScope(user)));
  return { title: row?.name ?? "Account" };
}

/** 360° account view: profile, contacts, deals, orders, visits, tasks. */
export default async function AccountPage({ params }: PageProps<"/database/accounts/[id]">) {
  const user = await getCurrentUser();
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const db = getDb();
  const c = schema.customers;

  const [account] = await db
    .select({
      id: c.id,
      name: c.name,
      segment: c.businessType,
      status: c.status,
      city: c.city,
      phone: c.phoneE164,
      email: c.email,
      source: c.source,
      score: c.qualificationScore,
      tier: c.qualificationTier,
      reason: c.qualificationReason,
      consent: c.marketingConsent,
      since: c.createdAt,
      owner: schema.users.name,
    })
    .from(c)
    .leftJoin(schema.users, eq(schema.users.id, c.ownerId))
    .where(and(eq(c.id, id), customerScope(user)));
  if (!account) notFound();

  const [contacts, deals, orders, visits, tasks, reps] = await Promise.all([
    db.select().from(schema.contacts).where(eq(schema.contacts.customerId, id)),
    db.select().from(schema.opportunities).where(eq(schema.opportunities.customerId, id)).orderBy(desc(schema.opportunities.expectedCloseOn)),
    db.select().from(schema.orders).where(and(eq(schema.orders.customerId, id), ne(schema.orders.status, "cancelled"))).orderBy(desc(schema.orders.orderedAt)),
    db
      .select({ id: schema.visits.id, at: schema.visits.checkedInAt, notes: schema.visits.notes, fee: schema.visitFees.amount, feeStatus: schema.visitFees.status, sales: schema.users.name })
      .from(schema.visits)
      .leftJoin(schema.visitFees, eq(schema.visitFees.visitId, schema.visits.id))
      .leftJoin(schema.users, eq(schema.users.id, schema.visits.salesId))
      .where(eq(schema.visits.customerId, id))
      .orderBy(desc(schema.visits.checkedInAt)),
    db
      .select({ id: schema.tasks.id, title: schema.tasks.title, type: schema.tasks.type, status: schema.tasks.status, due: schema.tasks.dueAt, who: schema.users.name })
      .from(schema.tasks)
      .leftJoin(schema.users, eq(schema.users.id, schema.tasks.assigneeId))
      .where(eq(schema.tasks.customerId, id))
      .orderBy(desc(schema.tasks.dueAt)),
    repOptions(user),
  ]);

  const lifetime = orders.reduce((s, o) => s + o.total, 0);
  const outstanding = orders.reduce((s, o) => s + (o.total - o.paidAmount), 0);
  const openDeals = deals.filter((d) => d.stage !== "won" && d.stage !== "lost");
  const tier = PRICE_TIERS[tierForSegment(account.segment)];

  return (
    <>
      <Link href="/database/accounts" className="text-[13px] text-muted hover:text-accent">
        ← Accounts
      </Link>
      <PageTitle
        title={account.name}
        description={`${account.segment} · ${account.city} · owned by ${account.owner ?? "—"} · customer since ${fdate(account.since)}`}
        actions={
          <>
            <StatusPill map={CUSTOMER_STATUS} value={account.status} />
            {canSell(user) && (
              <>
                <CheckInButton accounts={[{ value: account.id, label: account.name }]} defaultAccountId={account.id} />
                <NewDealButton accounts={[{ value: account.id, label: account.name }]} reps={reps} defaultAccountId={account.id} triggerClassName="btn" />
                <NewTaskButton accounts={[{ value: account.id, label: account.name }]} reps={reps} defaultAccountId={account.id} triggerClassName="btn" />
              </>
            )}
          </>
        }
      />
      <Stats
        items={[
          { label: "Lifetime revenue", value: rpk(lifetime), hint: `${orders.length} orders` },
          { label: "Last order", value: fdate(orders[0]?.orderedAt), hint: orders[0]?.orderNo },
          { label: "Open pipeline", value: rpk(openDeals.reduce((s, d) => s + (d.value ?? 0), 0)), hint: `${openDeals.length} open deals` },
          { label: "Outstanding", value: rpk(outstanding), tone: outstanding ? "warn" : "ok" },
        ]}
      />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <div className="flex flex-col gap-5">
          <Panel title="Profile">
            <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-2 text-[13px]">
              <dt className="text-muted">Qualification</dt>
              <dd>
                <span className="mr-2 font-semibold">{account.score ?? "—"}</span>
                <TierBadge tier={account.tier} />
                {account.reason && <p className="mt-1 text-xs text-muted">{account.reason}</p>}
              </dd>
              <dt className="text-muted">Price tier</dt>
              <dd>
                {tier.label} ({Math.round(tier.factor * 100)}% of retail)
              </dd>
              <dt className="text-muted">Phone</dt>
              <dd>{fphone(account.phone)}</dd>
              <dt className="text-muted">Email</dt>
              <dd className="break-all">{account.email ?? "—"}</dd>
              <dt className="text-muted">Source</dt>
              <dd>{account.source ?? "—"}</dd>
              <dt className="text-muted">Marketing</dt>
              <dd>{account.consent ? "Consent given" : "No consent"}</dd>
            </dl>
          </Panel>
          <Panel title="Contacts" flush>
            {contacts.length === 0 ? (
              <Empty>No contacts.</Empty>
            ) : (
              <ul className="divide-y divide-line text-[13px]">
                {contacts.map((p) => (
                  <li key={p.id} className="px-4 py-2.5">
                    <p className="font-semibold">
                      {p.name}
                      {p.isDecisionMaker && <span className="ml-2 pill bg-accent-soft text-accent">Decision maker</span>}
                    </p>
                    <p className="text-xs text-muted">{p.position}</p>
                    <p className="text-xs text-muted">
                      {fphone(p.phoneE164)} · {p.email}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        <div className="flex flex-col gap-5">
          <Panel title="Deals" flush>
            {deals.length === 0 ? (
              <Empty>No deals.</Empty>
            ) : (
              <table className="tbl min-w-[560px]">
                <tbody>
                  {deals.map((d) => (
                    <tr key={d.id}>
                      <td className="font-semibold">{d.title}</td>
                      <td>
                        <StatusPill map={STAGE} value={d.stage} />
                      </td>
                      <td className="num">{rp(d.value)}</td>
                      <td className="num text-muted">close {fday(d.expectedCloseOn)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>
          <Panel title="Purchase history" flush>
            {orders.length === 0 ? (
              <Empty>No orders yet.</Empty>
            ) : (
              <table className="tbl min-w-[560px]">
                <thead>
                  <tr>
                    <th>Order</th>
                    <th className="num">Date</th>
                    <th className="num">Total</th>
                    <th>Payment</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.slice(0, 15).map((o) => (
                    <tr key={o.id}>
                      <td className="font-semibold">{o.orderNo}</td>
                      <td className="num">{fdate(o.orderedAt)}</td>
                      <td className="num">{rp(o.total)}</td>
                      <td>
                        <PaymentPill status={o.paymentStatus} depositPct={o.depositPct} />
                      </td>
                      <td>
                        <StatusPill map={ORDER_STATUS} value={o.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>
          <div className="grid gap-5 xl:grid-cols-2">
            <Panel title="Visit history" flush>
              {visits.length === 0 ? (
                <Empty>No visits.</Empty>
              ) : (
                <ul className="divide-y divide-line text-[13px]">
                  {visits.map((v) => (
                    <li key={v.id} className="px-4 py-2.5">
                      <p className="flex justify-between gap-2">
                        <span className="font-semibold">{fdate(v.at)}</span>
                        <StatusPill map={FEE_STATUS} value={v.feeStatus} />
                      </p>
                      <p className="text-xs text-muted">
                        {v.sales} · fee {rp(v.fee)}
                      </p>
                      <p className="text-xs">{v.notes}</p>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
            <Panel title="Tasks & follow-ups" flush>
              {tasks.length === 0 ? (
                <Empty>No tasks.</Empty>
              ) : (
                <ul className="divide-y divide-line text-[13px]">
                  {tasks.map((t) => (
                    <li key={t.id} className="px-4 py-2.5">
                      <p className="flex justify-between gap-2">
                        <span className="text-xs font-semibold text-muted">{t.type}</span>
                        <StatusPill map={TASK_STATUS} value={t.status} />
                      </p>
                      <p>{t.title}</p>
                      <p className="text-xs text-muted">
                        {t.who} · due {fday(t.due)}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>
        </div>
      </div>
    </>
  );
}
