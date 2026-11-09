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
}: {
  trigger: ReactNode;
  triggerClassName?: string;
  title: string;
  description?: string;
  action: Action;
  submitLabel?: string;
  children: ReactNode;
  wide?: boolean;
}) {
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
      <button type="button" className={triggerClassName} onClick={() => dialog.current?.showModal()}>
        {trigger}
      </button>
      <dialog
        ref={dialog}
        aria-label={title}
        className={`m-auto max-h-[92dvh] ${wide ? "w-[min(94vw,40rem)]" : "w-[min(94vw,30rem)]"} overflow-y-auto rounded-xl border border-line bg-surface p-0 text-fg shadow-panel backdrop:bg-black/40`}
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
            <div className={`grid gap-3 ${wide ? "sm:grid-cols-2" : ""}`}>{children}</div>
            {!state.ok && state.error && (
              <p role="alert" className="rounded-lg bg-bad-soft px-3 py-2 text-[13px] text-bad">
                {state.error}
              </p>
            )}
            <footer className="flex justify-end gap-2">
              <button type="button" className="btn" onClick={() => dialog.current?.close()}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={pending}>
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
