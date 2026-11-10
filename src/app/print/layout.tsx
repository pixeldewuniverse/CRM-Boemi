import { Suspense } from "react";

/** Printable documents: no app shell, A4 paper on screen and in print. */
export default function PrintLayout({ children }: LayoutProps<"/print">) {
  return (
    <div className="min-h-dvh py-6 print:p-0">
      <Suspense fallback={<p className="p-8 text-center text-muted">Loading document…</p>}>{children}</Suspense>
    </div>
  );
}
