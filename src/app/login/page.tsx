import type { Metadata } from "next";
import { Suspense } from "react";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="panel w-full max-w-sm p-8 shadow-panel">
        <div className="flex items-center gap-2.5">
          <span className="grid size-[34px] place-items-center rounded-[9px] bg-accent text-[13px] font-extrabold text-accent-ink">
            B
          </span>
          <div>
            <b className="block text-[15px] font-bold">BOEMI</b>
            <small className="block text-[11px] tracking-[0.04em] text-muted">Sales &amp; Marketing Tools</small>
          </div>
        </div>
        <h1 className="mt-6 text-2xl font-bold tracking-[-0.02em]">Sign in</h1>
        <p className="mt-1 text-muted">Use your company account.</p>
        <Suspense>
          <LoginForm />
        </Suspense>
      </div>
    </main>
  );
}
