import "server-only";
import { and, asc, desc, eq, inArray, isNull, lte, ne, or, sql, gte } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { audit } from "@/lib/audit";
import type { CurrentUser } from "@/lib/auth";
import { rp } from "@/lib/format";
import { notify, type NotificationType } from "@/lib/notifications";
import { ROLE_LABEL, type Role } from "@/lib/roles";

/**
 * Generic approval engine.
 *
 *   approval_flows        which steps a request type goes through (by amount range)
 *   approval_flow_steps   approver per step: a role (any of several), a user,
 *                         the requester's direct manager, or their department head
 *   approval_requests     one per thing waiting for approval
 *   approval_actions      the steps of that request, copied from the flow when it
 *                         was made (editing a flow never changes requests in flight)
 *
 * Approvers are resolved when a step becomes current. The requester never
 * approves their own request; if nobody is left, the step goes to Super Admins.
 * A Super Admin may decide any pending step.
 */

export const APPROVAL_ENTITIES = {
  visit_fee: { label: "Visit fee", unit: "rp", requested: "visit_fee.pending", decided: "visit_fee.decided" },
  quotation_discount: { label: "Quotation discount", unit: "pct", requested: "quote.approval", decided: "quote.decided" },
  project: { label: "Project", unit: "rp", requested: "approval.requested", decided: "approval.decided" },
  project_budget: { label: "Project budget", unit: "rp", requested: "approval.requested", decided: "approval.decided" },
  purchase_request: { label: "Purchase request", unit: "rp", requested: "approval.requested", decided: "approval.decided" },
} as const satisfies Record<string, { label: string; unit: "rp" | "pct"; requested: NotificationType; decided: NotificationType }>;
export type ApprovalEntity = keyof typeof APPROVAL_ENTITIES;
export const APPROVAL_ENTITY_KEYS = Object.keys(APPROVAL_ENTITIES) as ApprovalEntity[];

export const APPROVER_TYPES = {
  role: "Anyone with role",
  user: "A specific person",
  direct_manager: "Requester's direct manager",
  department_head: "Head of requester's department",
} as const;
export type ApproverType = keyof typeof APPROVER_TYPES;

export const formatAmount = (entity: string, amount: number) => (APPROVAL_ENTITIES[entity as ApprovalEntity]?.unit === "pct" ? `${amount}%` : rp(amount));

type Db = ReturnType<typeof getDb>;
type Step = { approverType: string; roles: string[]; userId: string | null; label: string | null };

/** First active flow whose amount range contains `amount` (lowest priority number wins). */
export async function resolveFlow(entityType: ApprovalEntity, amount: number, db: Db = getDb()) {
  const f = schema.approvalFlows;
  const [flow] = await db
    .select()
    .from(f)
    .where(and(eq(f.entityType, entityType), eq(f.active, true), or(isNull(f.minAmount), lte(f.minAmount, amount)), or(isNull(f.maxAmount), gte(f.maxAmount, amount))))
    .orderBy(asc(f.priority), desc(f.minAmount))
    .limit(1);
  if (!flow) return null;
  const steps = await db.select().from(schema.approvalFlowSteps).where(eq(schema.approvalFlowSteps.flowId, flow.id)).orderBy(asc(schema.approvalFlowSteps.position));
  return { flow, steps };
}

export function stepLabel(s: Step, userName?: string | null) {
  if (s.label) return s.label;
  if (s.approverType === "role") return s.roles.map((r) => ROLE_LABEL[r as Role] ?? r).join(" or ");
  if (s.approverType === "user") return userName ?? "Specific person";
  return APPROVER_TYPES[s.approverType as ApproverType] ?? s.approverType;
}

/** Who may decide this step for this requester (requester excluded, Super Admins as fallback). */
export async function resolveApprovers(step: Step, requesterId: string, db: Db = getDb()): Promise<{ ids: string[]; fallback: boolean }> {
  const u = schema.users;
  let ids: string[] = [];
  if (step.approverType === "role" && step.roles.length) {
    ids = (await db.select({ id: u.id }).from(u).where(and(eq(u.active, true), inArray(u.role, step.roles as Role[])))).map((r) => r.id);
  } else if (step.approverType === "user" && step.userId) {
    ids = (await db.select({ id: u.id }).from(u).where(and(eq(u.id, step.userId), eq(u.active, true)))).map((r) => r.id);
  } else if (step.approverType === "direct_manager") {
    const [me] = await db.select({ managerId: u.managerId }).from(u).where(eq(u.id, requesterId));
    if (me?.managerId) ids = (await db.select({ id: u.id }).from(u).where(and(eq(u.id, me.managerId), eq(u.active, true)))).map((r) => r.id);
  } else if (step.approverType === "department_head") {
    const [me] = await db.select({ dept: u.departmentId }).from(u).where(eq(u.id, requesterId));
    let deptId = me?.dept ?? null;
    // Walk up to the parent department when a department has no (active) head.
    for (let i = 0; deptId && i < 5 && !ids.length; i++) {
      const [d] = await db.select({ head: schema.departments.headUserId, parent: schema.departments.parentId }).from(schema.departments).where(eq(schema.departments.id, deptId));
      if (d?.head) ids = (await db.select({ id: u.id }).from(u).where(and(eq(u.id, d.head), eq(u.active, true)))).map((r) => r.id);
      deptId = d?.parent ?? null;
    }
  }
  ids = ids.filter((id) => id !== requesterId);
  if (ids.length) return { ids, fallback: false };
  const admins = (await db.select({ id: u.id }).from(u).where(and(eq(u.active, true), eq(u.role, "admin"), ne(u.id, requesterId)))).map((r) => r.id);
  return { ids: admins, fallback: true };
}

export type SubmitInput = { entityType: ApprovalEntity; entityId: string; amount: number; title: string; link: string; requesterId: string };

/**
 * Starts an approval. Any earlier pending request for the same record is
 * cancelled first. Returns "approved" when no active flow applies (nothing
 * to approve), otherwise the new request id.
 */
export async function submitForApproval(input: SubmitInput): Promise<{ status: "approved" } | { status: "pending"; requestId: string }> {
  const db = getDb();
  await cancelApprovals(input.entityType, input.entityId);
  const match = await resolveFlow(input.entityType, input.amount);
  if (!match || !match.steps.length) return { status: "approved" };
  const first = await resolveApprovers(match.steps[0], input.requesterId);
  const requestId = await db.transaction(async (tx) => {
    const [req] = await tx
      .insert(schema.approvalRequests)
      .values({ flowId: match.flow.id, entityType: input.entityType, entityId: input.entityId, amount: input.amount, title: input.title, link: input.link, requesterId: input.requesterId })
      .returning({ id: schema.approvalRequests.id });
    await tx.insert(schema.approvalActions).values(
      match.steps.map((s, i) => ({
        requestId: req.id,
        position: i + 1,
        label: stepLabel(s),
        approverType: s.approverType,
        roles: s.roles,
        userId: s.userId,
        approverIds: i === 0 ? first.ids : [],
        status: i === 0 ? ("pending" as const) : ("waiting" as const),
      })),
    );
    return req.id;
  });
  await notifyStep(input.entityType, first.ids, input.title, input.amount, input.link, match.steps.length > 1 ? `Step 1 of ${match.steps.length}` : undefined);
  return { status: "pending", requestId };
}

async function notifyStep(entityType: ApprovalEntity, ids: string[], title: string, amount: number, link: string, extra?: string) {
  await notify({
    userIds: ids,
    type: APPROVAL_ENTITIES[entityType].requested,
    title: `To approve: ${title}`,
    body: [formatAmount(entityType, amount), extra].filter(Boolean).join(" · "),
    link: "/approvals",
  });
  void link;
}

export async function cancelApprovals(entityType: ApprovalEntity, entityId: string) {
  await getDb()
    .update(schema.approvalRequests)
    .set({ status: "cancelled", decidedAt: new Date() })
    .where(and(eq(schema.approvalRequests.entityType, entityType), eq(schema.approvalRequests.entityId, entityId), eq(schema.approvalRequests.status, "pending")));
}

/** The pending request for a record, with its current step. */
export async function pendingRequestFor(entityType: ApprovalEntity, entityId: string) {
  const r = schema.approvalRequests;
  const [req] = await getDb()
    .select()
    .from(r)
    .where(and(eq(r.entityType, entityType), eq(r.entityId, entityId), eq(r.status, "pending")))
    .orderBy(desc(r.createdAt))
    .limit(1);
  if (!req) return null;
  const [step] = await getDb()
    .select()
    .from(schema.approvalActions)
    .where(and(eq(schema.approvalActions.requestId, req.id), eq(schema.approvalActions.position, req.currentStep)));
  return { req, step };
}

export const canDecideStep = (user: CurrentUser, requesterId: string, approverIds: string[]) =>
  user.id !== requesterId && (approverIds.includes(user.id) || user.role === "admin");

export type DecideResult = { ok: true; final: "approved" | "rejected" | null } | { ok: false; error: string };

/** Approve or reject the current step. Moves to the next step, or finishes the request. */
export async function decide(user: CurrentUser, requestId: string, decision: "approved" | "rejected", note?: string): Promise<DecideResult> {
  const db = getDb();
  const [req] = await db.select().from(schema.approvalRequests).where(eq(schema.approvalRequests.id, requestId));
  if (!req || req.status !== "pending") return { ok: false, error: "This request is no longer waiting for approval." };
  const steps = await db.select().from(schema.approvalActions).where(eq(schema.approvalActions.requestId, req.id)).orderBy(asc(schema.approvalActions.position));
  const current = steps.find((s) => s.position === req.currentStep);
  if (!current) return { ok: false, error: "This request has no open step." };
  if (req.requesterId === user.id) return { ok: false, error: "You can't decide on your own request." };
  if (!canDecideStep(user, req.requesterId, current.approverIds)) return { ok: false, error: `Waiting for: ${current.label}.` };
  if (decision === "rejected" && !note?.trim()) return { ok: false, error: "Tell the requester why." };

  const next = decision === "approved" ? steps.find((s) => s.position === req.currentStep + 1) : undefined;
  const nextApprovers = next ? await resolveApprovers({ approverType: next.approverType, roles: next.roles, userId: next.userId, label: next.label }, req.requesterId) : null;
  const final = decision === "rejected" ? "rejected" : next ? null : "approved";
  const at = new Date();

  // Only one decision wins if two approvers click at the same time.
  const applied = await db.transaction(async (tx) => {
    const done = await tx
      .update(schema.approvalActions)
      .set({ status: decision, decidedBy: user.id, note: note?.trim() || null, decidedAt: at })
      .where(and(eq(schema.approvalActions.id, current.id), eq(schema.approvalActions.status, "pending")))
      .returning({ id: schema.approvalActions.id });
    if (!done.length) return false;
    if (next && nextApprovers) {
      await tx.update(schema.approvalActions).set({ status: "pending", approverIds: nextApprovers.ids }).where(eq(schema.approvalActions.id, next.id));
      await tx.update(schema.approvalRequests).set({ currentStep: next.position }).where(eq(schema.approvalRequests.id, req.id));
    } else {
      await tx.update(schema.approvalRequests).set({ status: final!, decidedAt: at }).where(eq(schema.approvalRequests.id, req.id));
      if (decision === "rejected") {
        await tx.update(schema.approvalActions).set({ status: "skipped" }).where(and(eq(schema.approvalActions.requestId, req.id), eq(schema.approvalActions.status, "waiting")));
      }
      await applyOutcome(tx, req.entityType as ApprovalEntity, req.entityId, final!, user.id, note?.trim() || null, at);
    }
    return true;
  });
  if (!applied) return { ok: false, error: "Someone else decided this step just now." };

  const entityType = req.entityType as ApprovalEntity;
  await audit({ actorId: user.id, action: decision === "approved" ? "approve" : "reject", entity: "approval", entityId: req.title, changes: { step: `${current.position}/${steps.length} ${current.label}`, entity: entityType, note: note?.trim() || undefined } });
  if (next && nextApprovers) {
    await notifyStep(entityType, nextApprovers.ids, req.title, req.amount, req.link ?? "/approvals", `Step ${next.position} of ${steps.length} · approved by ${user.name}`);
  } else {
    await notify({
      userIds: [req.requesterId],
      type: APPROVAL_ENTITIES[entityType].decided,
      title: `${final === "approved" ? "Approved" : "Rejected"}: ${req.title}`,
      body: note?.trim() ? `${user.name}: ${note.trim()}` : `By ${user.name}.`,
      link: req.link ?? "/approvals",
    });
  }
  return { ok: true, final };
}

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** What a finished request changes on its record. */
async function applyOutcome(tx: Tx, entityType: ApprovalEntity, entityId: string, outcome: "approved" | "rejected", by: string, note: string | null, at: Date) {
  switch (entityType) {
    case "visit_fee":
      await tx
        .update(schema.visitFees)
        .set({ status: outcome, decidedBy: by, decidedAt: at, decisionNote: outcome === "rejected" ? note : null })
        .where(and(eq(schema.visitFees.id, entityId), eq(schema.visitFees.status, "pending")));
      break;
    case "quotation_discount":
      await tx
        .update(schema.quotations)
        .set({ approval: outcome, approvalNote: note, approvedBy: by, approvedAt: at })
        .where(and(eq(schema.quotations.id, entityId), eq(schema.quotations.approval, "pending")));
      break;
    default:
      // project / project_budget / purchase_request: wired up when those modules are built (Batch 5).
      break;
  }
}

/** Requests waiting for this user (as an approver of the current step; Super Admin: all). */
export async function getPendingFor(user: CurrentUser) {
  const r = schema.approvalRequests;
  const a = schema.approvalActions;
  return getDb()
    .select({ id: r.id, entityType: r.entityType, title: r.title, amount: r.amount, link: r.link, createdAt: r.createdAt, requester: schema.users.name, requesterId: r.requesterId, step: a.position, stepLabel: a.label, approverIds: a.approverIds })
    .from(r)
    .innerJoin(a, and(eq(a.requestId, r.id), eq(a.position, r.currentStep)))
    .innerJoin(schema.users, eq(schema.users.id, r.requesterId))
    .where(and(eq(r.status, "pending"), ne(r.requesterId, user.id), user.role === "admin" ? undefined : sql`${user.id} = any(${a.approverIds})`))
    .orderBy(asc(r.createdAt));
}

export async function countPendingFor(user: CurrentUser): Promise<number> {
  const r = schema.approvalRequests;
  const a = schema.approvalActions;
  const [row] = await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(r)
    .innerJoin(a, and(eq(a.requestId, r.id), eq(a.position, r.currentStep)))
    .where(and(eq(r.status, "pending"), ne(r.requesterId, user.id), sql`${user.id} = any(${a.approverIds})`));
  return row?.n ?? 0;
}

/** Dry run for the settings page: which flow and who would approve, step by step. */
export async function simulateApproval(entityType: ApprovalEntity, amount: number, requesterId: string) {
  const match = await resolveFlow(entityType, amount);
  if (!match) return null;
  const names = new Map((await getDb().select({ id: schema.users.id, name: schema.users.name }).from(schema.users)).map((u) => [u.id, u.name]));
  const steps = [];
  for (const s of match.steps) {
    const who = await resolveApprovers(s, requesterId);
    steps.push({ position: s.position, label: stepLabel(s, s.userId ? names.get(s.userId) : null), approvers: who.ids.map((id) => names.get(id) ?? id), fallback: who.fallback });
  }
  return { flow: match.flow, steps };
}
