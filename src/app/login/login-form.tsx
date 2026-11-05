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
        <span className="font-semibold">Email</span>
        <input
          name="email"
          type="email"
          autoComplete="email"
          required
          className="input mt-1"
        />
      </label>
      <label className="block text-sm">
        <span className="font-semibold">Password</span>
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="input mt-1"
        />
      </label>
      {state.error && (
        <p role="alert" className="text-sm text-bad">
          {state.error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="btn btn-primary w-full justify-center py-2.5"
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
