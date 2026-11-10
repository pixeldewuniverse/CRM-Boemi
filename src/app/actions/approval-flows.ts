"use server";

import { and, count, eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { APPROVAL_ENTITY_KEYS, simulateApproval, type ApprovalEntity } from "@/lib/approvals";
import { audit } from "@/lib/audit";
import { verifyUser } from "@/lib/auth";
import { fieldErrors, formObject, parseRupiah, type FormState } from "@/lib/forms";
import { canManageUsers } from "@/lib/permissions";
import { ROLES } from "@/lib/roles";

const DENIED: FormState = { ok: false, error: "Only a Super Admin can change approval workflows." };

const Step = z
  .object({
    approverType: z.enum(["role", "user", "direct_manager", "department_head"]),
    roles: z.array(z.enum(ROLES)).default([]),
    userId: z.uuid().nullable().optional(),
    label: z.string().max(80).nullable().optional(),
  })
  .refine((s) => s.approverType !== "role" || s.roles.length > 0, "Pick at least one role for each “role” step.")
  .refine((s) => s.approverType !== "user" || Boolean(s.userId), "Pick the person for each “specific person” step.");

const Flow = z.object({
  entityType: z.enum(APPROVAL_ENTITY_KEYS as [ApprovalEntity, ...ApprovalEntity[]], "Choose a request type."),
  name: z.string("Give the workflow a name.").min(3, "Give the workflow a name.").max(120),
  minAmount: z.string().optional(),
  maxAmount: z.string().optional(),
  priority: z.coerce.number().int().min(1).max(999).default(100),
  active: z.literal("on").optional(),
  steps: z.string("Add at least one step."),
});

function parse(fd: FormData) {
  const parsed = Flow.safeParse(formObject(fd));
  if (!parsed.success) return { error: fieldErrors(parsed.error) } as const;
  const d = parsed.data;
  let raw: unknown;
  try {
    raw = JSON.parse(d.steps);
  } catch {
    raw = null;
  }
  const steps = z.array(Step).min(1, "Add at least one step.").max(6, "Up to 6 steps.").safeParse(raw);
  if (!steps.success) return { error: { ok: false, error: steps.error.issues[0]?.message ?? "Check the steps.", fieldErrors: { steps: steps.error.issues[0]?.message ?? "Check the steps." } } } as const;
  const min = d.minAmount ? (parseRupiah(d.minAmount) ?? null) : null;
  const max = d.maxAmount ? (parseRupiah(d.maxAmount) ?? null) : null;
  if (min !== null && max !== null && max < min) return { error: { ok: false, error: "Please check the highlighted fields.", fieldErrors: { maxAmount: "Must be at least the minimum." } } } as const;
  return {
    flow: { entityType: d.entityType, name: d.name, minAmount: min, maxAmount: max, priority: d.priority, active: Boolean(d.active) },
    steps: steps.data.map((s, i) => ({ position: i + 1, approverType: s.approverType, roles: s.approverType === "role" ? s.roles : [], userId: s.approverType === "user" ? (s.userId ?? null) : null, label: s.label?.trim() || null })),
  } as const;
}

/** Create or update a workflow with its steps (order = position). Requests already in progress keep their copied steps. */
export async function saveApprovalFlow(_prev: FormState, fd: FormData): Promise<FormState> {
  const user = await verifyUser();
  if (!canManageUsers(user)) return DENIED;
  const id = fd.get("id") ? z.uuid().safeParse(fd.get("id")) : null;
  if (id && !id.success) return { ok: false, error: "Invalid workflow." };
  const v = parse(fd);
  if ("error" in v) return v.error as FormState;
  const db = getDb();
  const flowId = await db.transaction(async (tx) => {
    let fid = id?.success ? id.data : null;
    if (fid) {
      const updated = await tx.update(schema.approvalFlows).set(v.flow).where(eq(schema.approvalFlows.id, fid)).returning({ id: schema.approvalFlows.id });
      if (!updated.length) return null;
      await tx.delete(schema.approvalFlowSteps).where(eq(schema.approvalFlowSteps.flowId, fid));
    } else {
      [{ id: fid }] = await tx.insert(schema.approvalFlows).values(v.flow).returning({ id: schema.approvalFlows.id });
    }
    await tx.insert(schema.approvalFlowSteps).values(v.steps.map((s) => ({ ...s, flowId: fid! })));
    return fid;
  });
  if (!flowId) return { ok: false, error: "Workflow not found." };
  await audit({
    actorId: user.id,
    action: id ? "update" : "create",
    entity: "approval_flow",
    entityId: v.flow.name,
    changes: { type: v.flow.entityType, active: v.flow.active, range: [v.flow.minAmount, v.flow.maxAmount], steps: v.steps.map((s) => s.label ?? s.approverType + (s.roles.length ? `:${s.roles.join("|")}` : "")) },
  });
  refresh();
  return { ok: true, message: "Workflow saved." };
}

export async function deleteApprovalFlow(_prev: FormState, fd: FormData): Promise<FormState> {
  const user = await verifyUser();
  if (!canManageUsers(user)) return DENIED;
  const id = z.uuid().safeParse(fd.get("id"));
  if (!id.success) return { ok: false, error: "Invalid workflow." };
  const db = getDb();
  const [f] = await db.select().from(schema.approvalFlows).where(eq(schema.approvalFlows.id, id.data));
  if (!f) return { ok: false, error: "Workflow not found." };
  const [{ n }] = await db.select({ n: count() }).from(schema.approvalRequests).where(and(eq(schema.approvalRequests.flowId, f.id), eq(schema.approvalRequests.status, "pending")));
  if (n > 0) return { ok: false, error: `${n} request(s) are still going through this workflow. Deactivate it instead.` };
  await db.delete(schema.approvalFlows).where(eq(schema.approvalFlows.id, f.id));
  await audit({ actorId: user.id, action: "delete", entity: "approval_flow", entityId: f.name });
  refresh();
  return { ok: true, message: `${f.name} deleted.` };
}

export type SimulationResult = Awaited<ReturnType<typeof simulateApproval>> | { error: string };

/** "Who would approve amount X for this requester?" — read-only. */
export async function testApprovalFlow(input: { entityType: string; amount: string; requesterId: string }): Promise<SimulationResult> {
  const user = await verifyUser();
  if (!canManageUsers(user)) return { error: "Only a Super Admin can test workflows." };
  const p = z.object({ entityType: z.enum(APPROVAL_ENTITY_KEYS as [ApprovalEntity, ...ApprovalEntity[]]), amount: z.string(), requesterId: z.uuid("Choose who is asking.") }).safeParse(input);
  if (!p.success) return { error: p.error.issues[0]?.message ?? "Check the inputs." };
  const amount = p.data.entityType === "quotation_discount" ? Math.ceil(Number(p.data.amount.replace(",", ".")) || 0) : (parseRupiah(p.data.amount) ?? 0);
  return simulateApproval(p.data.entityType, amount, p.data.requesterId);
}
