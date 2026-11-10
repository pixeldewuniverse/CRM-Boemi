import type { Metadata } from "next";
import Link from "next/link";
import { asc, desc, eq, inArray } from "drizzle-orm";
import { ApprovalDecision } from "@/components/forms/admin-forms";
import { PageHeader } from "@/components/page/page-header";
import { Empty, Panel } from "@/components/ui/panel";
import { Pill } from "@/components/ui/pill";
import { getDb, schema } from "@/db";
import { APPROVAL_ENTITIES, formatAmount, getPendingFor, type ApprovalEntity } from "@/lib/approvals";
import { getCurrentUser } from "@/lib/auth";
import { fdatetime } from "@/lib/format";
import type { Tone } from "@/lib/labels";

export const metadata: Metadata = { title: "Approvals" };
const STEP_TONE: Record<string, Tone> = { pending: "warn", approved: "ok", rejected: "bad", waiting: "neutral", skipped: "neutral" };
const REQ_TONE: Record<string, Tone> = { pending: "warn", approved: "ok", rejected: "bad", cancelled: "neutral" };

export default async function ApprovalsPage() {
  const user = await getCurrentUser();
  const db = getDb();
  const r = schema.approvalRequests;
  const [pending, mine] = await Promise.all([
    getPendingFor(user),
    db.select().from(r).where(eq(r.requesterId, user.id)).orderBy(desc(r.createdAt)).limit(20),
  ]);
  const ids = [...pending.map((p) => p.id), ...mine.map((m) => m.id)];
  const steps = ids.length ? await db.select({ a: schema.approvalActions, by: schema.users.name }).from(schema.approvalActions).leftJoin(schema.users, eq(schema.users.id, schema.approvalActions.decidedBy)).where(inArray(schema.approvalActions.requestId, ids)).orderBy(asc(schema.approvalActions.position)) : [];
  const stepsOf = (id: string) => steps.filter((s) => s.a.requestId === id);
  const label = (t: string) => APPROVAL_ENTITIES[t as ApprovalEntity]?.label ?? t;

  const stepList = (id: string) => (
    <ol className="mt-2 flex flex-wrap gap-1.5 text-xs" aria-label="Steps">
      {stepsOf(id).map(({ a, by }) => (
        <li key={a.id} className="inline-flex items-center gap-1" title={a.note ?? undefined}>
          <Pill tone={STEP_TONE[a.status]}>
            {a.position}. {a.label}
          </Pill>
          {by && <span className="text-muted">{by}</span>}
        </li>
      ))}
    </ol>
  );

  return (
    <>
      <PageHeader href="/approvals" />
      <Panel title={`Waiting for you (${pending.length})`} description={user.role === "admin" ? "As Super Admin you can decide any open step." : undefined} flush>
        {pending.length === 0 ? (
          <Empty>Nothing to approve right now.</Empty>
        ) : (
          <ul className="divide-y divide-line">
            {pending.map((p) => (
              <li key={p.id} className="flex flex-wrap items-start gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-muted">{label(p.entityType)}</p>
                  <p className="font-semibold">
                    {p.link ? (
                      <Link href={p.link} className="hover:text-accent">
                        {p.title}
                      </Link>
                    ) : (
                      p.title
                    )}
                  </p>
                  <p className="text-[13px] text-muted">
                    <span className="font-semibold text-fg">{formatAmount(p.entityType, p.amount)}</span> · from {p.requester} · {fdatetime(p.createdAt)}
                  </p>
                  {stepList(p.id)}
                </div>
                <ApprovalDecision requestId={p.id} title={p.title} />
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <Panel title="Your requests" description="Latest 20 you sent." flush>
        {mine.length === 0 ? (
          <Empty>You haven&apos;t sent any requests.</Empty>
        ) : (
          <ul className="divide-y divide-line">
            {mine.map((m) => (
              <li key={m.id} className="px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-semibold text-muted">{label(m.entityType)}</span>
                  <Pill tone={REQ_TONE[m.status]}>{m.status}</Pill>
                  <span className="ml-auto text-xs text-muted">{fdatetime(m.createdAt)}</span>
                </div>
                <p className="font-semibold">
                  {m.link ? (
                    <Link href={m.link} className="hover:text-accent">
                      {m.title}
                    </Link>
                  ) : (
                    m.title
                  )}{" "}
                  <span className="font-normal text-muted">· {formatAmount(m.entityType, m.amount)}</span>
                </p>
                {stepList(m.id)}
                {stepsOf(m.id)
                  .filter(({ a }) => a.note)
                  .map(({ a, by }) => (
                    <p key={a.id} className="mt-1 text-xs text-muted">
                      {by}: “{a.note}”
                    </p>
                  ))}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}
