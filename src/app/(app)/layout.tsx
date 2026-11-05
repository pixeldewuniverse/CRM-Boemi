import Link from "next/link";
import { Suspense } from "react";
import { logout } from "@/app/actions/auth";
import { getCurrentUser } from "@/lib/auth";
import { UnreadBadge } from "@/components/unread-badge";

const NAV = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/customers", label: "Customers" },
  { href: "/notifications", label: "Notifikasi" },
] as const;

/** Static shell (nav) renders instantly; the user menu streams in. */
export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="border-b border-border bg-surface md:w-60 md:shrink-0 md:border-b-0 md:border-r">
        <div className="px-5 py-4">
          <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-accent">BOEMI</p>
          <p className="font-semibold">Sales &amp; Marketing</p>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-col">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="flex items-center justify-between whitespace-nowrap rounded-lg px-3 py-2 text-sm hover:bg-background"
            >
              {item.label}
              {item.href === "/notifications" && (
                <Suspense fallback={null}>
                  <UnreadBadge />
                </Suspense>
              )}
            </Link>
          ))}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-end gap-3 border-b border-border px-4 py-3 md:px-8">
          <Suspense fallback={<span className="h-5 w-32 animate-pulse rounded bg-border" />}>
            <UserMenu />
          </Suspense>
        </header>
        <main className="flex-1 px-4 py-6 md:px-8">{children}</main>
      </div>
    </div>
  );
}

async function UserMenu() {
  const user = await getCurrentUser();
  return (
    <div className="flex items-center gap-3 text-sm">
      <span>
        {user.name} <span className="text-muted">· {user.role.replace("_", " ")}</span>
      </span>
      <form action={logout}>
        <button type="submit" className="rounded-lg border border-border px-3 py-1.5 hover:bg-surface">
          Keluar
        </button>
      </form>
    </div>
  );
}
