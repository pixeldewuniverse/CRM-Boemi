"use client";

import { useActionState } from "react";
import { moveContent } from "@/app/actions/content";
import type { ContentStep } from "@/lib/content-flow";
import { initialFormState } from "@/lib/forms";
import { TextArea } from "./fields";
import { FormDialog } from "./form-dialog";

function StepButton({ contentId, step }: { contentId: string; step: ContentStep }) {
  const [state, action, pending] = useActionState(moveContent, initialFormState);
  return (
    <form action={action} className="contents">
      <input type="hidden" name="contentId" value={contentId} />
      <input type="hidden" name="to" value={step.to} />
      <button type="submit" disabled={pending} className={`btn px-2 py-1 text-xs ${step.to === "approved" ? "border-ok text-ok" : "btn-primary"}`}>
        {pending ? "…" : step.label}
      </button>
      {state.error && <span className="text-xs text-bad">{state.error}</span>}
    </form>
  );
}

/** The next workflow steps the signed-in user is allowed to take. */
export function ContentActions({ contentId, title, steps }: { contentId: string; title: string; steps: ContentStep[] }) {
  if (!steps.length) return null;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      {steps.map((step) =>
        step.needsNote ? (
          <FormDialog
            key={step.to}
            trigger={step.label}
            triggerClassName="btn px-2 py-1 text-xs text-bad"
            title={`${step.label}: ${title}`}
            action={moveContent}
            submitLabel="Send to designer"
          >
            <input type="hidden" name="contentId" value={contentId} />
            <input type="hidden" name="to" value={step.to} />
            <TextArea name="note" label="What should change?" required rows={3} />
          </FormDialog>
        ) : (
          <StepButton key={step.to} contentId={contentId} step={step} />
        ),
      )}
    </div>
  );
}
