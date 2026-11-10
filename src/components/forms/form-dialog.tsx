"use client";

import { createContext, startTransition, use, useActionState, useRef, useState, type ReactNode } from "react";
import { initialFormState, type FormState } from "@/lib/forms";

const FormCtx = createContext<FormState>(initialFormState);
export const useFormErrors = () => use(FormCtx);

type Action = (prev: FormState, fd: FormData) => Promise<FormState>;

/**
 * Button that opens a modal form. The form posts to a Server Action;
 * on success the dialog closes, the form resets and the page refreshes (the
 * action calls refresh()). On an error the user's input is kept.
 */
export function FormDialog({
  trigger,
  triggerClassName = "btn btn-primary",
  title,
  description,
  action,
  submitLabel = "Save",
  children,
  wide = false,
  size,
  danger = false,
  disabled = false,
  dialogId,
}: {
  trigger: ReactNode;
  triggerClassName?: string;
  title: string;
  description?: string;
  action: Action;
  submitLabel?: string;
  children: ReactNode;
  wide?: boolean;
  /** "xl" fits a line-item editor. Defaults to "wide" when `wide` is set. */
  size?: "md" | "wide" | "xl";
  /** Red submit button (deletes and other destructive actions). */
  danger?: boolean;
  disabled?: boolean;
  /** Lets other buttons open this dialog (e.g. "+" on a calendar day). */
  dialogId?: string;
}) {
  const width = { md: "w-[min(94vw,30rem)]", wide: "w-[min(94vw,40rem)]", xl: "w-[min(96vw,56rem)]" }[size ?? (wide ? "wide" : "md")];
  const twoCols = wide || size === "wide" || size === "xl";
  const dialog = useRef<HTMLDialogElement>(null);
  const [formKey, setFormKey] = useState(0);
  const [state, formAction, pending] = useActionState<FormState, FormData>(async (prev, fd) => {
    const res = await action(prev, fd);
    if (res.ok) {
      dialog.current?.close();
      setFormKey((k) => k + 1);
    }
    return res;
  }, initialFormState);

  return (
    <>
      <button type="button" className={triggerClassName} disabled={disabled} onClick={() => dialog.current?.showModal()}>
        {trigger}
      </button>
      <dialog
        ref={dialog}
        id={dialogId}
        aria-label={title}
        className={`m-auto max-h-[92dvh] ${width} overflow-y-auto rounded-xl border border-line bg-surface p-0 text-fg shadow-panel backdrop:bg-black/40`}
      >
        <FormCtx value={state.ok ? initialFormState : state}>
          <form
            key={formKey}
            // Submit manually so React doesn't clear the fields when the server returns an error.
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              startTransition(() => formAction(fd));
            }}
            className="flex flex-col gap-4 p-5"
            noValidate
          >
            <header>
              <h2 className="text-lg font-bold">{title}</h2>
              {description && <p className="text-[13px] text-muted">{description}</p>}
            </header>
            <div className={`grid gap-3 ${twoCols ? "sm:grid-cols-2" : ""}`}>{children}</div>
            {!state.ok && state.error && (
              <p role="alert" className="rounded-lg bg-bad-soft px-3 py-2 text-[13px] text-bad">
                {state.error}
              </p>
            )}
            <footer className="flex justify-end gap-2">
              <button type="button" className="btn" onClick={() => dialog.current?.close()}>
                Cancel
              </button>
              <button type="submit" className={danger ? "btn border-bad bg-bad text-white hover:border-bad" : "btn btn-primary"} disabled={pending}>
                {pending ? "Saving…" : submitLabel}
              </button>
            </footer>
          </form>
        </FormCtx>
      </dialog>
      {state.ok && state.message && (
        <span role="status" className="sr-only">
          {state.message}
        </span>
      )}
    </>
  );
}

/**
 * Inline (non-modal) form for a Server Action, e.g. a settings section.
 * Shares the error context, so the same field components show errors.
 */
export function InlineForm({
  action,
  submitLabel = "Save",
  children,
  className = "grid gap-3 sm:grid-cols-2",
  resetOnSuccess = false,
}: {
  action: Action;
  submitLabel?: string;
  children: ReactNode;
  className?: string;
  /** Clear the fields after a successful save (e.g. passwords). */
  resetOnSuccess?: boolean;
}) {
  const [formKey, setFormKey] = useState(0);
  const [state, formAction, pending] = useActionState<FormState, FormData>(async (prev, fd) => {
    const res = await action(prev, fd);
    if (res.ok && resetOnSuccess) setFormKey((k) => k + 1);
    return res;
  }, initialFormState);
  return (
    <FormCtx value={state}>
      <form
        key={formKey}
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          startTransition(() => formAction(fd));
        }}
        className="flex flex-col gap-4"
        noValidate
      >
        <div className={className}>{children}</div>
        <footer className="flex flex-wrap items-center justify-end gap-3">
          {!state.ok && state.error && (
            <p role="alert" className="mr-auto text-[13px] text-bad">
              {state.error}
            </p>
          )}
          {state.ok && state.message && (
            <p role="status" className="mr-auto text-[13px] text-ok">
              {state.message}
            </p>
          )}
          <button type="submit" className="btn btn-primary" disabled={pending}>
            {pending ? "Saving…" : submitLabel}
          </button>
        </footer>
      </form>
    </FormCtx>
  );
}
