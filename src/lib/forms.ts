import type { z } from "zod";

/** Result returned by every form Server Action (used with useActionState). */
export type FormState = {
  ok?: boolean;
  error?: string;
  fieldErrors?: Record<string, string>;
  message?: string;
};

export const initialFormState: FormState = {};

export function fieldErrors(error: z.ZodError): FormState {
  const fe: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "");
    if (key && !fe[key]) fe[key] = issue.message;
  }
  return { ok: false, error: "Please check the highlighted fields.", fieldErrors: fe };
}

/** FormData → plain object of trimmed strings (files and empties dropped). */
export function formObject(fd: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of fd.entries()) {
    if (typeof v === "string" && v.trim() !== "" && !k.startsWith("$ACTION")) out[k] = v.trim();
  }
  return out;
}

/** "Rp 15.000.000" / "15,000,000" / "15000000" → 15000000 */
export function parseRupiah(v: string | undefined): number | undefined {
  if (!v) return undefined;
  const digits = v.replace(/[^\d]/g, "");
  return digits ? Number(digits) : undefined;
}
