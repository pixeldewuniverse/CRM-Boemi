"use client";

import { saveContent } from "@/app/actions/content";
import { CONTENT_CHANNELS, CONTENT_FORMATS } from "@/lib/content-flow";
import { CheckboxField, FormNote, SelectField, TextArea, TextField, type Option } from "@/components/forms/fields";
import { FormDialog, useFormErrors } from "@/components/forms/form-dialog";

export type BriefOptions = { writers: Option[]; designers: Option[]; campaigns: Option[] };
export type BriefValues = {
  id: string;
  title: string;
  date: string;
  time: string;
  channels: string[];
  format: string | null;
  campaignId: string | null;
  writerId: string | null;
  designerId: string | null;
  objective: string | null;
  keyMessage: string | null;
  guideline: string | null;
  caption: string | null;
  cta: string | null;
  hashtags: string | null;
  products: string | null;
};

function Channels({ value }: { value: string[] }) {
  const error = useFormErrors().fieldErrors?.channels;
  return (
    <fieldset className="flex flex-col gap-1 sm:col-span-2">
      <legend className="text-[13px] font-semibold">
        Channels<span className="text-bad"> *</span>
      </legend>
      <div className="flex flex-wrap gap-1.5">
        {CONTENT_CHANNELS.map((ch) => (
          <label key={ch} className="flex cursor-pointer items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-[13px] has-checked:border-accent has-checked:bg-accent-soft">
            <input type="checkbox" name="channels" value={ch} defaultChecked={value.includes(ch)} className="size-3.5 accent-[var(--accent)]" />
            {ch}
          </label>
        ))}
      </div>
      {error && <p className="text-xs text-bad">{error}</p>}
    </fieldset>
  );
}

function Fields({ v, options, isNew }: { v?: BriefValues; options: BriefOptions; isNew: boolean }) {
  return (
    <>
      {v?.id && <input type="hidden" name="id" value={v.id} />}
      <TextField name="title" label="Title" required wide defaultValue={v?.title} placeholder="e.g. The Senja bath ritual in 3 steps" />
      <TextField name="date" label="Publish date" type="date" required defaultValue={v?.date} />
      <TextField name="time" label="Time (WIB)" type="time" required defaultValue={v?.time ?? "10:00"} />
      <Channels value={v?.channels ?? []} />
      <SelectField name="format" label="Format" required options={CONTENT_FORMATS.map((f) => ({ value: f, label: f }))} defaultValue={v?.format ?? ""} placeholder="Choose…" />
      <SelectField name="campaignId" label="Campaign" options={options.campaigns} defaultValue={v?.campaignId ?? ""} placeholder="None" />
      <SelectField name="writerId" label="Content writer" options={options.writers} defaultValue={v?.writerId ?? ""} placeholder={isNew ? "Me" : "—"} />
      <SelectField name="designerId" label="Designer" options={options.designers} defaultValue={v?.designerId ?? ""} placeholder="Not assigned" />
      <TextField name="objective" label="Objective" wide defaultValue={v?.objective ?? ""} placeholder="Awareness, engagement, leads, sales…" />
      <TextArea name="keyMessage" label="Key message" wide rows={2} defaultValue={v?.keyMessage ?? ""} />
      <TextArea name="guideline" label="Design guideline" wide rows={3} defaultValue={v?.guideline ?? ""} placeholder="Colours, mood, layout, must-have elements, size (e.g. 1080×1350)…" />
      <TextArea name="caption" label="Caption draft" wide rows={3} defaultValue={v?.caption ?? ""} />
      <TextField name="cta" label="CTA" defaultValue={v?.cta ?? ""} placeholder="e.g. Order via WhatsApp" />
      <TextField name="products" label="Products" defaultValue={v?.products ?? ""} />
      <TextField name="hashtags" label="Hashtags" wide defaultValue={v?.hashtags ?? ""} />
      {isNew ? (
        <CheckboxField name="sendToDesign" label="Send to the designer right away" hint="Otherwise it stays a draft brief until you press “Send to design”." />
      ) : (
        <FormNote>The designer is told when the brief or date changes while the post is with design.</FormNote>
      )}
    </>
  );
}

export const NEW_BRIEF_DIALOG = "content-new-brief";

/** "+ Brief" button and the shared dialog that the calendar's day "+" buttons open. */
const EMPTY: BriefValues = { id: "", title: "", date: "", time: "10:00", channels: [], format: null, campaignId: null, writerId: null, designerId: null, objective: null, keyMessage: null, guideline: null, caption: null, cta: null, hashtags: null, products: null };

export function NewBriefButton({ options, today }: { options: BriefOptions; today: string }) {
  return (
    <FormDialog trigger="+ Brief" title="New content brief" description="Plan the post; the designer works from this brief." action={saveContent} submitLabel="Create brief" size="wide" dialogId={NEW_BRIEF_DIALOG}>
      <Fields options={options} isNew v={{ ...EMPTY, date: today }} />
    </FormDialog>
  );
}

/** Opens the New brief dialog with a date filled in (calendar day "+"). */
export function openNewBrief(date: string) {
  const dialog = document.getElementById(NEW_BRIEF_DIALOG) as HTMLDialogElement | null;
  const input = dialog?.querySelector<HTMLInputElement>('input[name="date"]');
  if (input) input.value = date;
  dialog?.showModal();
  dialog?.querySelector<HTMLInputElement>('input[name="title"]')?.focus();
}

export function EditBriefButton({ v, options, onSaved }: { v: BriefValues; options: BriefOptions; onSaved: () => void }) {
  return (
    <FormDialog
      trigger="Edit brief"
      triggerClassName="btn px-2.5 py-1 text-[13px]"
      title={`Edit brief: ${v.title}`}
      action={async (prev, fd) => {
        const r = await saveContent(prev, fd);
        if (r.ok) onSaved();
        return r;
      }}
      size="wide"
    >
      <Fields v={v} options={options} isNew={false} />
    </FormDialog>
  );
}
