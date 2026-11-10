import { Suspense } from "react";

export default function ChangePasswordLayout({ children }: LayoutProps<"/change-password">) {
  return (
    <main className="grid min-h-dvh place-items-center px-4 py-10">
      <Suspense fallback={<p className="text-muted">Loading…</p>}>{children}</Suspense>
    </main>
  );
}
