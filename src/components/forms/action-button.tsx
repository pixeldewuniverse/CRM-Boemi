"use client";

import { useState, useTransition, type ReactNode } from "react";
import { initialFormState, type FormState } from "@/lib/forms";
import { FormDialog } from "./form-dialog";

type Action = (prev: FormState, fd: FormData) => Promise<FormState>;

const toFormData = (fields: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
};

/** One-click action (no dialog) for reversible changes like status toggles. */
export function ActionButton({
  action,
  fields,
  children,
  className = "btn",
  title,
}: {
  action: Action;
  fields: Record<string, string>;
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        className={className}
        title={title}
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await action(initialFormState, toFormData(fields));
            setError(r.ok === false ? (r.error ?? "Something went wrong.") : null);
          })
        }
      >
        {children}
      </button>
      {error && (
        <span role="alert" className="text-xs text-bad">
          {error}
        </span>
      )}
    </span>
  );
}

/** Destructive action behind a confirmation dialog (no browser confirm()). */
export function ConfirmButton({
  action,
  fields,
  trigger,
  triggerClassName = "btn text-bad",
  title,
  children,
  submitLabel = "Delete",
  danger = true,
}: {
  action: Action;
  fields: Record<string, string>;
  trigger: ReactNode;
  triggerClassName?: string;
  title: string;
  children: ReactNode;
  submitLabel?: string;
  danger?: boolean;
}) {
  return (
    <FormDialog trigger={trigger} triggerClassName={triggerClassName} title={title} action={action} submitLabel={submitLabel} danger={danger}>
      {Object.entries(fields).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <div className="text-[13px] text-muted">{children}</div>
    </FormDialog>
  );
}
