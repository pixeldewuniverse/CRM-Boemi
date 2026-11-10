"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, useState, type ReactNode } from "react";
import { Icon } from "@/components/icon";
import { NAV, findNav } from "@/lib/nav";

type Slots = {
  /** Count pill per submenu key, e.g. { tasks: <Suspense>…</Suspense> } */
  itemCounts: Record<string, ReactNode>;
  /** Count pill per menu, shown while the menu is collapsed. */
  categoryCounts: Record<string, ReactNode>;
  sideFooter: ReactNode;
  topRight: ReactNode;
};

/**
 * Layout from the Phase 1 demo: fixed left rail of collapsible menus +
 * work area. Below 860px the rail becomes a drawer opened with ☰.
 *
 * The URL is only known at request time, so the parts that depend on it
 * (active menu, breadcrumb) stream in behind Suspense; their fallbacks
 * render the same markup without the active state.
 */
export function AppShell({ children, ...slots }: Slots & { children: ReactNode }) {
  const [drawer, setDrawer] = useState(false);
  const close = () => setDrawer(false);

  return (
    <div className="min-h-full md:grid md:grid-cols-[240px_1fr]">
      <aside
        aria-label="Main navigation"
        className={`fixed inset-y-0 left-0 z-[60] flex w-[260px] flex-col gap-[18px] overflow-auto border-r border-line bg-surface px-3 py-5 transition-transform duration-200 md:sticky md:top-0 md:z-auto md:h-screen md:w-auto md:translate-x-0 ${
          drawer ? "translate-x-0 shadow-panel" : "-translate-x-[105%]"
        }`}
      >
        <div className="flex items-center gap-2.5 px-2">
          <span className="grid size-[34px] flex-none place-items-center rounded-[9px] bg-accent text-[13px] font-extrabold text-accent-ink">
            B
          </span>
          <div>
            <b className="block text-[15px] font-bold">BOEMI</b>
            <small className="block text-[11px] tracking-[0.04em] text-muted">Sales &amp; Marketing Tools</small>
          </div>
          <button
            type="button"
            onClick={close}
            aria-label="Close menu"
            className="ml-auto rounded-lg p-1.5 text-muted hover:bg-surface-2 md:hidden"
          >
            <Icon name="close" />
          </button>
        </div>

        <Suspense fallback={<SideNavView pathname="" slots={slots} onNavigate={close} />}>
          <SideNav slots={slots} onNavigate={close} />
        </Suspense>

        <div className="mt-auto flex flex-col gap-2 border-t border-line p-2.5 text-xs text-muted">
          {slots.sideFooter}
        </div>
      </aside>

      {drawer && (
        <div
          aria-hidden="true"
          onClick={close}
          className="fixed inset-0 z-[55] bg-[rgba(10,18,12,.4)] md:hidden"
        />
      )}

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-20 flex flex-wrap items-center gap-3 border-b border-line bg-bg/90 px-4 py-2.5 backdrop-blur md:px-6">
          <button type="button" onClick={() => setDrawer(true)} aria-label="Open menu" className="btn md:hidden">
            <Icon name="menu" className="size-4" />
          </button>
          <div className="text-[13px] text-muted">
            <Suspense fallback="Sales & Marketing Tools">
              <Breadcrumb />
            </Suspense>
          </div>
          <div className="flex-1" />
          <span className="hidden whitespace-nowrap rounded-md border border-line px-[7px] py-px text-[11px] text-muted sm:inline">
            Staging · dummy data
          </span>
          {slots.topRight}
        </header>
        <main className="flex w-full max-w-[1680px] flex-col gap-5 px-4 pb-16 pt-6 md:px-6">{children}</main>
      </div>
    </div>
  );
}

/** Detail pages (/database/accounts/:id, /sales/orders/:id…) belong to their list's menu item. */
function matchPath(pathname: string) {
  return findNav(pathname) ?? findNav(pathname.replace(/\/[^/]+$/, ""));
}

function Breadcrumb() {
  const current = matchPath(usePathname());
  if (!current) return <>Sales &amp; Marketing Tools</>;
  return (
    <>
      {current.category.label} <span aria-hidden="true">/</span>{" "}
      <span className="text-fg">{current.item.label}</span>
    </>
  );
}

type NavProps = { slots: Slots; onNavigate: () => void };

function SideNav(props: NavProps) {
  const pathname = usePathname();
  return <SideNavView key={matchPath(pathname)?.category.key ?? "none"} pathname={pathname} {...props} />;
}

function SideNavView({ pathname, slots, onNavigate }: NavProps & { pathname: string }) {
  const current = matchPath(pathname);
  const [open, setOpen] = useState<Set<string>>(() => new Set(current ? [current.category.key] : ["dashboard"]));
  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <nav className="flex flex-col gap-0.5">
      {NAV.map((cat) => {
        const isOpen = open.has(cat.key);
        const isActive = current?.category.key === cat.key;
        return (
          <div key={cat.key}>
            <button
              type="button"
              onClick={() => toggle(cat.key)}
              aria-expanded={isOpen}
              className={`flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-left font-semibold hover:bg-surface-2 ${
                isActive ? "text-accent" : ""
              }`}
            >
              <Icon name={cat.icon} />
              <span className="flex-1">{cat.label}</span>
              {cat.badge && (
                <span className="whitespace-nowrap rounded-full border border-line px-1.5 text-[9.5px] tracking-[0.06em] text-muted">{cat.badge}</span>
              )}
              {!isOpen && slots.categoryCounts[cat.key]}
              <Icon name="chevron" className={`size-3.5 text-muted transition-transform ${isOpen ? "rotate-90" : ""}`} />
            </button>
            <div hidden={!isOpen} className="mb-2 ml-[18px] mt-0.5 flex flex-col gap-px border-l border-line pl-2.5">
              {cat.items.map((item) => {
                const on = current?.item.key === item.key;
                return (
                  <Link
                    key={item.key}
                    href={item.href}
                    aria-current={on ? "page" : undefined}
                    onClick={onNavigate}
                    className={`flex items-center justify-between gap-1.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium ${
                      on ? "bg-accent-soft font-semibold text-accent" : "text-muted hover:bg-surface-2 hover:text-fg"
                    }`}
                  >
                    {item.label}
                    {slots.itemCounts[item.key]}
                  </Link>
                );
              })}
            </div>
          </div>
        );
      })}
    </nav>
  );
}
