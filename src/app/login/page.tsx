import type { Metadata } from "next";
import { Suspense } from "react";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Masuk" };

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-surface p-8 shadow-sm">
        <p className="text-xs font-medium uppercase tracking-[0.2em] text-accent">BOEMI</p>
        <h1 className="mt-2 text-2xl font-semibold">Sales &amp; Marketing Tools</h1>
        <p className="mt-1 text-sm text-muted">Masuk dengan akun kantor kamu.</p>
        <Suspense>
          <LoginForm />
        </Suspense>
      </div>
    </main>
  );
}
