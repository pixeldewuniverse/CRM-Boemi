"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { logout } from "@/app/actions/auth";

/** Avatar button with My profile / Notifications / Sign out. */
export function UserMenu({ avatar, name, role }: { avatar: ReactNode; name: string; role: string }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);
  const item = "block w-full rounded-md px-3 py-2 text-left text-[13px] hover:bg-surface-2";
  return (
    <div ref={box} className="relative">
      <button type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="flex items-center gap-2 rounded-full pr-1 hover:bg-surface-2 sm:pr-2">
        {avatar}
        <span className="hidden text-[13px] sm:inline">{name}</span>
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-50 mt-2 w-56 rounded-xl border border-line bg-surface p-1.5 shadow-panel">
          <p className="px-3 pb-2 pt-1 text-xs text-muted">
            <span className="block font-semibold text-fg">{name}</span>
            {role}
          </p>
          <Link role="menuitem" href="/profile" className={item} onClick={() => setOpen(false)}>
            My profile
          </Link>
          <Link role="menuitem" href="/notifications" className={item} onClick={() => setOpen(false)}>
            Notifications
          </Link>
          <form action={logout}>
            <button role="menuitem" type="submit" className={`${item} text-bad`}>
              Sign out
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
