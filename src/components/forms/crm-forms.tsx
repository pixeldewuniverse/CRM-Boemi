"use client";

/**
 * Create / edit forms for contacts, products, campaigns, events, activities
 * and accounts. Option lists come from the page (already scoped to the user).
 */
import { updateAccount } from "@/app/actions/accounts";
import { deleteActivity, logActivity } from "@/app/actions/activities";
import { createContact, deleteContact, updateContact } from "@/app/actions/contacts";
import { createCampaign, createEvent, deleteCampaign, deleteEvent, updateCampaign, updateEvent } from "@/app/actions/marketing";
import { createProduct, deleteProduct, setProductActive, updateProduct } from "@/app/actions/products";
import { ACTIVITY_LOG_TYPES, CAMPAIGN_STATUS, CAMPAIGN_TYPES, EVENT_STATUS, EVENT_TYPES, LEAD_SOURCES, PRODUCT_UNITS, SEGMENTS } from "@/lib/labels";
import { ActionButton, ConfirmButton } from "./action-button";
import { CheckboxField, FormNote, SelectField, TextArea, TextField, type Option } from "./fields";
import { FormDialog } from "./form-dialog";

const opts = (xs: readonly string[]): Option[] => xs.map((x) => ({ value: x, label: x }));
const fromDefs = (defs: Record<string, { label: string }>): Option[] => Object.entries(defs).map(([value, d]) => ({ value, label: d.label }));
const small = "btn px-2 py-1 text-xs";
const money = (n: number | null | undefined) => (n ? String(n) : "");
/** "now" in Jakarta for datetime-local inputs. */
const jakartaNow = () => new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 16);

/* ───────────── Contacts ───────────── */

export type ContactValues = {
  id: string;
  customerId: string;
  name: string;
  position: string | null;
  phone: string | null;
  email: string | null;
  isDecisionMaker: boolean;
  notes: string | null;
};

function ContactFields({ c }: { c?: ContactValues }) {
  return (
    <>
      <TextField name="name" label="Name" required defaultValue={c?.name} />
      <TextField name="position" label="Position" defaultValue={c?.position ?? ""} placeholder="e.g. Purchasing Manager" />
      <TextField name="phone" label="Phone / WhatsApp" type="tel" inputMode="tel" placeholder="0812…" defaultValue={c?.phone ?? ""} />
      <TextField name="email" label="Email" type="email" inputMode="email" defaultValue={c?.email ?? ""} />
      <CheckboxField name="isDecisionMaker" label="Decision maker" defaultChecked={c?.isDecisionMaker} />
      <TextArea name="notes" label="Notes" wide rows={2} defaultValue={c?.notes ?? ""} placeholder="Best time to call, preferences…" />
    </>
  );
}

export function NewContactButton({ accounts, defaultAccountId, triggerClassName }: { accounts: Option[]; defaultAccountId?: string; triggerClassName?: string }) {
  return (
    <FormDialog trigger="+ Contact" triggerClassName={triggerClassName} title="New contact" description="Phone and email are checked against existing contacts." action={createContact} submitLabel="Add contact" wide>
      {defaultAccountId && accounts.length <= 1 ? (
        <input type="hidden" name="customerId" value={defaultAccountId} />
      ) : (
        <SelectField name="customerId" label="Account" required options={accounts} placeholder="Choose…" defaultValue={defaultAccountId} wide />
      )}
      <ContactFields />
    </FormDialog>
  );
}

export function ContactRowActions({ c }: { c: ContactValues }) {
  return (
    <div className="flex flex-wrap justify-end gap-1.5">
      <FormDialog trigger="Edit" triggerClassName={small} title={`Edit ${c.name}`} action={updateContact} wide>
        <input type="hidden" name="id" value={c.id} />
        <ContactFields c={c} />
      </FormDialog>
      <ConfirmButton action={deleteContact} fields={{ id: c.id }} trigger="Delete" triggerClassName={`${small} text-bad`} title={`Delete ${c.name}?`}>
        The contact is removed from the account. Logged activities keep their notes.
      </ConfirmButton>
    </div>
  );
}

/* ───────────── Products ───────────── */

export type ProductValues = {
  id: string;
  sku: string;
  name: string;
  category: string | null;
  variant: string | null;
  unit: string;
  price: number | null;
  active: boolean;
};

function ProductFields({ p, categories }: { p?: ProductValues; categories: string[] }) {
  return (
    <>
      <TextField name="sku" label="SKU" required defaultValue={p?.sku} placeholder="BOE-LV-250" hint="Unique. Letters, numbers and dashes." />
      <TextField name="name" label="Name" required defaultValue={p?.name} />
      <TextField name="category" label="Category" defaultValue={p?.category ?? ""} placeholder={categories.slice(0, 3).join(", ")} />
      <TextField name="variant" label="Variant / size" defaultValue={p?.variant ?? ""} placeholder="250 ml" />
      <SelectField name="unit" label="Unit" options={opts(PRODUCT_UNITS)} defaultValue={p?.unit ?? "pcs"} />
      <TextField name="price" label="Retail price (Rp)" required inputMode="numeric" defaultValue={money(p?.price)} hint="Excl. PPN. Tier prices are calculated from this." />
      {p && <CheckboxField name="active" label="Active (can be quoted and ordered)" defaultChecked={p.active} />}
    </>
  );
}

export function NewProductButton({ categories }: { categories: string[] }) {
  return (
    <FormDialog trigger="+ Product" title="New product" action={createProduct} submitLabel="Add product" wide>
      <ProductFields categories={categories} />
    </FormDialog>
  );
}

export function ProductRowActions({ p, categories, used }: { p: ProductValues; categories: string[]; used: boolean }) {
  return (
    <div className="flex flex-wrap justify-end gap-1.5">
      <FormDialog trigger="Edit" triggerClassName={small} title={`Edit ${p.name}`} action={updateProduct} wide>
        <input type="hidden" name="id" value={p.id} />
        <ProductFields p={p} categories={categories} />
      </FormDialog>
      <ActionButton action={setProductActive} fields={{ id: p.id, active: String(!p.active) }} className={small}>
        {p.active ? "Deactivate" : "Activate"}
      </ActionButton>
      {!used && (
        <ConfirmButton action={deleteProduct} fields={{ id: p.id }} trigger="Delete" triggerClassName={`${small} text-bad`} title={`Delete ${p.name}?`}>
          This product has never been quoted or ordered, so it can be deleted permanently.
        </ConfirmButton>
      )}
    </div>
  );
}

/* ───────────── Campaigns ───────────── */

export type CampaignValues = {
  id: string;
  name: string;
  type: string | null;
  channel: string | null;
  status: string;
  startsOn: string | null;
  endsOn: string | null;
  budget: number | null;
  ownerId: string | null;
  resultLeads: number;
  resultRevenue: number;
  notes: string | null;
};

function CampaignFields({ c, people }: { c?: CampaignValues; people: Option[] }) {
  return (
    <>
      <TextField name="name" label="Campaign name" required wide defaultValue={c?.name} />
      <SelectField name="type" label="Type" required options={opts(CAMPAIGN_TYPES)} placeholder="Choose…" defaultValue={c?.type ?? undefined} />
      <TextField name="channel" label="Channels" defaultValue={c?.channel ?? ""} placeholder="Instagram, Website" />
      <TextField name="startsOn" label="Starts" type="date" required defaultValue={c?.startsOn ?? ""} />
      <TextField name="endsOn" label="Ends" type="date" defaultValue={c?.endsOn ?? ""} />
      <TextField name="budget" label="Budget (Rp)" inputMode="numeric" defaultValue={money(c?.budget)} />
      <SelectField name="ownerId" label="PIC" options={people} placeholder="Me" defaultValue={c?.ownerId ?? undefined} />
      <SelectField name="status" label="Status" options={fromDefs(CAMPAIGN_STATUS)} defaultValue={c?.status ?? "scheduled"} />
      <span />
      {c && (
        <>
          <TextField name="resultLeads" label="Result: leads" inputMode="numeric" defaultValue={String(c.resultLeads || "")} />
          <TextField name="resultRevenue" label="Result: revenue (Rp)" inputMode="numeric" defaultValue={money(c.resultRevenue)} />
        </>
      )}
      <TextArea name="notes" label="Notes / outcome" wide rows={2} defaultValue={c?.notes ?? ""} />
    </>
  );
}

export function NewCampaignButton({ people }: { people: Option[] }) {
  return (
    <FormDialog trigger="+ Campaign" title="New campaign" description="Leads and accounts can be linked to it from their own forms." action={createCampaign} submitLabel="Add campaign" wide>
      <CampaignFields people={people} />
    </FormDialog>
  );
}

export function CampaignRowActions({ c, people }: { c: CampaignValues; people: Option[] }) {
  return (
    <div className="flex flex-wrap justify-end gap-1.5">
      <FormDialog trigger="Edit" triggerClassName={small} title={`Edit ${c.name}`} action={updateCampaign} wide>
        <input type="hidden" name="id" value={c.id} />
        <CampaignFields c={c} people={people} />
      </FormDialog>
      <ConfirmButton action={deleteCampaign} fields={{ id: c.id }} trigger="Delete" triggerClassName={`${small} text-bad`} title={`Delete ${c.name}?`}>
        Linked leads, accounts, events and content stay — only their link to this campaign is removed.
      </ConfirmButton>
    </div>
  );
}

/* ───────────── Events ───────────── */

export type EventValues = {
  id: string;
  name: string;
  type: string | null;
  heldOn: string;
  location: string | null;
  status: string;
  campaignId: string | null;
  ownerId: string | null;
  budget: number;
  actualCost: number;
  visitors: number;
  leadsCount: number;
  dealsCount: number;
  revenue: number;
};

function EventFields({ e, people, campaigns }: { e?: EventValues; people: Option[]; campaigns: Option[] }) {
  return (
    <>
      <TextField name="name" label="Event name" required wide defaultValue={e?.name} />
      <SelectField name="type" label="Type" required options={opts(EVENT_TYPES)} placeholder="Choose…" defaultValue={e?.type ?? undefined} />
      <TextField name="heldOn" label="Date" type="date" required defaultValue={e?.heldOn ?? ""} />
      <TextField name="location" label="Location" wide defaultValue={e?.location ?? ""} />
      <SelectField name="campaignId" label="Campaign" options={campaigns} placeholder="None" defaultValue={e?.campaignId ?? undefined} />
      <SelectField name="ownerId" label="PIC" options={people} placeholder="Me" defaultValue={e?.ownerId ?? undefined} />
      <SelectField name="status" label="Status" options={fromDefs(EVENT_STATUS)} defaultValue={e?.status ?? "scheduled"} />
      <TextField name="budget" label="Budget (Rp)" inputMode="numeric" defaultValue={money(e?.budget)} />
      {e && (
        <>
          <FormNote>Results</FormNote>
          <TextField name="actualCost" label="Actual cost (Rp)" inputMode="numeric" defaultValue={money(e.actualCost)} />
          <TextField name="visitors" label="Visitors" inputMode="numeric" defaultValue={String(e.visitors || "")} />
          <TextField name="leadsCount" label="Leads" inputMode="numeric" defaultValue={String(e.leadsCount || "")} />
          <TextField name="dealsCount" label="Deals" inputMode="numeric" defaultValue={String(e.dealsCount || "")} />
          <TextField name="revenue" label="Revenue (Rp)" inputMode="numeric" defaultValue={money(e.revenue)} />
        </>
      )}
    </>
  );
}

export function NewEventButton({ people, campaigns }: { people: Option[]; campaigns: Option[] }) {
  return (
    <FormDialog trigger="+ Event" title="New event" action={createEvent} submitLabel="Add event" wide>
      <EventFields people={people} campaigns={campaigns} />
    </FormDialog>
  );
}

export function EventRowActions({ e, people, campaigns }: { e: EventValues; people: Option[]; campaigns: Option[] }) {
  return (
    <div className="flex flex-wrap justify-end gap-1.5">
      <FormDialog trigger="Edit" triggerClassName={small} title={`Edit ${e.name}`} action={updateEvent} wide>
        <input type="hidden" name="id" value={e.id} />
        <EventFields e={e} people={people} campaigns={campaigns} />
      </FormDialog>
      <ConfirmButton action={deleteEvent} fields={{ id: e.id }} trigger="Delete" triggerClassName={`${small} text-bad`} title={`Delete ${e.name}?`}>
        Events with booth contacts can&apos;t be deleted — mark them cancelled instead.
      </ConfirmButton>
    </div>
  );
}

/* ───────────── Activity log ───────────── */

export function LogActivityButton({
  accountId,
  deals = [],
  contacts = [],
  defaultDealId,
  triggerClassName,
  trigger = "+ Log activity",
}: {
  accountId: string;
  deals?: Option[];
  contacts?: Option[];
  defaultDealId?: string;
  triggerClassName?: string;
  trigger?: string;
}) {
  return (
    <FormDialog trigger={trigger} triggerClassName={triggerClassName} title="Log activity" description="Something that already happened. Plan future work as a task." action={logActivity} submitLabel="Log" wide>
      <input type="hidden" name="customerId" value={accountId} />
      <SelectField name="type" label="Type" required options={opts(ACTIVITY_LOG_TYPES)} defaultValue="Call" />
      <TextField name="occurredAt" label="When" type="datetime-local" required defaultValue={jakartaNow()} />
      {deals.length > 0 && <SelectField name="opportunityId" label="Deal" options={deals} placeholder="None" defaultValue={defaultDealId} />}
      {contacts.length > 0 && <SelectField name="contactId" label="With" options={contacts} placeholder="—" />}
      <TextArea name="notes" label="Notes" required wide rows={3} placeholder="What was discussed, outcome, next step…" />
    </FormDialog>
  );
}

export function DeleteActivityButton({ id }: { id: string }) {
  return (
    <ConfirmButton action={deleteActivity} fields={{ id }} trigger="Delete" triggerClassName="text-xs text-muted hover:text-bad" title="Delete this entry?">
      Use this to remove an entry logged by mistake.
    </ConfirmButton>
  );
}

/* ───────────── Account ───────────── */

export type AccountValues = {
  id: string;
  name: string;
  segment: string | null;
  status: string;
  city: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  instagram: string | null;
  source: string | null;
  campaignId: string | null;
  ownerId: string | null;
  consent: boolean;
};

export function EditAccountButton({ a, reps, campaigns }: { a: AccountValues; reps: Option[]; campaigns: Option[] }) {
  return (
    <FormDialog trigger="Edit account" triggerClassName="btn" title={`Edit ${a.name}`} action={updateAccount} wide>
      <input type="hidden" name="id" value={a.id} />
      <TextField name="name" label="Account name" required wide defaultValue={a.name} />
      <SelectField name="segment" label="Segment" required options={opts(SEGMENTS)} defaultValue={a.segment ?? undefined} placeholder="Choose…" hint="Sets the price tier for new quotations." />
      <SelectField
        name="status"
        label="Status"
        options={[
          { value: "prospect", label: "Prospect" },
          { value: "active", label: "Active" },
          { value: "inactive", label: "Inactive" },
        ]}
        defaultValue={a.status === "lead" ? "prospect" : a.status}
      />
      <TextField name="phone" label="Phone / WhatsApp" type="tel" inputMode="tel" defaultValue={a.phone ?? ""} />
      <TextField name="email" label="Email" type="email" inputMode="email" defaultValue={a.email ?? ""} />
      <TextField name="city" label="City" defaultValue={a.city ?? ""} />
      <TextField name="instagram" label="Instagram" defaultValue={a.instagram ?? ""} placeholder="@handle" />
      <TextField name="address" label="Address" wide defaultValue={a.address ?? ""} />
      <SelectField name="source" label="Source" required options={opts(LEAD_SOURCES)} defaultValue={a.source && (LEAD_SOURCES as readonly string[]).includes(a.source) ? a.source : undefined} placeholder="Choose…" />
      <SelectField name="campaignId" label="Campaign" options={campaigns} placeholder="None" defaultValue={a.campaignId ?? undefined} />
      {reps.length > 0 && <SelectField name="ownerId" label="Owner" options={reps} defaultValue={a.ownerId ?? undefined} />}
      <CheckboxField name="consent" label="Agreed to receive offers and updates (marketing consent)" defaultChecked={a.consent} />
    </FormDialog>
  );
}
