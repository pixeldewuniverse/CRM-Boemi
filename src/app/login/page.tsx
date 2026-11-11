import type { Metadata } from "next";
import { Suspense } from "react";
import { LoginForm } from "./login-form";
import { Lockup, Logogram } from "@/components/brand/logo";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="panel w-full max-w-sm p-8 shadow-panel">
        <div className="flex flex-col items-center gap-3 text-center">
          <Logogram className="size-14 text-accent" />
          <Lockup className="h-12 w-auto text-accent" title="BOEMI Botanicals" />
          <small className="text-[11px] uppercase tracking-[0.18em] text-muted">Sales &amp; Marketing Tools</small>
        </div>
        <h1 className="mt-7 font-display text-[28px] leading-tight">Sign in</h1>
        <p className="mt-1 text-muted">Use your company account.</p>
        <Suspense>
          <LoginForm />
        </Suspense>
      </div>
    </main>
  );
}
