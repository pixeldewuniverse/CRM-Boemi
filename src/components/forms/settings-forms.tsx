"use client";

import { saveSettings } from "@/app/actions/settings";
import { SelectField, TextArea, TextField } from "./fields";
import { InlineForm } from "./form-dialog";

type Numbering = { prefix: string; format: string; seqDigits: number; reset: string };

const RESET = [
  { value: "month", label: "Every month" },
  { value: "year", label: "Every year" },
  { value: "never", label: "Never" },
];

function NumberingFields({ v }: { v: Numbering }) {
  return (
    <>
      <TextField name="prefix" label="Prefix" required defaultValue={v.prefix} />
      <TextField name="format" label="Format" required defaultValue={v.format} hint="Tokens: {PREFIX} {YYYY} {YY} {MM} {SEQ}" />
      <TextField name="seqDigits" label="Counter digits" inputMode="numeric" defaultValue={String(v.seqDigits)} />
      <SelectField name="reset" label="Counter restarts" options={RESET} defaultValue={v.reset} />
    </>
  );
}

export function CompanySettingsForm({ v }: { v: { name: string; address: string; phone: string; email: string; taxId: string; bank: string } }) {
  return (
    <InlineForm action={saveSettings}>
      <input type="hidden" name="key" value="company" />
      <TextField name="name" label="Company name" required defaultValue={v.name} />
      <TextField name="taxId" label="NPWP" defaultValue={v.taxId} />
      <TextField name="phone" label="Phone" defaultValue={v.phone} />
      <TextField name="email" label="Email" defaultValue={v.email} />
      <TextArea name="address" label="Address" wide rows={2} defaultValue={v.address} />
      <TextArea name="bank" label="Bank details (printed on quotations)" wide rows={2} defaultValue={v.bank} placeholder="Bank, account number, account name" />
    </InlineForm>
  );
}

export function QuotationSettingsForm({ v }: { v: Numbering & { validDays: number; salesDiscountLimit: number; terms: string } }) {
  return (
    <InlineForm action={saveSettings}>
      <input type="hidden" name="key" value="quotation" />
      <NumberingFields v={v} />
      <TextField name="validDays" label="Valid for (days)" inputMode="numeric" defaultValue={String(v.validDays)} />
      <TextField name="salesDiscountLimit" label="Max discount without approval (%)" inputMode="decimal" defaultValue={String(v.salesDiscountLimit)} hint="Higher discounts by sales reps need a sales manager's approval." />
      <TextArea name="terms" label="Default terms & conditions" wide rows={4} defaultValue={v.terms} />
    </InlineForm>
  );
}

export function OrderSettingsForm({ v }: { v: Numbering & { defaultDepositPct: number; terms: string } }) {
  return (
    <InlineForm action={saveSettings}>
      <input type="hidden" name="key" value="order" />
      <NumberingFields v={v} />
      <TextField name="defaultDepositPct" label="Default deposit (%)" inputMode="numeric" defaultValue={String(v.defaultDepositPct)} />
      <span />
      <TextArea name="terms" label="Default terms" wide rows={3} defaultValue={v.terms} />
    </InlineForm>
  );
}
