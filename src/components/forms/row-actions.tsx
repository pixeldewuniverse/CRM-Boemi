"use client";

import { useState, useTransition } from "react";
import { disqualifyLead, markLeadContacted, qualifyLead } from "@/app/actions/leads";
import { approveFee, rejectFee } from "@/app/actions/visits";
import { DISQUALIFY_REASONS } from "@/lib/labels";
import { SelectField, TextArea, TextField } from "./fields";
import { FormDialog } from "./form-dialog";

const small = "btn px-2 py-1 text-xs";

export function LeadActions({ leadId, company, status }: { leadId: string; company: string; status: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  if (status === "qualified" || status === "disqualified") return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {status === "new" && (
        <button
          type="button"
          className={small}
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await markLeadContacted(leadId);
              if (!r.ok) setError(r.error ?? "Failed");
            })
          }
        >
          Contacted
        </button>
      )}
      <FormDialog
        trigger="Qualify"
        triggerClassName={`${small} border-ok text-ok`}
        title={`Qualify ${company}`}
        description="Creates the account and its contact. Add a deal if there's a concrete opportunity."
        action={qualifyLead}
        submitLabel="Qualify"
      >
        <input type="hidden" name="leadId" value={leadId} />
        <TextField name="dealTitle" label="Deal title (optional)" defaultValue={`${company} – first order`} />
        <TextField name="dealValue" label="Estimated value (Rp)" inputMode="numeric" placeholder="0" />
        <TextField name="closeOn" label="Expected close" type="date" />
      </FormDialog>
      <FormDialog trigger="Disqualify" triggerClassName={`${small} text-bad`} title={`Disqualify ${company}`} action={disqualifyLead} submitLabel="Disqualify">
        <input type="hidden" name="leadId" value={leadId} />
        <SelectField name="reason" label="Reason" required options={DISQUALIFY_REASONS.map((r) => ({ value: r, label: r }))} placeholder="Choose…" />
      </FormDialog>
      {error && <p className="w-full text-xs text-bad">{error}</p>}
    </div>
  );
}

export function FeeActions({ feeId }: { feeId: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="mt-1.5 flex flex-wrap gap-1.5">
      <button
        type="button"
        className={`${small} border-ok text-ok`}
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await approveFee(feeId);
            if (!r.ok) setError(r.error ?? "Failed");
          })
        }
      >
        {pending ? "…" : "Approve"}
      </button>
      <FormDialog trigger="Reject" triggerClassName={`${small} text-bad`} title="Reject visit fee" action={rejectFee} submitLabel="Reject">
        <input type="hidden" name="feeId" value={feeId} />
        <TextArea name="note" label="Reason (sent to the rep)" required rows={2} />
      </FormDialog>
      {error && <p className="w-full text-xs text-bad">{error}</p>}
    </div>
  );
}
