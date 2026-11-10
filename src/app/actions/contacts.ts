"use server";

import { and, eq, ne, or, sql } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { audit } from "@/lib/audit";
import { verifyUser } from "@/lib/auth";
import { fieldErrors, formObject, type FormState } from "@/lib/forms";
import { normalizePhone } from "@/lib/phone";
import { loadAccount } from "@/lib/records";

const Contact = z.object({
  customerId: z.uuid("Choose an account."),
  name: z.string("Name is required.").min(2, "Name is required.").max(120),
  position: z.string().max(120).optional(),
  phone: z.string().max(40).optional(),
  email: z.email("Enter a valid email.").max(254).optional(),
  isDecisionMaker: z.literal("on").optional(),
  notes: z.string().max(1000).optional(),
});

/** Same phone or email already on another contact (any account). */
async function contactDuplicate(phone: string | null, email: string | null, exceptId?: string) {
  if (!phone && !email) return null;
  const c = schema.contacts;
  const [dup] = await getDb()
    .select({ name: c.name, account: schema.customers.name })
    .from(c)
    .innerJoin(schema.customers, eq(schema.customers.id, c.customerId))
    .where(
      and(
        exceptId ? ne(c.id, exceptId) : undefined,
        or(phone ? eq(c.phoneE164, phone) : undefined, email ? sql`lower(${c.email}) = ${email.toLowerCase()}` : undefined),
      ),
    )
    .limit(1);
  return dup ? `Already a contact: ${dup.name} at ${dup.account}.` : null;
}

async function validate(fd: FormData, exceptId?: string) {
  const user = await verifyUser();
  const parsed = Contact.safeParse(formObject(fd));
  if (!parsed.success) return { user, error: fieldErrors(parsed.error) } as const;
  const d = parsed.data;
  const account = await loadAccount(user, d.customerId);
  if (!account || !account.editable) return { user, error: { ok: false, error: "Only the account owner or a manager can change its contacts." } } as const;
  const phone = normalizePhone(d.phone);
  if (d.phone && !phone) return { user, error: { ok: false, error: "Please check the highlighted fields.", fieldErrors: { phone: "Enter a valid phone number." } } } as const;
  const dup = await contactDuplicate(phone, d.email ?? null, exceptId);
  if (dup) return { user, error: { ok: false, error: dup } } as const;
  return {
    user,
    account,
    values: {
      customerId: account.id,
      name: d.name,
      position: d.position ?? null,
      phoneE164: phone,
      email: d.email?.toLowerCase() ?? null,
      isDecisionMaker: Boolean(d.isDecisionMaker),
      notes: d.notes ?? null,
    },
  } as const;
}

export async function createContact(_prev: FormState, fd: FormData): Promise<FormState> {
  const v = await validate(fd);
  if ("error" in v) return v.error as FormState;
  await getDb().insert(schema.contacts).values(v.values);
  await audit({ actorId: v.user.id, action: "create", entity: "contact", entityId: v.values.name, changes: { account: v.account.name } });
  refresh();
  return { ok: true, message: `${v.values.name} added.` };
}

export async function updateContact(_prev: FormState, fd: FormData): Promise<FormState> {
  const id = z.uuid().safeParse(fd.get("id"));
  if (!id.success) return { ok: false, error: "Invalid contact." };
  const [current] = await getDb().select({ customerId: schema.contacts.customerId }).from(schema.contacts).where(eq(schema.contacts.id, id.data));
  if (!current) return { ok: false, error: "Contact not found." };
  fd.set("customerId", current.customerId); // a contact stays on its account
  const v = await validate(fd, id.data);
  if ("error" in v) return v.error as FormState;
  await getDb().update(schema.contacts).set(v.values).where(eq(schema.contacts.id, id.data));
  await audit({ actorId: v.user.id, action: "update", entity: "contact", entityId: v.values.name, changes: { account: v.account.name } });
  refresh();
  return { ok: true, message: "Contact saved." };
}

export async function deleteContact(_prev: FormState, fd: FormData): Promise<FormState> {
  const user = await verifyUser();
  const id = z.uuid().safeParse(fd.get("id"));
  if (!id.success) return { ok: false, error: "Invalid contact." };
  const [c] = await getDb().select().from(schema.contacts).where(eq(schema.contacts.id, id.data));
  if (!c) return { ok: false, error: "Contact not found." };
  const account = await loadAccount(user, c.customerId);
  if (!account?.editable) return { ok: false, error: "Only the account owner or a manager can delete contacts." };
  await getDb().delete(schema.contacts).where(eq(schema.contacts.id, c.id));
  await audit({ actorId: user.id, action: "delete", entity: "contact", entityId: c.name, changes: { account: account.name } });
  refresh();
  return { ok: true, message: `${c.name} deleted.` };
}
