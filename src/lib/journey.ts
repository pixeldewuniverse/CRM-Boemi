import "server-only";
import { and, eq, gte, inArray, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { audit } from "@/lib/audit";
import { notify } from "@/lib/notifications";
import { normalizePhone } from "@/lib/phone";

/**
 * Aroma journey (journey.boemibotanicals.com) → CRM leads.
 * Only guests who ticked the marketing box arrive with their details; a guest
 * who withdraws consent arrives as { externalId, marketingConsent: false }.
 */
export const JOURNEY_SOURCE = "aroma-journey";

const PREFERENCE = { body_oil: "Body Oil", multipurpose_spray: "Multipurpose Spray" } as const;

const Scent = z.object({
  id: z.string().max(30),
  name: z.string().max(60),
  tagline: z.string().max(120).nullish(),
  pathway: z.string().max(120).nullish(),
  completedAt: z.iso.datetime({ offset: true }).nullish(),
});

const Consented = z.object({
  externalId: z.uuid(),
  marketingConsent: z.literal(true),
  fullName: z.string().min(1).max(120),
  whatsapp: z.string().max(20).nullish(),
  instagram: z.string().max(30).nullish(),
  email: z.email().max(254).nullish(),
  birthday: z.iso.date().nullish(),
  takeHomePreference: z.enum(["body_oil", "multipurpose_spray"]),
  consentAt: z.iso.datetime({ offset: true }).nullish(),
  policyVersion: z.string().max(20).nullish(),
  registeredAt: z.iso.datetime({ offset: true }).nullish(),
  scent: Scent.nullish(),
});

const Withdrawn = z.object({ externalId: z.uuid(), marketingConsent: z.literal(false) });

export const JourneyPayload = z.union([Consented, Withdrawn]);
export type JourneyPayload = z.infer<typeof JourneyPayload>;

export type JourneyResult = { status: "created" | "updated" | "matched_account" | "consent_withdrawn" | "ignored"; leadId?: string };

const describe = (p: z.infer<typeof Consented>) =>
  [p.scent ? `Aroma: ${p.scent.name}${p.scent.tagline ? ` — ${p.scent.tagline}` : ""}` : "Quiz not finished yet", `Take-home: ${PREFERENCE[p.takeHomePreference]}`].join(" · ");

export async function upsertJourneyLead(payload: JourneyPayload): Promise<JourneyResult> {
  const db = getDb();
  const l = schema.leads;
  const [byRef] = await db
    .select({ id: l.id })
    .from(l)
    .where(and(eq(l.externalSource, JOURNEY_SOURCE), eq(l.externalRef, payload.externalId)))
    .limit(1);

  if (!payload.marketingConsent) {
    if (!byRef) return { status: "ignored" };
    await db.update(l).set({ marketingConsent: false, consentAt: null }).where(eq(l.id, byRef.id));
    await audit({ actorId: null, action: "consent_withdrawn", entity: "lead", entityId: byRef.id });
    return { status: "consent_withdrawn", leadId: byRef.id };
  }

  const p = payload;
  const phone = normalizePhone(p.whatsapp);
  const email = p.email?.toLowerCase() ?? null;
  const journey = {
    scent: p.scent ?? null,
    takeHomePreference: p.takeHomePreference,
    registeredAt: p.registeredAt ?? null,
    policyVersion: p.policyVersion ?? null,
  };
  const consentAt = p.consentAt ? new Date(p.consentAt) : new Date();

  // Already a customer: record the quiz on the account, don't create a lead.
  if (!byRef && (phone || email)) {
    const [acc] = await db
      .select({ id: schema.customers.id, interests: schema.customers.interests })
      .from(schema.customers)
      .where(or(phone ? eq(schema.customers.phoneE164, phone) : undefined, email ? sql`lower(${schema.customers.email}) = ${email}` : undefined))
      .limit(1);
    if (acc) {
      await db
        .update(schema.customers)
        .set({ interests: { ...(acc.interests ?? {}), journey }, marketingConsent: true, consentAt })
        .where(eq(schema.customers.id, acc.id));
      return { status: "matched_account" };
    }
  }

  // Existing lead: by journey id, else a manually added lead with the same phone/email.
  let leadId = byRef?.id;
  if (!leadId && (phone || email)) {
    const [same] = await db
      .select({ id: l.id })
      .from(l)
      .where(and(isNull(l.externalRef), or(phone ? eq(l.phoneE164, phone) : undefined, email ? sql`lower(${l.email}) = ${email}` : undefined)))
      .limit(1);
    leadId = same?.id;
  }

  const fields = {
    picName: p.fullName,
    phoneE164: phone,
    email,
    instagram: p.instagram ?? null,
    birthday: p.birthday ?? null,
    marketingConsent: true,
    consentAt,
    externalSource: JOURNEY_SOURCE,
    externalRef: p.externalId,
  };

  if (leadId) {
    const [cur] = await db.select({ interests: l.interests, note: l.note }).from(l).where(eq(l.id, leadId));
    await db
      .update(l)
      .set({ ...fields, interests: { ...(cur?.interests ?? {}), journey }, note: describe(p) })
      .where(eq(l.id, leadId));
    return { status: "updated", leadId };
  }

  const [row] = await db
    .insert(l)
    .values({
      ...fields,
      company: p.fullName,
      segment: "Online & Event",
      source: "Aroma journey",
      status: "new",
      note: describe(p),
      interests: { journey },
      receivedOn: (p.registeredAt ?? new Date().toISOString()).slice(0, 10),
    })
    .onConflictDoNothing()
    .returning({ id: l.id });
  if (!row) return { status: "updated" }; // a parallel request created it first

  await audit({ actorId: null, action: "create", entity: "lead", entityId: p.fullName, changes: { source: "Aroma journey" } });
  await notifyMarketing(p.fullName, p.scent?.name);
  return { status: "created", leadId: row.id };
}

/**
 * Journey leads can arrive by the hundred during an event, so Marketing gets
 * at most one unread notification per 6 hours, not one per guest.
 */
async function notifyMarketing(name: string, scent: string | undefined) {
  const db = getDb();
  const people = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(and(eq(schema.users.active, true), inArray(schema.users.role, ["marketing"])));
  if (!people.length) return;
  const recent = await db
    .select({ userId: schema.notifications.userId })
    .from(schema.notifications)
    .where(
      and(
        eq(schema.notifications.type, "lead.journey"),
        isNull(schema.notifications.readAt),
        gte(schema.notifications.createdAt, new Date(Date.now() - 6 * 3_600_000)),
      ),
    );
  const skip = new Set(recent.map((r) => r.userId));
  const to = people.map((p) => p.id).filter((id) => !skip.has(id));
  if (!to.length) return;
  await notify({
    userIds: to,
    type: "lead.journey",
    title: "New leads from the aroma journey",
    body: `Latest: ${name}${scent ? ` · ${scent}` : ""}. Open Leads → Aroma journey to assign them.`,
    link: "/sales/leads?source=Aroma+journey",
  });
}
