"use server";

import { count, eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { audit } from "@/lib/audit";
import { verifyUser } from "@/lib/auth";
import { fieldErrors, formObject, parseRupiah, type FormState } from "@/lib/forms";
import { CAMPAIGN_TYPES, EVENT_TYPES } from "@/lib/labels";
import { canManageMarketing } from "@/lib/permissions";

const money = (v: string | undefined) => parseRupiah(v) ?? 0;
const int = z.coerce.number("Enter a number.").int("Whole numbers only.").min(0, "Can't be negative.").max(10_000_000).optional();

async function guard() {
  const user = await verifyUser();
  return canManageMarketing(user) ? user : null;
}
/** Only the fields that changed, as [before, after]. */
function diff<T extends Record<string, unknown>>(before: T, after: Partial<T>, keys: (keyof T & string)[]) {
  const out: Record<string, unknown> = {};
  for (const k of keys) if (k in after && before[k] !== after[k]) out[k] = [before[k], after[k]];
  return out;
}

const DENIED: FormState = { ok: false, error: "Only marketing, sales managers and admins can manage campaigns and events." };

/* ───────────── Campaigns ───────────── */

const Campaign = z.object({
  name: z.string("Name is required.").min(3, "Name is required.").max(160),
  type: z.enum(CAMPAIGN_TYPES, "Choose a type."),
  channel: z.string().max(120).optional(),
  status: z.enum(["scheduled", "running", "done"]).default("scheduled"),
  startsOn: z.iso.date("Pick a date."),
  endsOn: z.iso.date("Pick a date.").optional(),
  budget: z.string().optional(),
  ownerId: z.uuid().optional(),
  resultLeads: int,
  resultRevenue: z.string().optional(),
  notes: z.string().max(2000).optional(),
});

function campaignValues(fd: FormData) {
  const parsed = Campaign.safeParse(formObject(fd));
  if (!parsed.success) return { error: fieldErrors(parsed.error) } as const;
  const d = parsed.data;
  if (d.endsOn && d.endsOn < d.startsOn) return { error: { ok: false, error: "Please check the highlighted fields.", fieldErrors: { endsOn: "Must be after the start date." } } } as const;
  return {
    values: {
      name: d.name,
      type: d.type,
      channel: d.channel ?? null,
      status: d.status,
      startsOn: d.startsOn,
      endsOn: d.endsOn ?? null,
      budget: money(d.budget),
      ownerId: d.ownerId ?? null,
      resultLeads: d.resultLeads ?? 0,
      resultRevenue: money(d.resultRevenue),
      notes: d.notes ?? null,
    },
  } as const;
}

export async function createCampaign(_prev: FormState, fd: FormData): Promise<FormState> {
  const user = await guard();
  if (!user) return DENIED;
  const v = campaignValues(fd);
  if ("error" in v) return v.error as FormState;
  await getDb().insert(schema.campaigns).values({ ...v.values, ownerId: v.values.ownerId ?? user.id });
  await audit({ actorId: user.id, action: "create", entity: "campaign", entityId: v.values.name, changes: { budget: v.values.budget } });
  refresh();
  return { ok: true, message: `${v.values.name} added.` };
}

export async function updateCampaign(_prev: FormState, fd: FormData): Promise<FormState> {
  const user = await guard();
  if (!user) return DENIED;
  const id = z.uuid().safeParse(fd.get("id"));
  if (!id.success) return { ok: false, error: "Invalid campaign." };
  const v = campaignValues(fd);
  if ("error" in v) return v.error as FormState;
  const [before] = await getDb().select().from(schema.campaigns).where(eq(schema.campaigns.id, id.data));
  if (!before) return { ok: false, error: "Campaign not found." };
  await getDb().update(schema.campaigns).set(v.values).where(eq(schema.campaigns.id, id.data));
  await audit({
    actorId: user.id,
    action: "update",
    entity: "campaign",
    entityId: v.values.name,
    changes: diff(before, v.values, ["name", "status", "budget", "startsOn", "endsOn", "ownerId", "resultLeads", "resultRevenue"]),
  });
  refresh();
  return { ok: true, message: "Campaign saved." };
}

/** Linked leads, accounts, content and events keep existing; their campaign link is cleared. */
export async function deleteCampaign(_prev: FormState, fd: FormData): Promise<FormState> {
  const user = await guard();
  if (!user) return DENIED;
  const id = z.uuid().safeParse(fd.get("id"));
  if (!id.success) return { ok: false, error: "Invalid campaign." };
  const db = getDb();
  const [c] = await db.select().from(schema.campaigns).where(eq(schema.campaigns.id, id.data));
  if (!c) return { ok: false, error: "Campaign not found." };
  await db.transaction(async (tx) => {
    await tx.update(schema.customers).set({ campaignId: null }).where(eq(schema.customers.campaignId, c.id));
    await tx.update(schema.leads).set({ campaignId: null }).where(eq(schema.leads.campaignId, c.id));
    await tx.update(schema.events).set({ campaignId: null }).where(eq(schema.events.campaignId, c.id));
    await tx.update(schema.contentItems).set({ campaignId: null }).where(eq(schema.contentItems.campaignId, c.id));
    await tx.delete(schema.campaigns).where(eq(schema.campaigns.id, c.id));
  });
  await audit({ actorId: user.id, action: "delete", entity: "campaign", entityId: c.name });
  refresh();
  return { ok: true, message: `${c.name} deleted.` };
}

/* ───────────── Events ───────────── */

const Event = z.object({
  name: z.string("Name is required.").min(3, "Name is required.").max(160),
  type: z.enum(EVENT_TYPES, "Choose a type."),
  heldOn: z.iso.date("Pick a date."),
  location: z.string().max(200).optional(),
  status: z.enum(["scheduled", "running", "done", "cancelled"]).default("scheduled"),
  campaignId: z.uuid().optional(),
  ownerId: z.uuid().optional(),
  budget: z.string().optional(),
  actualCost: z.string().optional(),
  visitors: int,
  leadsCount: int,
  dealsCount: int,
  revenue: z.string().optional(),
});

function eventValues(fd: FormData) {
  const parsed = Event.safeParse(formObject(fd));
  if (!parsed.success) return { error: fieldErrors(parsed.error) } as const;
  const d = parsed.data;
  return {
    values: {
      name: d.name,
      type: d.type,
      heldOn: d.heldOn,
      location: d.location ?? null,
      status: d.status,
      campaignId: d.campaignId ?? null,
      ownerId: d.ownerId ?? null,
      budget: money(d.budget),
      actualCost: money(d.actualCost),
      visitors: d.visitors ?? 0,
      leadsCount: d.leadsCount ?? 0,
      dealsCount: d.dealsCount ?? 0,
      revenue: money(d.revenue),
    },
  } as const;
}

export async function createEvent(_prev: FormState, fd: FormData): Promise<FormState> {
  const user = await guard();
  if (!user) return DENIED;
  const v = eventValues(fd);
  if ("error" in v) return v.error as FormState;
  await getDb().insert(schema.events).values({ ...v.values, ownerId: v.values.ownerId ?? user.id });
  await audit({ actorId: user.id, action: "create", entity: "event", entityId: v.values.name, changes: { heldOn: v.values.heldOn, budget: v.values.budget } });
  refresh();
  return { ok: true, message: `${v.values.name} added.` };
}

export async function updateEvent(_prev: FormState, fd: FormData): Promise<FormState> {
  const user = await guard();
  if (!user) return DENIED;
  const id = z.uuid().safeParse(fd.get("id"));
  if (!id.success) return { ok: false, error: "Invalid event." };
  const v = eventValues(fd);
  if ("error" in v) return v.error as FormState;
  const [before] = await getDb().select().from(schema.events).where(eq(schema.events.id, id.data));
  if (!before) return { ok: false, error: "Event not found." };
  await getDb().update(schema.events).set(v.values).where(eq(schema.events.id, id.data));
  await audit({
    actorId: user.id,
    action: "update",
    entity: "event",
    entityId: v.values.name,
    changes: diff(before, v.values, ["name", "status", "heldOn", "budget", "actualCost", "visitors", "leadsCount", "dealsCount", "revenue", "campaignId"]),
  });
  refresh();
  return { ok: true, message: "Event saved." };
}

export async function deleteEvent(_prev: FormState, fd: FormData): Promise<FormState> {
  const user = await guard();
  if (!user) return DENIED;
  const id = z.uuid().safeParse(fd.get("id"));
  if (!id.success) return { ok: false, error: "Invalid event." };
  const db = getDb();
  const [e] = await db.select().from(schema.events).where(eq(schema.events.id, id.data));
  if (!e) return { ok: false, error: "Event not found." };
  const [{ n }] = await db.select({ n: count() }).from(schema.eventLeads).where(eq(schema.eventLeads.eventId, e.id));
  if (n > 0) return { ok: false, error: `${n} booth contacts were collected at this event. Mark it cancelled instead.` };
  await db.delete(schema.events).where(eq(schema.events.id, e.id));
  await audit({ actorId: user.id, action: "delete", entity: "event", entityId: e.name });
  refresh();
  return { ok: true, message: `${e.name} deleted.` };
}
