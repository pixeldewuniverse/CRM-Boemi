"use server";

import { eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { enqueueQualification } from "@/lib/qualification/queue";
import { audit } from "@/lib/audit";
import { verifyUser } from "@/lib/auth";
import { findDuplicate } from "@/lib/duplicates";
import { fieldErrors, formObject, type FormState } from "@/lib/forms";
import { LEAD_SOURCES, SEGMENTS } from "@/lib/labels";
import { canSell, isManager } from "@/lib/permissions";
import { normalizePhone } from "@/lib/phone";
import { loadAccount } from "@/lib/records";

const Account = z.object({
  name: z.string("Account name is required.").min(2, "Account name is required.").max(160),
  segment: z.enum(SEGMENTS, "Choose a segment."),
  city: z.string().max(120).optional(),
  phone: z.string().max(40).optional(),
  email: z.email("Enter a valid email.").max(254).optional(),
  source: z.enum(LEAD_SOURCES, "Choose a source."),
  ownerId: z.uuid().optional(),
  contactName: z.string().max(120).optional(),
  contactPosition: z.string().max(120).optional(),
  consent: z.literal("on").optional(),
});

export async function createAccount(_prev: FormState, fd: FormData): Promise<FormState> {
  const user = await verifyUser();
  if (!canSell(user)) return { ok: false, error: "Your role can't add accounts." };
  const parsed = Account.safeParse(formObject(fd));
  if (!parsed.success) return fieldErrors(parsed.error);
  const d = parsed.data;
  const phone = normalizePhone(d.phone);
  if (d.phone && !phone) return { ok: false, error: "Please check the highlighted fields.", fieldErrors: { phone: "Enter a valid phone number." } };
  const dup = await findDuplicate(phone, d.email ?? null);
  if (dup) return { ok: false, error: dup };

  const ownerId = isManager(user) && d.ownerId ? d.ownerId : user.id;
  const accountId = await getDb().transaction(async (tx) => {
    const [c] = await tx
      .insert(schema.customers)
      .values({
        name: d.name,
        businessType: d.segment,
        status: "prospect",
        city: d.city,
        phoneE164: phone,
        email: d.email,
        source: d.source,
        ownerId,
        marketingConsent: Boolean(d.consent),
        consentAt: d.consent ? new Date() : null,
      })
      .returning({ id: schema.customers.id });
    if (d.contactName) {
      await tx.insert(schema.contacts).values({
        customerId: c.id,
        name: d.contactName,
        position: d.contactPosition,
        phoneE164: phone,
        email: d.email,
        isDecisionMaker: true,
      });
    }
    return c.id;
  });
  await enqueueQualification("account", accountId, "created");
  await audit({ actorId: user.id, action: "create", entity: "customer", entityId: d.name, changes: { segment: d.segment } });
  refresh();
  return { ok: true, message: `${d.name} added.` };
}

const AccountEdit = z.object({
  id: z.uuid(),
  name: z.string("Account name is required.").min(2, "Account name is required.").max(160),
  segment: z.enum(SEGMENTS, "Choose a segment."),
  status: z.enum(["prospect", "active", "inactive"]).optional(),
  city: z.string().max(120).optional(),
  address: z.string().max(300).optional(),
  phone: z.string().max(40).optional(),
  email: z.email("Enter a valid email.").max(254).optional(),
  instagram: z.string().max(60).optional(),
  source: z.enum(LEAD_SOURCES, "Choose a source."),
  campaignId: z.uuid().optional(),
  ownerId: z.uuid().optional(),
  consent: z.literal("on").optional(),
});

/** Owner or manager. Only managers can hand the account to another rep. */
export async function updateAccount(_prev: FormState, fd: FormData): Promise<FormState> {
  const user = await verifyUser();
  const parsed = AccountEdit.safeParse(formObject(fd));
  if (!parsed.success) return fieldErrors(parsed.error);
  const d = parsed.data;
  const account = await loadAccount(user, d.id);
  if (!account?.editable) return { ok: false, error: "Only the account owner or a manager can edit this account." };
  const phone = normalizePhone(d.phone);
  if (d.phone && !phone) return { ok: false, error: "Please check the highlighted fields.", fieldErrors: { phone: "Enter a valid phone number." } };
  const dup = await findDuplicate(phone, d.email ?? null, undefined, d.id);
  if (dup) return { ok: false, error: dup };
  const db = getDb();
  const [before] = await db.select().from(schema.customers).where(eq(schema.customers.id, d.id));
  const ownerId = isManager(user) && d.ownerId ? d.ownerId : before.ownerId;
  const consentChanged = Boolean(d.consent) !== before.marketingConsent;
  const values = {
    name: d.name,
    businessType: d.segment,
    status: d.status ?? before.status,
    city: d.city ?? null,
    address: d.address ?? null,
    phoneE164: phone,
    email: d.email?.toLowerCase() ?? null,
    instagram: d.instagram?.replace(/^@/, "") ?? null,
    source: d.source,
    campaignId: d.campaignId ?? null,
    ownerId,
    marketingConsent: Boolean(d.consent),
    ...(consentChanged ? { consentAt: d.consent ? new Date() : null } : {}),
  };
  await db.update(schema.customers).set(values).where(eq(schema.customers.id, d.id));
  const changes: Record<string, unknown> = {};
  for (const k of ["name", "businessType", "status", "ownerId", "campaignId", "phoneE164", "email", "marketingConsent"] as const) {
    if (before[k] !== values[k]) changes[k] = [before[k], values[k]];
  }
  await audit({ actorId: user.id, action: "update", entity: "customer", entityId: d.name, changes });
  await enqueueQualification("account", d.id, "account-updated");
  refresh();
  return { ok: true, message: "Account saved." };
}
