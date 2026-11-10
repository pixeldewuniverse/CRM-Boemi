import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq, ne } from "drizzle-orm";
import { ContactRowActions, DeleteActivityButton, EditAccountButton, LogActivityButton, NewContactButton } from "@/components/forms/crm-forms";
import { NewOrderButton, NewQuotationButton } from "@/components/forms/doc-forms";
import { PageTitle } from "@/components/page/page-title";
import { TierBadge } from "@/components/tier-badge";
import { Empty, Panel } from "@/components/ui/panel";
import { PaymentPill } from "@/components/ui/payment-pill";
import { StatusPill } from "@/components/ui/pill";
import { Stats } from "@/components/ui/stats";
import { getDb, schema } from "@/db";
import { getCurrentUser } from "@/lib/auth";
import { CheckInButton, NewDealButton, NewTaskButton } from "@/components/forms/sales-forms";
import { canEditOwned, canSell, isManager } from "@/lib/permissions";
import { allCampaignOptions, repOptions } from "@/lib/queries/options";
import { docFormOptions } from "@/lib/queries/docs";
import { customerScope } from "@/lib/customers";
import { fdate, fday, fphone, ftime, rp, rpk } from "@/lib/format";
import { CUSTOMER_STATUS, FEE_STATUS, ORDER_STATUS, QUOTE_STATUS, STAGE, TASK_STATUS, type Tone } from "@/lib/labels";
import { Pill } from "@/components/ui/pill";
import { PRICE_TIERS, tierForSegment } from "@/lib/pricing";

/** "Teduh — The Return to Stillness" from interests.journey (aroma journey site). */
function journeyScent(interests: Record<string, unknown> | null): string | null {
  const scent = (interests?.journey as { scent?: { name?: string; tagline?: string } } | undefined)?.scent;
  return scent?.name ? `${scent.name}${scent.tagline ? ` — ${scent.tagline}` : ""}` : null;
}

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
      address: c.address,
      instagram: c.instagram,
      campaignId: c.campaignId,
      ownerId: c.ownerId,
      campaign: schema.campaigns.name,
      phone: c.phoneE164,
      email: c.email,
      source: c.source,
      score: c.qualificationScore,
      tier: c.qualificationTier,
      reason: c.qualificationReason,
      consent: c.marketingConsent,
      interests: c.interests,
      since: c.createdAt,
      owner: schema.users.name,
    })
    .from(c)
    .leftJoin(schema.users, eq(schema.users.id, c.ownerId))
    .leftJoin(schema.campaigns, eq(schema.campaigns.id, c.campaignId))
    .where(and(eq(c.id, id), customerScope(user)));
  if (!account) notFound();
  const editable = canEditOwned(user, account.ownerId);
  const sells = canSell(user) && editable;

  const [contacts, deals, orders, visits, tasks, reps, activities, quotes, campaigns, form] = await Promise.all([
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
    db
      .select({ id: schema.activities.id, type: schema.activities.type, at: schema.activities.occurredAt, notes: schema.activities.notes, userId: schema.activities.userId, who: schema.users.name, deal: schema.opportunities.title, contact: schema.contacts.name })
      .from(schema.activities)
      .leftJoin(schema.users, eq(schema.users.id, schema.activities.userId))
      .leftJoin(schema.opportunities, eq(schema.opportunities.id, schema.activities.opportunityId))
      .leftJoin(schema.contacts, eq(schema.contacts.id, schema.activities.contactId))
      .where(eq(schema.activities.customerId, id))
      .orderBy(desc(schema.activities.occurredAt))
      .limit(60),
    db
      .select({ id: schema.quotations.id, no: schema.quotations.quoteNo, status: schema.quotations.status, total: schema.quotations.total, issued: schema.quotations.issuedOn, sentAt: schema.quotations.sentAt, decidedAt: schema.quotations.decidedAt, createdAt: schema.quotations.createdAt, valid: schema.quotations.validUntil })
      .from(schema.quotations)
      .where(eq(schema.quotations.customerId, id))
      .orderBy(desc(schema.quotations.issuedOn)),
    editable ? allCampaignOptions() : Promise.resolve([]),
    sellsForm(user, id, editable),
  ]);

  const lifetime = orders.reduce((s, o) => s + o.total, 0);
  const outstanding = orders.reduce((s, o) => s + (o.total - o.paidAmount), 0);
  const openDeals = deals.filter((d) => d.stage !== "won" && d.stage !== "lost");
  const tier = PRICE_TIERS[tierForSegment(account.segment)];
  const contactOptions = contacts.map((p) => ({ value: p.id, label: p.name }));
  const dealOptions = openDeals.map((d) => ({ value: d.id, label: d.title }));
  const timeline = buildTimeline({ visits, tasks, activities, quotes, orders, me: user.id, manager: isManager(user) });

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
            {sells && (
              <>
                <LogActivityButton accountId={account.id} deals={dealOptions} contacts={contactOptions} triggerClassName="btn btn-primary" />
                <CheckInButton accounts={[{ value: account.id, label: account.name }]} defaultAccountId={account.id} />
                <NewDealButton accounts={[{ value: account.id, label: account.name }]} reps={reps} defaultAccountId={account.id} triggerClassName="btn" />
                <NewTaskButton accounts={[{ value: account.id, label: account.name }]} reps={reps} defaultAccountId={account.id} triggerClassName="btn" />
                {form && <NewQuotationButton {...form} defaultAccountId={account.id} triggerClassName="btn" />}
                {form && <NewOrderButton {...form} defaultAccountId={account.id} triggerClassName="btn" />}
              </>
            )}
            {editable && (
              <EditAccountButton
                reps={reps}
                campaigns={campaigns}
                a={{ id: account.id, name: account.name, segment: account.segment, status: account.status, city: account.city, address: account.address, phone: account.phone, email: account.email, instagram: account.instagram, source: account.source, campaignId: account.campaignId, ownerId: account.ownerId, consent: account.consent }}
              />
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

      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
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
              <dt className="text-muted">Address</dt>
              <dd>{account.address ?? "—"}</dd>
              <dt className="text-muted">Source</dt>
              <dd>{account.source ?? "—"}</dd>
              <dt className="text-muted">Campaign</dt>
              <dd>{account.campaign ?? "—"}</dd>
              <dt className="text-muted">Marketing</dt>
              <dd>{account.consent ? "Consent given" : "No consent"}</dd>
              {journeyScent(account.interests) && (
                <>
                  <dt className="text-muted">Aroma journey</dt>
                  <dd>{journeyScent(account.interests)}</dd>
                </>
              )}
            </dl>
          </Panel>
          <Panel title="Contacts" flush actions={sells && <NewContactButton accounts={[{ value: account.id, label: account.name }]} defaultAccountId={account.id} triggerClassName="btn px-2 py-1 text-xs" />}>
            {contacts.length === 0 ? (
              <Empty>No contacts.</Empty>
            ) : (
              <ul className="divide-y divide-line text-[13px]">
                {contacts.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-start gap-2 px-4 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold">
                        {p.name}
                        {p.isDecisionMaker && <span className="ml-2 pill bg-accent-soft text-accent">Decision maker</span>}
                      </p>
                      <p className="text-xs text-muted">{p.position}</p>
                      <p className="break-all text-xs text-muted">{[fphone(p.phoneE164), p.email].filter((x) => x && x !== "—").join(" · ")}</p>
                      {p.notes && <p className="mt-0.5 text-xs">{p.notes}</p>}
                    </div>
                    {editable && (
                      <ContactRowActions c={{ id: p.id, customerId: p.customerId, name: p.name, position: p.position, phone: p.phoneE164, email: p.email, isDecisionMaker: p.isDecisionMaker, notes: p.notes }} />
                    )}
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
                      <td className="text-right">
                        {sells && d.stage !== "won" && d.stage !== "lost" && (
                          <LogActivityButton accountId={account.id} deals={dealOptions} contacts={contactOptions} defaultDealId={d.id} trigger="Log" triggerClassName="btn px-2 py-1 text-xs" />
                        )}
                      </td>
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
                      <td>
                        <Link href={`/sales/orders/${o.id}`} className="font-semibold text-accent hover:underline">
                          {o.orderNo}
                        </Link>
                      </td>
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
          <Panel title="Quotations" flush>
            {quotes.length === 0 ? (
              <Empty>No quotations.</Empty>
            ) : (
              <table className="tbl min-w-[520px]">
                <tbody>
                  {quotes.slice(0, 10).map((q) => (
                    <tr key={q.id}>
                      <td>
                        <Link href={`/sales/quotations/${q.id}`} className="font-semibold text-accent hover:underline">
                          {q.no}
                        </Link>
                      </td>
                      <td className="num">{fdate(q.issued)}</td>
                      <td className="num">{rp(q.total)}</td>
                      <td>
                        <StatusPill map={QUOTE_STATUS} value={q.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>
          <Panel title="Activity timeline" description="Visits, logged activities, tasks, quotations and orders — newest first." flush>
            {timeline.length === 0 ? (
              <Empty>Nothing yet. Log a call or check in a visit.</Empty>
            ) : (
              <ol className="divide-y divide-line text-[13px]">
                {timeline.slice(0, 40).map((t) => (
                  <li key={t.key} className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-3 px-4 py-2.5 sm:grid-cols-[7.5rem_minmax(0,1fr)]">
                    <div className="text-xs text-muted">
                      <p className="font-semibold text-fg">{fdate(t.at)}</p>
                      <p>{ftime(t.at)}</p>
                    </div>
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <Pill tone={t.tone}>{t.kind}</Pill>
                        {t.href ? (
                          <Link href={t.href} className="font-semibold hover:text-accent">
                            {t.title}
                          </Link>
                        ) : (
                          <span className="font-semibold">{t.title}</span>
                        )}
                        {t.status}
                      </p>
                      {t.body && <p className="mt-0.5 whitespace-pre-line">{t.body}</p>}
                      <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted">
                        <span>{t.meta}</span>
                        {t.deletableActivity && <DeleteActivityButton id={t.deletableActivity} />}
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}

type TimelineItem = {
  key: string;
  at: Date;
  kind: string;
  tone: Tone;
  title: string;
  href?: string;
  status?: React.ReactNode;
  body?: string | null;
  meta: string;
  deletableActivity?: string;
};

/** One chronological feed from every source that touches the account. */
function buildTimeline(src: {
  visits: { id: string; at: Date | null; notes: string | null; fee: number | null; feeStatus: string | null; sales: string | null }[];
  tasks: { id: string; title: string; type: string | null; status: string; due: Date | null; who: string | null }[];
  activities: { id: string; type: string; at: Date; notes: string; userId: string; who: string | null; deal: string | null; contact: string | null }[];
  quotes: { id: string; no: string; status: string; total: number; issued: string; sentAt: Date | null; decidedAt: Date | null; createdAt: Date }[];
  orders: { id: string; orderNo: string; orderedAt: Date; total: number; status: string; paymentStatus: string }[];
  me: string;
  manager: boolean;
}): TimelineItem[] {
  const items: TimelineItem[] = [
    ...src.activities.map((a) => ({
      key: `a${a.id}`,
      at: a.at,
      kind: a.type,
      tone: "accent" as Tone,
      title: a.contact ? `with ${a.contact}` : a.type,
      body: a.notes,
      meta: [a.who, a.deal && `Deal: ${a.deal}`].filter(Boolean).join(" · "),
      deletableActivity: a.userId === src.me || src.manager ? a.id : undefined,
    })),
    ...src.visits
      .filter((v) => v.at)
      .map((v) => ({
      key: `v${v.id}`,
      at: v.at!,
      kind: "Visit",
      tone: "info" as Tone,
      title: "GPS check-in",
      status: v.feeStatus ? <StatusPill map={FEE_STATUS} value={v.feeStatus} /> : undefined,
      body: v.notes,
      meta: [v.sales, v.fee ? `fee ${rp(v.fee)}` : null].filter(Boolean).join(" · "),
    })),
    ...src.tasks
      .filter((t) => t.due)
      .map((t) => ({
        key: `t${t.id}`,
        at: t.due!,
        kind: "Task",
        tone: "neutral" as Tone,
        title: t.title,
        href: "/sales/tasks",
        status: <StatusPill map={TASK_STATUS} value={t.status} />,
        meta: [t.type, t.who && `for ${t.who}`, "due date"].filter(Boolean).join(" · "),
      })),
    ...src.quotes.map((q) => ({
      key: `q${q.id}`,
      at: q.decidedAt ?? q.sentAt ?? q.createdAt,
      kind: "Quotation",
      tone: "warn" as Tone,
      title: `${q.no} · ${rp(q.total)}`,
      href: `/sales/quotations/${q.id}`,
      status: <StatusPill map={QUOTE_STATUS} value={q.status} />,
      meta: `Issued ${fdate(q.issued)}`,
    })),
    ...src.orders.map((o) => ({
      key: `o${o.id}`,
      at: o.orderedAt,
      kind: "Order",
      tone: "ok" as Tone,
      title: `${o.orderNo} · ${rp(o.total)}`,
      href: `/sales/orders/${o.id}`,
      status: <StatusPill map={ORDER_STATUS} value={o.status} />,
      meta: o.paymentStatus === "paid" ? "Paid" : o.paymentStatus === "deposit" ? "Deposit paid" : "Unpaid",
    })),
  ];
  return items.sort((a, b) => b.at.getTime() - a.at.getTime());
}

/** Quotation/order forms for this account, only for people who can sell here. */
async function sellsForm(user: Awaited<ReturnType<typeof getCurrentUser>>, accountId: string, editable: boolean) {
  return editable ? docFormOptions(user, accountId) : null;
}
