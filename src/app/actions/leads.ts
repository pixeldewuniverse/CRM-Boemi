"use server";

import { and, eq, inArray } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { audit } from "@/lib/audit";
import { verifyUser } from "@/lib/auth";
import { findDuplicate } from "@/lib/duplicates";
import { fieldErrors, formObject, parseRupiah, type FormState } from "@/lib/forms";
import { DISQUALIFY_REASONS, LEAD_SOURCES, SEGMENTS } from "@/lib/labels";
import { notify } from "@/lib/notifications";
import { managersOf } from "@/lib/notifications/recipients";
import { canAddLeads, canEditOwned, isManager } from "@/lib/permissions";
import { normalizePhone } from "@/lib/phone";
import { enqueueQualification } from "@/lib/qualification/queue";

const Lead = z.object({
  company: z.string("Company name is required.").min(2, "Company name is required.").max(160),
  picName: z.string().max(120).optional(),
  phone: z.string().max(40).optional(),
  email: z.email("Enter a valid email.").max(254).optional(),
  segment: z.enum(SEGMENTS, "Choose a segment."),
  city: z.string().max(120).optional(),
  source: z.enum(LEAD_SOURCES, "Choose where this lead came from."),
  campaignId: z.uuid().optional(),
  ownerId: z.uuid().optional(),
  note: z.string().max(1000).optional(),
});

export async function createLead(_prev: FormState, fd: FormData): Promise<FormState> {
  const user = await verifyUser();
  if (!canAddLeads(user)) return { ok: false, error: "Your role can't add leads." };
  const parsed = Lead.safeParse(formObject(fd));
  if (!parsed.success) return fieldErrors(parsed.error);
  const d = parsed.data;

  const phone = normalizePhone(d.phone);
  if (d.phone && !phone) return { ok: false, error: "Please check the highlighted fields.", fieldErrors: { phone: "Enter a valid phone number." } };
  if (!phone && !d.email) return { ok: false, error: "Add a phone number or an email.", fieldErrors: { phone: "Phone or email is required." } };
  const dup = await findDuplicate(phone, d.email ?? null);
  if (dup) return { ok: false, error: dup };

  const ownerId = isManager(user) && d.ownerId ? d.ownerId : user.role === "marketing" ? (d.ownerId ?? null) : user.id;
  const [created] = await getDb()
    .insert(schema.leads)
    .values({
      company: d.company,
      picName: d.picName,
      phoneE164: phone,
      email: d.email,
      segment: d.segment,
      city: d.city,
      source: d.source,
      campaignId: d.campaignId,
      ownerId,
      note: d.note,
    })
    .returning({ id: schema.leads.id });
  await enqueueQualification("lead", created.id, "created");

  await audit({ actorId: user.id, action: "create", entity: "lead", entityId: d.company, changes: { source: d.source } });
  if (ownerId && ownerId !== user.id) {
    await notify({ userIds: [ownerId], type: "lead.hot", title: `New lead for you: ${d.company}`, body: `Added by ${user.name} · ${d.source}`, link: "/sales/leads" });
  }
  await notify({
    userIds: await managersOf(ownerId ?? user.id, [user.id, ownerId]),
    type: "lead.new",
    title: `New lead: ${d.company}`,
    body: `${d.segment} · ${d.source} · added by ${user.name}`,
    link: "/sales/leads",
  });
  refresh();
  return { ok: true, message: `Lead ${d.company} added.` };
}

async function loadLead(leadId: string) {
  const [lead] = await getDb().select().from(schema.leads).where(eq(schema.leads.id, leadId));
  return lead;
}

export async function markLeadContacted(leadId: string): Promise<FormState> {
  const user = await verifyUser();
  const id = z.uuid().safeParse(leadId);
  if (!id.success) return { ok: false, error: "Invalid lead." };
  const lead = await loadLead(id.data);
  if (!lead || !canEditOwned(user, lead.ownerId)) return { ok: false, error: "You can't update this lead." };
  if (lead.status !== "new" && lead.status !== "contacted") return { ok: true };
  // Restarts the SLA window (Contact Today); first contact also moves New → Contacted.
  await getDb().update(schema.leads).set({ status: "contacted", lastContactedAt: new Date() }).where(eq(schema.leads.id, lead.id));
  await audit({ actorId: user.id, action: "update", entity: "lead", entityId: lead.company, changes: lead.status === "new" ? { status: ["new", "contacted"] } : { contacted: "again" } });
  refresh();
  return { ok: true };
}

const Qualify = z.object({
  leadId: z.uuid(),
  dealTitle: z.string().max(160).optional(),
  dealValue: z.string().optional(),
  closeOn: z.iso.date().optional(),
});

/** Lead → Account (+ first contact) and optionally a Deal. Reuses an existing account with the same phone/email. */
export async function qualifyLead(_prev: FormState, fd: FormData): Promise<FormState> {
  const user = await verifyUser();
  const parsed = Qualify.safeParse(formObject(fd));
  if (!parsed.success) return fieldErrors(parsed.error);
  const d = parsed.data;
  const lead = await loadLead(d.leadId);
  if (!lead || !canEditOwned(user, lead.ownerId)) return { ok: false, error: "You can't qualify this lead." };
  if (lead.status === "qualified") return { ok: false, error: "This lead is already qualified." };
  const value = parseRupiah(d.dealValue);
  const ownerId = lead.ownerId ?? user.id;

  const db = getDb();
  const accountId = await db.transaction(async (tx) => {
    const [existing] = lead.phoneE164
      ? await tx.select({ id: schema.customers.id }).from(schema.customers).where(eq(schema.customers.phoneE164, lead.phoneE164)).limit(1)
      : [];
    let customerId = existing?.id;
    if (!customerId) {
      const [c] = await tx
        .insert(schema.customers)
        .values({
          name: lead.company,
          businessType: lead.segment,
          status: "prospect",
          phoneE164: lead.phoneE164,
          email: lead.email,
          city: lead.city,
          ownerId,
          source: lead.source,
          campaignId: lead.campaignId,
          qualificationScore: lead.qualificationScore,
          qualificationTier: lead.qualificationTier,
          qualificationReason: lead.qualificationReason,
        })
        .returning({ id: schema.customers.id });
      customerId = c.id;
      if (lead.picName) {
        await tx.insert(schema.contacts).values({ customerId, name: lead.picName, phoneE164: lead.phoneE164, email: lead.email, isDecisionMaker: false });
      }
    }
    if (d.dealTitle) {
      await tx.insert(schema.opportunities).values({
        customerId,
        ownerId,
        title: d.dealTitle,
        stage: "contacted",
        probability: 20,
        value: value ?? 0,
        expectedCloseOn: d.closeOn,
      });
    }
    await tx.update(schema.leads).set({ status: "qualified", customerId }).where(eq(schema.leads.id, lead.id));
    return customerId;
  });

  await enqueueQualification("account", accountId, "converted-from-lead");
  await audit({ actorId: user.id, action: "qualify", entity: "lead", entityId: lead.company, changes: { account: accountId, deal: d.dealTitle ?? "none" } });
  await notify({
    userIds: await managersOf(ownerId, [user.id]),
    type: "lead.qualified",
    title: `Lead qualified: ${lead.company}`,
    body: d.dealTitle ? `New deal: ${d.dealTitle}${value ? ` · Rp ${value.toLocaleString("en-US")}` : ""}` : `Qualified by ${user.name}`,
    link: `/database/accounts/${accountId}`,
  });
  refresh();
  return { ok: true, message: `${lead.company} is now an account.` };
}

const Disqualify = z.object({ leadId: z.uuid(), reason: z.enum(DISQUALIFY_REASONS, "Choose a reason.") });

export async function disqualifyLead(_prev: FormState, fd: FormData): Promise<FormState> {
  const user = await verifyUser();
  const parsed = Disqualify.safeParse(formObject(fd));
  if (!parsed.success) return fieldErrors(parsed.error);
  const lead = await loadLead(parsed.data.leadId);
  if (!lead || !canEditOwned(user, lead.ownerId)) return { ok: false, error: "You can't update this lead." };
  await getDb()
    .update(schema.leads)
    .set({ status: "disqualified", disqualifyReason: parsed.data.reason })
    .where(and(eq(schema.leads.id, lead.id)));
  await audit({ actorId: user.id, action: "disqualify", entity: "lead", entityId: lead.company, changes: { reason: parsed.data.reason } });
  refresh();
  return { ok: true };
}

const Assign = z.object({ leadId: z.uuid(), ownerId: z.uuid("Choose a sales rep.") });

/** Marketing or a manager hands a lead (e.g. from the aroma journey) to a sales rep. */
export async function assignLead(_prev: FormState, fd: FormData): Promise<FormState> {
  const user = await verifyUser();
  if (!isManager(user) && user.role !== "marketing") return { ok: false, error: "Only Marketing or a Sales Manager can assign leads." };
  const parsed = Assign.safeParse(formObject(fd));
  if (!parsed.success) return fieldErrors(parsed.error);
  const db = getDb();
  const lead = await loadLead(parsed.data.leadId);
  if (!lead) return { ok: false, error: "Lead not found." };
  const [rep] = await db
    .select({ id: schema.users.id, name: schema.users.name })
    .from(schema.users)
    .where(and(eq(schema.users.id, parsed.data.ownerId), eq(schema.users.active, true), inArray(schema.users.role, ["sales", "sales_manager"])));
  if (!rep) return { ok: false, error: "Please check the highlighted fields.", fieldErrors: { ownerId: "Choose an active sales rep." } };
  await db.update(schema.leads).set({ ownerId: rep.id }).where(eq(schema.leads.id, lead.id));
  await audit({ actorId: user.id, action: "assign", entity: "lead", entityId: lead.company, changes: { owner: rep.name } });
  if (rep.id !== user.id) {
    await notify({ userIds: [rep.id], type: "lead.hot", title: `New lead for you: ${lead.company}`, body: lead.note ?? `Assigned by ${user.name}`, link: "/sales/leads" });
  }
  refresh();
  return { ok: true, message: `Assigned to ${rep.name}.` };
}
