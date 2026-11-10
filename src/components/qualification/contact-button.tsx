"use client";

import { useState, useTransition } from "react";
import { markLeadContacted } from "@/app/actions/leads";

/** "Contacted" on Contact Today: restarts the lead's SLA window. */
export function MarkContactedButton({ leadId, company, again }: { leadId: string; company: string; again: boolean }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button
        type="button"
        className="btn btn-primary px-2.5 py-1 text-xs"
        disabled={pending}
        aria-label={`Mark ${company} as contacted`}
        onClick={() =>
          start(async () => {
            const r = await markLeadContacted(leadId);
            if (!r.ok) setError(r.error ?? "Failed");
          })
        }
      >
        {pending ? "Saving…" : again ? "Contacted again" : "Contacted"}
      </button>
      {error && (
        <span role="alert" className="text-xs text-bad">
          {error}
        </span>
      )}
    </span>
  );
}
