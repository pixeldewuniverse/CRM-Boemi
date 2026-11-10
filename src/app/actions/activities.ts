"use server";

import { and, eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { audit } from "@/lib/audit";
import { verifyUser } from "@/lib/auth";
import { fieldErrors, formObject, type FormState } from "@/lib/forms";
import { ACTIVITY_LOG_TYPES } from "@/lib/labels";
import { canSell, isManager } from "@/lib/permissions";
import { loadAccount } from "@/lib/records";

const Activity = z.object({
  customerId: z.uuid("Choose an account."),
  opportunityId: z.uuid().optional(),
  contactId: z.uuid().optional(),
  type: z.enum(ACTIVITY_LOG_TYPES, "Choose a type."),
  // datetime-local: "2026-11-10T14:30" in Jakarta time
  occurredAt: z.string("Pick a date and time.").regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Pick a date and time."),
  notes: z.string("Write what happened.").min(3, "Write what happened.").max(2000),
});

/** Logs something that already happened (call, WhatsApp, email, meeting, note). */
export async function logActivity(_prev: FormState, fd: FormData): Promise<FormState> {
  const user = await verifyUser();
  if (!canSell(user)) return { ok: false, error: "Your role can't log sales activities." };
  const parsed = Activity.safeParse(formObject(fd));
  if (!parsed.success) return fieldErrors(parsed.error);
  const d = parsed.data;
  const account = await loadAccount(user, d.customerId);
  if (!account?.editable) return { ok: false, error: "Only the account owner or a manager can log activities here." };
  const occurredAt = new Date(`${d.occurredAt}:00+07:00`);
  if (Number.isNaN(occurredAt.getTime())) return { ok: false, error: "Please check the highlighted fields.", fieldErrors: { occurredAt: "Pick a date and time." } };
  if (occurredAt.getTime() > Date.now() + 5 * 60_000) {
    return { ok: false, error: "Please check the highlighted fields.", fieldErrors: { occurredAt: "Log past activities. Plan future ones as a task." } };
  }
  const db = getDb();
  if (d.opportunityId) {
    const [deal] = await db.select({ id: schema.opportunities.id }).from(schema.opportunities).where(and(eq(schema.opportunities.id, d.opportunityId), eq(schema.opportunities.customerId, account.id)));
    if (!deal) return { ok: false, error: "That deal belongs to another account." };
  }
  if (d.contactId) {
    const [c] = await db.select({ id: schema.contacts.id }).from(schema.contacts).where(and(eq(schema.contacts.id, d.contactId), eq(schema.contacts.customerId, account.id)));
    if (!c) return { ok: false, error: "That contact belongs to another account." };
  }
  await db.insert(schema.activities).values({
    type: d.type,
    occurredAt,
    notes: d.notes,
    customerId: account.id,
    opportunityId: d.opportunityId ?? null,
    contactId: d.contactId ?? null,
    userId: user.id,
  });
  await audit({ actorId: user.id, action: "create", entity: "activity", entityId: `${d.type} · ${account.name}` });
  refresh();
  return { ok: true, message: `${d.type} logged.` };
}

/** Author or a manager can remove a wrong entry. */
export async function deleteActivity(_prev: FormState, fd: FormData): Promise<FormState> {
  const user = await verifyUser();
  const id = z.uuid().safeParse(fd.get("id"));
  if (!id.success) return { ok: false, error: "Invalid activity." };
  const db = getDb();
  const [a] = await db
    .select({ id: schema.activities.id, userId: schema.activities.userId, type: schema.activities.type, account: schema.customers.name })
    .from(schema.activities)
    .innerJoin(schema.customers, eq(schema.customers.id, schema.activities.customerId))
    .where(eq(schema.activities.id, id.data));
  if (!a) return { ok: false, error: "Activity not found." };
  if (a.userId !== user.id && !isManager(user)) return { ok: false, error: "Only the author or a manager can delete this entry." };
  await db.delete(schema.activities).where(eq(schema.activities.id, a.id));
  await audit({ actorId: user.id, action: "delete", entity: "activity", entityId: `${a.type} · ${a.account}` });
  refresh();
  return { ok: true, message: "Entry deleted." };
}
