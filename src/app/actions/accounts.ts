"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { audit } from "@/lib/audit";
import { verifyUser } from "@/lib/auth";
import { findDuplicate } from "@/lib/duplicates";
import { fieldErrors, formObject, type FormState } from "@/lib/forms";
import { LEAD_SOURCES, SEGMENTS } from "@/lib/labels";
import { canSell, isManager } from "@/lib/permissions";
import { normalizePhone } from "@/lib/phone";

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
  await getDb().transaction(async (tx) => {
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
  });
  await audit({ actorId: user.id, action: "create", entity: "customer", entityId: d.name, changes: { segment: d.segment } });
  refresh();
  return { ok: true, message: `${d.name} added.` };
}
