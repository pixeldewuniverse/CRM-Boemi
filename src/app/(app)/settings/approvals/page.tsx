import type { Metadata } from "next";
import { asc, count, eq } from "drizzle-orm";
import { FlowRowActions, FlowTester, NewFlowButton } from "@/components/forms/approval-flow-editor";
import { guard } from "@/components/page/guard";
import { PageHeader } from "@/components/page/page-header";
import { Empty, Panel } from "@/components/ui/panel";
import { Pill } from "@/components/ui/pill";
import { getDb, schema } from "@/db";
import { APPROVAL_ENTITIES, APPROVAL_ENTITY_KEYS, formatAmount, stepLabel } from "@/lib/approvals";
import { ROLE_LABEL } from "@/lib/roles";

export const metadata: Metadata = { title: "Approval Workflows" };
const HREF = "/settings/approvals";

export default async function ApprovalSettingsPage() {
  const { denied } = await guard(HREF);
  if (denied) return denied;
  const db = getDb();
  const [flows, steps, users, inUse] = await Promise.all([
    db.select().from(schema.approvalFlows).orderBy(asc(schema.approvalFlows.entityType), asc(schema.approvalFlows.priority), asc(schema.approvalFlows.minAmount)),
    db.select().from(schema.approvalFlowSteps).orderBy(asc(schema.approvalFlowSteps.position)),
    db.select({ id: schema.users.id, name: schema.users.name, role: schema.users.role }).from(schema.users).where(eq(schema.users.active, true)).orderBy(asc(schema.users.name)),
    db.select({ flowId: schema.approvalRequests.flowId, n: count() }).from(schema.approvalRequests).where(eq(schema.approvalRequests.status, "pending")).groupBy(schema.approvalRequests.flowId),
  ]);
  const entities = APPROVAL_ENTITY_KEYS.map((k) => ({ value: k, label: APPROVAL_ENTITIES[k].label + (k.startsWith("project") || k === "purchase_request" ? " (from Project module)" : "") }));
  const people = users.map((u) => ({ value: u.id, label: `${u.name} · ${ROLE_LABEL[u.role]}` }));
  const nameOf = (id: string | null) => users.find((u) => u.id === id)?.name;
  const range = (t: string, min: number | null, max: number | null) =>
    min == null && max == null ? "Any amount" : min != null && max != null ? `${formatAmount(t, min)} – ${formatAmount(t, max)}` : min != null ? `From ${formatAmount(t, min)}` : `Up to ${formatAmount(t, max!)}`;

  return (
    <>
      <PageHeader href={HREF} actions={<NewFlowButton entities={entities} people={people} />} />
      {APPROVAL_ENTITY_KEYS.map((t) => {
        const list = flows.filter((f) => f.entityType === t);
        return (
          <Panel key={t} title={APPROVAL_ENTITIES[t].label} description={list.some((f) => f.active) ? undefined : "No active workflow — these requests are approved automatically."} flush>
            {list.length === 0 ? (
              <Empty>No workflow.</Empty>
            ) : (
              <ul className="divide-y divide-line">
                {list.map((f) => {
                  const st = steps.filter((s) => s.flowId === f.id);
                  return (
                    <li key={f.id} className="flex flex-wrap items-start gap-3 px-4 py-3">
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold">
                          {f.name} {!f.active && <Pill>Inactive</Pill>}
                        </p>
                        <p className="text-xs text-muted">
                          {range(t, f.minAmount, f.maxAmount)} · priority {f.priority}
                          {inUse.find((u) => u.flowId === f.id)?.n ? ` · ${inUse.find((u) => u.flowId === f.id)!.n} in progress` : ""}
                        </p>
                        <ol className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
                          {st.map((s, i) => (
                            <li key={s.id} className="flex items-center gap-1.5">
                              {i > 0 && <span aria-hidden="true" className="text-muted">→</span>}
                              <Pill tone="info">
                                {s.position}. {stepLabel(s, nameOf(s.userId))}
                              </Pill>
                            </li>
                          ))}
                        </ol>
                      </div>
                      <FlowRowActions
                        entities={entities}
                        people={people}
                        f={{ id: f.id, entityType: f.entityType, name: f.name, active: f.active, minAmount: f.minAmount, maxAmount: f.maxAmount, priority: f.priority, steps: st.map((s) => ({ approverType: s.approverType, roles: s.roles, userId: s.userId, label: s.label })) }}
                      />
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>
        );
      })}
      <Panel title="Test a workflow" description="Who would approve a request of this type and amount, for this person?">
        <FlowTester entities={entities} people={people} />
      </Panel>
    </>
  );
}
