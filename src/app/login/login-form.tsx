"use client";

import { useActionState } from "react";
import { useSearchParams } from "next/navigation";
import { login, type LoginState } from "@/app/actions/auth";

export function LoginForm() {
  const next = useSearchParams().get("next") ?? "";
  const [state, action, pending] = useActionState<LoginState, FormData>(login, {});

  return (
    <form action={action} className="mt-6 space-y-4">
      <input type="hidden" name="next" value={next} />
      <label className="block text-sm">
        <span className="font-medium">Email</span>
        <input
          name="email"
          type="email"
          autoComplete="email"
          required
          className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 outline-none focus:border-primary"
        />
      </label>
      <label className="block text-sm">
        <span className="font-medium">Password</span>
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 outline-none focus:border-primary"
        />
      </label>
      {state.error && (
        <p role="alert" className="text-sm text-hot">
          {state.error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-60"
      >
        {pending ? "Memproses…" : "Masuk"}
      </button>
    </form>
  );
}
