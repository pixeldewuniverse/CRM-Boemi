"use client";

import { useActionState } from "react";
import { setDealProbability } from "@/app/actions/pipeline";
import { initialFormState } from "@/lib/forms";

/** Inline probability editor for one deal (empty = stage default). */
export function DealProbabilityForm({ dealId, value, override, title }: { dealId: string; value: number; override: boolean; title: string }) {
  const [state, action, pending] = useActionState(setDealProbability, initialFormState);
  return (
    <form action={action} className="flex items-center justify-end gap-1">
      <input type="hidden" name="dealId" value={dealId} />
      <input
        key={`${override}-${value}`}
        name="probability"
        defaultValue={override ? String(value) : ""}
        placeholder={`${value}`}
        inputMode="numeric"
        aria-label={`Probability for ${title}`}
        className={`input w-14 px-2 py-1 text-right tabular-nums ${state.ok === false ? "border-bad" : ""}`}
        title={override ? "Set on this deal — clear it to use the stage default" : "Stage default — type a number to override"}
      />
      <span className="text-xs text-muted">%</span>
      <button className="btn px-2 py-1 text-xs" disabled={pending}>
        {pending ? "…" : "Set"}
      </button>
      <span role="status" className="sr-only">
        {state.ok ? state.message : state.error}
      </span>
      {state.ok === false && <span className="text-xs text-bad">{state.error}</span>}
    </form>
  );
}
