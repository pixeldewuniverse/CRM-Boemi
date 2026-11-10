"use client";

import { useId, type ReactNode } from "react";
import { useFormErrors } from "./form-dialog";

type Base = { name: string; label: string; required?: boolean; hint?: ReactNode; wide?: boolean };

function Wrap({ id, label, required, hint, error, wide, children }: Base & { id: string; error?: string; children: ReactNode }) {
  return (
    <div className={`flex min-w-0 flex-col gap-1 ${wide ? "sm:col-span-2" : ""}`}>
      <label htmlFor={id} className="text-[13px] font-semibold">
        {label}
        {required && <span className="text-bad"> *</span>}
      </label>
      {children}
      {error ? (
        <p id={`${id}-err`} className="text-xs text-bad">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

export function TextField(
  props: Base & {
    type?: string;
    defaultValue?: string;
    placeholder?: string;
    inputMode?: "numeric" | "decimal" | "tel" | "email" | "text";
    autoComplete?: string;
    min?: string;
    max?: string;
    step?: string;
  },
) {
  const id = useId();
  const error = useFormErrors().fieldErrors?.[props.name];
  return (
    <Wrap {...props} id={id} error={error}>
      <input
        id={id}
        name={props.name}
        type={props.type ?? "text"}
        defaultValue={props.defaultValue}
        placeholder={props.placeholder}
        inputMode={props.inputMode}
        autoComplete={props.autoComplete ?? "off"}
        min={props.min}
        max={props.max}
        step={props.step}
        required={props.required}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-err` : undefined}
        className={`input ${error ? "border-bad" : ""}`}
      />
    </Wrap>
  );
}

export function TextArea(props: Base & { defaultValue?: string; placeholder?: string; rows?: number }) {
  const id = useId();
  const error = useFormErrors().fieldErrors?.[props.name];
  return (
    <Wrap {...props} id={id} error={error}>
      <textarea
        id={id}
        name={props.name}
        rows={props.rows ?? 3}
        defaultValue={props.defaultValue}
        placeholder={props.placeholder}
        required={props.required}
        aria-invalid={Boolean(error)}
        className={`input ${error ? "border-bad" : ""}`}
      />
    </Wrap>
  );
}

export type Option = { value: string; label: string };

export function SelectField(props: Base & { options: Option[]; defaultValue?: string; placeholder?: string }) {
  const id = useId();
  const error = useFormErrors().fieldErrors?.[props.name];
  return (
    <Wrap {...props} id={id} error={error}>
      <select
        id={id}
        name={props.name}
        defaultValue={props.defaultValue ?? ""}
        required={props.required}
        aria-invalid={Boolean(error)}
        className={`input ${error ? "border-bad" : ""}`}
      >
        {props.placeholder !== undefined && <option value="">{props.placeholder}</option>}
        {props.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Wrap>
  );
}

export function CheckboxField({ name, label, defaultChecked, hint, wide = true }: { name: string; label: string; defaultChecked?: boolean; hint?: ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? "sm:col-span-2" : ""}>
      <label className="flex items-center gap-2 text-[13px]">
        <input type="checkbox" name={name} defaultChecked={defaultChecked} className="size-4 accent-[var(--accent)]" />
        {label}
      </label>
      {hint && <p className="ml-6 text-xs text-muted">{hint}</p>}
    </div>
  );
}

/** Explanatory text inside a FormDialog grid. */
export function FormNote({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "bad" | "warn" }) {
  const cls = { muted: "text-muted", bad: "text-bad", warn: "text-warn" }[tone];
  return <p className={`text-[13px] sm:col-span-2 ${cls}`}>{children}</p>;
}
