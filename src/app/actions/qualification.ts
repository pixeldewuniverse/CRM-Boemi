"use server";

import { and, desc, eq, notInArray } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { audit } from "@/lib/audit";
import { verifyUser, type CurrentUser } from "@/lib/auth";
import { fieldErrors, formObject, type FormState } from "@/lib/forms";
import { canEditOwned, isAdmin } from "@/lib/permissions";
import { RULE_FIELDS } from "@/lib/qualification/core";
import { scoreDetails } from "@/lib/qualification/details";
import { enqueueQualification, qualifyNow } from "@/lib/qualification/queue";
import { loadAccount } from "@/lib/records";
import { ownedBy } from "@/lib/scope";

const Subject = z.object({ type: z.enum(["lead", "account"]), id: z.uuid() });

/** The record if the user may see it, plus whether they may change it. */
async function subject(user: CurrentUser, type: "lead" | "account", id: string) {
  if (type === "account") {
    const a = await loadAccount(user, id);
    return a ? { name: a.name, ownerId: a.ownerId, editable: a.editable } : null;
  }
  const [l] = await getDb()
    .select({ name: schema.leads.company, ownerId: schema.leads.ownerId })
    .from(schema.leads)
    .where(and(eq(schema.leads.id, id), ownedBy(user, schema.leads.ownerId)));
  return l ? { ...l, editable: canEditOwned(user, l.ownerId) } : null;
}

/** Manual "Re-score": runs now so the result shows straight away. */
export async function rescore(input: { type: "lead" | "account"; id: string }): Promise<FormState> {
  const user = await verifyUser();
  const p = Subject.safeParse(input);
  if (!p.success) return { ok: false, error: "Invalid request." };
  const s = await subject(user, p.data.type, p.data.id);
  if (!s) return { ok: false, error: "Not found." };
  const r = await qualifyNow(p.data.type, p.data.id, "manual", user.id);
  refresh();
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, message: `Score ${r.score} · ${r.tier}${r.aiError ? " (rules only — AI unavailable, it will retry)" : ""}.` };
}

const Override = z.object({
  type: z.enum(["lead", "account"]),
  id: z.uuid(),
  tier: z.enum(["hot", "warm", "cold", ""]).default(""),
  reason: z.string().trim().max(500).optional(),
});

/** Sales/manager override of the tier. Reason required; recorded in the audit trail. */
export async function overrideTier(_prev: FormState, fd: FormData): Promise<FormState> {
  const user = await verifyUser();
  const p = Override.safeParse({ ...formObject(fd), tier: fd.get("tier") ?? "" });
  if (!p.success) return fieldErrors(p.error);
  const { type, id, tier, reason } = p.data;
  if (!reason || reason.length < 10) return { ok: false, error: "Please check the highlighted fields.", fieldErrors: { reason: "Explain why in at least 10 characters." } };
  const s = await subject(user, type, id);
  if (!s) return { ok: false, error: "Not found." };
  if (!s.editable) return { ok: false, error: "Only the owner or a manager can override the tier." };
  const db = getDb();
  const table = type === "lead" ? schema.leads : schema.customers;
  const [before] = await db.select({ score: table.qualificationScore, override: table.tierOverride }).from(table).where(eq(table.id, id));
  const [run] = await db
    .select({ tier: schema.qualificationRuns.tier })
    .from(schema.qualificationRuns)
    .where(and(eq(schema.qualificationRuns.subjectType, type), eq(schema.qualificationRuns.subjectId, id)))
    .orderBy(desc(schema.qualificationRuns.createdAt))
    .limit(1);
  const computed = run?.tier ?? null;
  const next = tier || null;
  await db
    .update(table)
    .set({ tierOverride: next, tierOverrideReason: next ? reason : null, tierOverrideBy: next ? user.id : null, tierOverrideAt: next ? new Date() : null, qualificationTier: next ?? computed })
    .where(eq(table.id, id));
  await audit({ actorId: user.id, action: "override", entity: type === "lead" ? "lead_tier" : "account_tier", entityId: s.name, changes: { tier: [before?.override ?? `${computed ?? "unscored"} (computed)`, next ?? `${computed ?? "unscored"} (computed)`], reason, score: before?.score } });
  refresh();
  return { ok: true, message: next ? `Tier set to ${next}.` : "Back to the computed tier." };
}

/* ───────────── Master Data (Super Admin) ───────────── */

const Criterion = z.object({
  id: z.uuid().optional(),
  name: z.string("Name it.").trim().min(3, "Name it.").max(120),
  kind: z.enum(["rule", "ai"]),
  field: z.string().max(80).optional(),
  operator: z.enum(["equals", "not_equals", "in", "gte", "lte", "contains", "exists"]).default("equals"),
  value: z.string().max(500).optional(),
  weight: z.coerce.number("Enter a weight.").int().min(1, "1–100").max(100, "1–100"),
  description: z.string().max(1500).optional(),
  active: z.literal("on").optional(),
});

/** "Bali, NTB" → ["Bali","NTB"], "25000000" → 25000000, "true" → true. */
function parseValue(op: string, raw: string | undefined): unknown {
  const v = (raw ?? "").trim();
  if (op === "exists") return null;
  if (op === "in") return v.split(",").map((x) => x.trim()).filter(Boolean);
  if (op === "gte" || op === "lte") return Number(v.replace(/[^\d.-]/g, ""));
  if (v === "true" || v === "false") return v === "true";
  return v;
}

export async function saveCriterion(_prev: FormState, fd: FormData): Promise<FormState> {
  const user = await verifyUser();
  if (!isAdmin(user)) return { ok: false, error: "Only Super Admin can change qualification criteria." };
  const p = Criterion.safeParse(formObject(fd));
  if (!p.success) return fieldErrors(p.error);
  const d = p.data;
  if (d.kind === "rule") {
    if (!d.field || !RULE_FIELDS.some((f) => f.value === d.field) && !/^interests\.[\w.]{1,60}$/.test(d.field)) return { ok: false, error: "Please check the highlighted fields.", fieldErrors: { field: "Pick a field." } };
    if (d.operator !== "exists" && !d.value?.trim()) return { ok: false, error: "Please check the highlighted fields.", fieldErrors: { value: "Enter the value to compare with." } };
    if ((d.operator === "gte" || d.operator === "lte") && !Number.isFinite(parseValue(d.operator, d.value) as number)) return { ok: false, error: "Please check the highlighted fields.", fieldErrors: { value: "Enter a number." } };
  } else if (!d.description || d.description.trim().length < 20) {
    return { ok: false, error: "Please check the highlighted fields.", fieldErrors: { description: "Describe what 0, 1, 2 and 3 mean (at least 20 characters)." } };
  }
  const values = {
    name: d.name,
    kind: d.kind,
    field: d.kind === "rule" ? d.field! : "text",
    operator: d.kind === "rule" ? d.operator : ("exists" as const),
    value: d.kind === "rule" ? parseValue(d.operator, d.value) : null,
    weight: d.weight,
    description: d.description?.trim() || null,
    active: Boolean(d.active),
  };
  const db = getDb();
  if (d.id) await db.update(schema.qualificationCriteria).set(values).where(eq(schema.qualificationCriteria.id, d.id));
  else await db.insert(schema.qualificationCriteria).values(values);
  await audit({ actorId: user.id, action: d.id ? "update" : "create", entity: "qualification_criterion", entityId: d.name, changes: { kind: d.kind, field: values.field, operator: values.operator, value: values.value, weight: d.weight, active: values.active } });
  refresh();
  return { ok: true, message: "Saved. Use “Re-score all” to apply it to existing leads and accounts." };
}

export async function deleteCriterion(_prev: FormState, fd: FormData): Promise<FormState> {
  const user = await verifyUser();
  if (!isAdmin(user)) return { ok: false, error: "Only Super Admin can change qualification criteria." };
  const id = z.uuid().safeParse(fd.get("id"));
  if (!id.success) return { ok: false, error: "Invalid criterion." };
  const [c] = await getDb().delete(schema.qualificationCriteria).where(eq(schema.qualificationCriteria.id, id.data)).returning({ name: schema.qualificationCriteria.name });
  if (c) await audit({ actorId: user.id, action: "delete", entity: "qualification_criterion", entityId: c.name });
  refresh();
  return { ok: true, message: "Deleted. Past runs keep their copy of it." };
}

/** Queue every open lead and every account for a fresh score (after criteria changes). */
export async function rescoreAll(_prev: FormState, _fd: FormData): Promise<FormState> {
  void _fd;
  const user = await verifyUser();
  if (!isAdmin(user)) return { ok: false, error: "Only Super Admin can re-score everything." };
  const db = getDb();
  const [leads, accounts] = await Promise.all([
    db.select({ id: schema.leads.id }).from(schema.leads).where(notInArray(schema.leads.status, ["disqualified"])),
    db.select({ id: schema.customers.id }).from(schema.customers).where(notInArray(schema.customers.status, ["inactive"])),
  ]);
  await enqueueQualification("lead", leads.map((l) => l.id), "criteria-changed");
  await enqueueQualification("account", accounts.map((a) => a.id), "criteria-changed");
  await audit({ actorId: user.id, action: "rescore_all", entity: "qualification", changes: { leads: leads.length, accounts: accounts.length } });
  refresh();
  return { ok: true, message: `Queued ${leads.length} leads and ${accounts.length} accounts. Scores update in the background.` };
}

/** Score breakdown for the dialog on the Leads list. */
export async function loadScoreDetails(input: { type: "lead" | "account"; id: string }) {
  const user = await verifyUser();
  const p = Subject.safeParse(input);
  if (!p.success) return null;
  const s = await subject(user, p.data.type, p.data.id);
  if (!s) return null;
  const d = await scoreDetails(p.data.type, p.data.id);
  return d ? { ...d, editable: s.editable } : null;
}
