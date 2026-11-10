"use client";

import { useState } from "react";
import { deleteCriterion, rescoreAll, saveCriterion } from "@/app/actions/qualification";
import { saveSettings } from "@/app/actions/settings";
import { OPERATORS, RULE_FIELDS } from "@/lib/qualification/fields";
import { ConfirmButton } from "./action-button";
import { CheckboxField, FormNote, SelectField, TextArea, TextField } from "./fields";
import { FormDialog, InlineForm } from "./form-dialog";

export type CriterionValues = { id: string; name: string; kind: "rule" | "ai"; field: string; operator: string; value: unknown; weight: number; description: string | null; active: boolean };

const valueText = (v: unknown) => (v == null ? "" : Array.isArray(v) ? v.join(", ") : String(v));

function Fields({ c }: { c?: CriterionValues }) {
  const [kind, setKind] = useState<"rule" | "ai">(c?.kind ?? "rule");
  return (
    <>
      <TextField name="name" label="Name" required wide defaultValue={c?.name} placeholder="e.g. Target segment" />
      <div className="flex flex-col gap-1 sm:col-span-2">
        <span className="text-[13px] font-semibold">Checked by</span>
        <div className="flex flex-wrap gap-4 text-[13px]">
          <label className="flex items-center gap-2">
            <input type="radio" name="kind" value="rule" checked={kind === "rule"} onChange={() => setKind("rule")} className="accent-[var(--accent)]" />
            Rule (code, on a field)
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="kind" value="ai" checked={kind === "ai"} onChange={() => setKind("ai")} className="accent-[var(--accent)]" />
            AI (reads notes, 0–3 with a quote)
          </label>
        </div>
      </div>
      {kind === "rule" ? (
        <>
          <SelectField name="field" label="Field" required options={[...RULE_FIELDS]} defaultValue={c?.kind === "rule" ? c.field : "segment"} />
          <SelectField name="operator" label="Rule" options={Object.entries(OPERATORS).map(([value, label]) => ({ value, label }))} defaultValue={c?.operator ?? "in"} />
          <TextField name="value" label="Value" wide defaultValue={c?.kind === "rule" ? valueText(c.value) : ""} hint="“is one of”: separate with commas (Hotel & Spa, Corporate Gift). Numbers without dots. true / false for yes/no fields." />
        </>
      ) : (
        <TextArea
          name="description"
          label="What do 0, 1, 2 and 3 mean?"
          required
          wide
          rows={5}
          defaultValue={c?.description ?? ""}
          placeholder={"0 = not mentioned, 1 = vague interest, 2 = clear need, 3 = numbers or a date given.\nKeywords: rooms, volume, per month"}
        />
      )}
      {kind === "rule" && <TextArea name="description" label="Explanation for sales (optional)" wide rows={2} defaultValue={c?.description ?? ""} />}
      <TextField name="weight" label="Weight" inputMode="numeric" required defaultValue={String(c?.weight ?? 10)} hint="Share of the 100-point score." />
      <CheckboxField name="active" label="Active" defaultChecked={c?.active ?? true} wide={false} />
      {kind === "ai" && <FormNote>AI criteria only count when QUALIFICATION_AI=on. A score without an exact quote from the notes is treated as unknown.</FormNote>}
    </>
  );
}

export function NewCriterionButton() {
  return (
    <FormDialog trigger="+ Criterion" title="New qualification criterion" action={saveCriterion} submitLabel="Add criterion" wide>
      <Fields />
    </FormDialog>
  );
}

export function EditCriterionButton({ c }: { c: CriterionValues }) {
  return (
    <span className="flex gap-1.5">
      <FormDialog trigger="Edit" triggerClassName="btn px-2 py-1 text-xs" title={`Edit · ${c.name}`} action={saveCriterion} wide>
        <input type="hidden" name="id" value={c.id} />
        <Fields c={c} />
      </FormDialog>
      <ConfirmButton action={deleteCriterion} fields={{ id: c.id }} trigger="Delete" triggerClassName="btn px-2 py-1 text-xs text-bad" title={`Delete “${c.name}”?`}>
        Past scores keep their copy of this criterion. To pause it instead, untick Active.
      </ConfirmButton>
    </span>
  );
}

export function QualificationSettingsForm({ v }: { v: { hotAt: number; warmAt: number; slaHot: number; slaWarm: number; slaCold: number } }) {
  return (
    <InlineForm action={saveSettings} submitLabel="Save thresholds">
      <input type="hidden" name="key" value="qualification" />
      <TextField name="hotAt" label="Hot from score" inputMode="numeric" defaultValue={String(v.hotAt)} />
      <TextField name="warmAt" label="Warm from score" inputMode="numeric" defaultValue={String(v.warmAt)} hint="Below this: Cold." />
      <TextField name="slaHot" label="Contact Hot within (days)" inputMode="numeric" defaultValue={String(v.slaHot)} />
      <TextField name="slaWarm" label="Contact Warm within (days)" inputMode="numeric" defaultValue={String(v.slaWarm)} />
      <TextField name="slaCold" label="Contact Cold within (days)" inputMode="numeric" defaultValue={String(v.slaCold)} />
    </InlineForm>
  );
}

export function RescoreAllButton() {
  return (
    <ConfirmButton action={rescoreAll} fields={{}} trigger="Re-score all" triggerClassName="btn" title="Re-score every lead and account?" submitLabel="Queue re-score" danger={false}>
      Every open lead and every account goes into the background queue with the current criteria. Scores update over the next minutes; nobody has to wait.
    </ConfirmButton>
  );
}
