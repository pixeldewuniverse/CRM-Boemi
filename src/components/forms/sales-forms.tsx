"use client";

/**
 * "+ New" buttons with their forms. Server actions are passed straight in;
 * option lists come from the page (already scoped to the signed-in user).
 */
import { createAccount } from "@/app/actions/accounts";
import { createLead } from "@/app/actions/leads";
import { createDeal } from "@/app/actions/pipeline";
import { createTask } from "@/app/actions/tasks";
import { checkInVisit } from "@/app/actions/visits";
import { ACTIVITY_TYPES, LEAD_SOURCES, SEGMENTS, STAGE, STAGES, VISIT_PURPOSES } from "@/lib/labels";
import { SelectField, TextArea, TextField, type Option } from "./fields";
import { FormDialog } from "./form-dialog";
import { GeoPhotoFields } from "./geo-photo";

const opts = (xs: readonly string[]): Option[] => xs.map((x) => ({ value: x, label: x }));
const today = () => new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);

function OwnerField({ reps, label = "Owner" }: { reps: Option[]; label?: string }) {
  if (!reps.length) return null;
  return <SelectField name="ownerId" label={label} options={reps} placeholder="Me" />;
}

export function NewLeadButton({ reps, campaigns }: { reps: Option[]; campaigns: Option[] }) {
  return (
    <FormDialog trigger="+ Lead" title="New lead" description="Phone or email is used to catch duplicates." action={createLead} submitLabel="Add lead" wide>
      <TextField name="company" label="Company / name" required wide />
      <TextField name="picName" label="Contact person" />
      <TextField name="phone" label="Phone / WhatsApp" type="tel" inputMode="tel" placeholder="0812…" />
      <TextField name="email" label="Email" type="email" inputMode="email" />
      <TextField name="city" label="City" />
      <SelectField name="segment" label="Segment" required options={opts(SEGMENTS)} placeholder="Choose…" />
      <SelectField name="source" label="Source" required options={opts(LEAD_SOURCES)} placeholder="Choose…" />
      {campaigns.length > 0 && <SelectField name="campaignId" label="Campaign" options={campaigns} placeholder="None" />}
      <OwnerField reps={reps} />
      <TextArea name="note" label="What do they need?" wide rows={2} />
    </FormDialog>
  );
}

export function CheckInButton({ accounts, defaultAccountId }: { accounts: Option[]; defaultAccountId?: string }) {
  return (
    <FormDialog
      trigger="+ Check-in"
      title="Visit check-in"
      description="Saves your GPS location and a photo. A visit fee goes to Finance for approval."
      action={checkInVisit}
      submitLabel="Check in"
      wide
    >
      <SelectField name="accountId" label="Account" required options={accounts} placeholder="Choose…" defaultValue={defaultAccountId} wide />
      <SelectField name="purpose" label="Purpose" options={opts(VISIT_PURPOSES)} defaultValue="Account visit" />
      <TextField name="fee" label="Visit fee (Rp)" inputMode="numeric" placeholder="0" hint="Transport & parking. Leave empty if none." />
      <TextArea name="notes" label="Visit notes" required wide rows={3} placeholder="Who you met, what was discussed, next step…" />
      <GeoPhotoFields />
    </FormDialog>
  );
}

export function NewTaskButton({
  accounts,
  reps,
  defaultAccountId,
  triggerClassName,
  dialogId,
}: {
  accounts: Option[];
  reps: Option[];
  defaultAccountId?: string;
  triggerClassName?: string;
  dialogId?: string;
}) {
  return (
    <FormDialog trigger="+ Task" triggerClassName={triggerClassName} title="New task / follow-up" action={createTask} submitLabel="Add task" wide dialogId={dialogId}>
      <TextField name="title" label="What needs to be done?" required wide />
      <SelectField name="type" label="Type" options={opts(ACTIVITY_TYPES)} defaultValue="Follow-up" />
      <SelectField name="accountId" label="Account" options={accounts} placeholder="None" defaultValue={defaultAccountId} />
      <TextField name="dueDate" label="Due date" type="date" required defaultValue={today()} />
      <TextField name="dueTime" label="Due time" type="time" defaultValue="17:00" />
      <OwnerField reps={reps.map((r) => ({ ...r }))} label="Assign to" />
      <TextArea name="description" label="Details" wide rows={2} />
    </FormDialog>
  );
}

export function NewDealButton({ accounts, reps, defaultAccountId, triggerClassName }: { accounts: Option[]; reps: Option[]; defaultAccountId?: string; triggerClassName?: string }) {
  return (
    <FormDialog trigger="+ Deal" triggerClassName={triggerClassName} title="New deal" action={createDeal} submitLabel="Add deal" wide>
      <SelectField name="accountId" label="Account" required options={accounts} placeholder="Choose…" defaultValue={defaultAccountId} wide />
      <TextField name="title" label="Deal title" required wide placeholder="e.g. Amenities Q1 – 80 rooms" />
      <TextField name="value" label="Estimated value (Rp)" inputMode="numeric" placeholder="0" />
      <TextField name="closeOn" label="Expected close" type="date" />
      <SelectField
        name="stage"
        label="Stage"
        defaultValue="new"
        options={STAGES.filter((s) => s !== "lost").map((s) => ({ value: s, label: STAGE[s].label }))}
      />
      <OwnerField reps={reps} />
    </FormDialog>
  );
}

export function NewAccountButton({ reps }: { reps: Option[] }) {
  return (
    <FormDialog trigger="+ Account" title="New account" description="Phone or email is used to catch duplicates." action={createAccount} submitLabel="Add account" wide>
      <TextField name="name" label="Account name" required wide />
      <SelectField name="segment" label="Segment" required options={opts(SEGMENTS)} placeholder="Choose…" />
      <SelectField name="source" label="Source" required options={opts(LEAD_SOURCES)} placeholder="Choose…" />
      <TextField name="city" label="City" />
      <TextField name="phone" label="Phone / WhatsApp" type="tel" inputMode="tel" />
      <TextField name="email" label="Email" type="email" inputMode="email" />
      <TextField name="contactName" label="Main contact" />
      <TextField name="contactPosition" label="Position" />
      <OwnerField reps={reps} />
      <label className="flex items-center gap-2 text-[13px] sm:col-span-2">
        <input type="checkbox" name="consent" className="size-4 accent-[var(--accent)]" />
        Agreed to receive offers and updates (marketing consent)
      </label>
    </FormDialog>
  );
}
