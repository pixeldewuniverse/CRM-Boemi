"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { colorHex, type Label } from "@/lib/boards/columns";
import type { Person } from "./types";

/**
 * Small popover. The panel is position:fixed (placed from the trigger's
 * rectangle) so it is never clipped by the table's scroll container; it
 * closes on outside click, Esc and page scroll.
 */
export function Popover({
  trigger,
  children,
  className = "h-full",
  panelClassName = "w-64",
  disabled = false,
  label,
  align = "left",
  buttonClassName = "flex h-full w-full min-w-0 items-center justify-center px-1.5 text-left disabled:cursor-default",
}: {
  trigger: ReactNode;
  children: (close: () => void) => ReactNode;
  className?: string;
  panelClassName?: string;
  disabled?: boolean;
  label: string;
  align?: "left" | "right";
  buttonClassName?: string;
}) {
  const [pos, setPos] = useState<CSSProperties | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const open = pos !== null;
  const place = useCallback(() => {
    if (!btn.current) return;
    const r = btn.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const below = vh - r.bottom;
    const style: CSSProperties = { maxHeight: Math.max(160, Math.min(420, (below > 260 ? below : r.top) - 12)) };
    if (below > 260 || below >= r.top) style.top = r.bottom + 4;
    else style.bottom = vh - r.top + 4;
    if (align === "right") style.right = Math.max(8, vw - r.right);
    else style.left = Math.max(8, Math.min(r.left, vw - 8 - 256));
    setPos(style);
  }, [align]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => !box.current?.contains(e.target as Node) && setPos(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setPos(null);
      btn.current?.focus();
    };
    // Follow the trigger when the page or the table scrolls (also when the mobile keyboard opens).
    const onMove = (e: Event) => !(e.target instanceof Node && box.current?.contains(e.target)) && place();
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [open, place]);
  const toggle = () => (open ? setPos(null) : place());
  return (
    <div ref={box} className={className}>
      <button ref={btn} type="button" aria-label={label} aria-haspopup="dialog" aria-expanded={open} disabled={disabled} onClick={toggle} className={buttonClassName}>
        {trigger}
      </button>
      {open && (
        <div role="dialog" aria-label={label} style={pos} className={`fixed z-[70] max-w-[calc(100vw-16px)] overflow-y-auto rounded-xl border border-line bg-surface p-2 text-[13px] text-fg shadow-panel ${panelClassName}`}>
          {children(() => setPos(null))}
        </div>
      )}
    </div>
  );
}

export function LabelChip({ label, className = "" }: { label: Label | undefined; className?: string }) {
  if (!label) return <span className={`text-muted ${className}`}>—</span>;
  return (
    <span className={`inline-flex min-w-0 items-center justify-center truncate rounded px-2 py-0.5 text-xs font-semibold text-white ${className}`} style={{ background: colorHex(label.color) }}>
      {label.label}
    </span>
  );
}

export function Faces({ ids, people, max = 3, size = 24 }: { ids: string[]; people: Person[]; max?: number; size?: number }) {
  const list = ids.map((id) => people.find((p) => p.id === id)).filter((p): p is Person => Boolean(p));
  if (!list.length) return <span className="text-muted">—</span>;
  return (
    <span className="flex items-center -space-x-1.5" title={list.map((p) => p.name).join(", ")}>
      {list.slice(0, max).map((p) =>
        p.avatarKey ? (
          // eslint-disable-next-line @next/next/no-img-element -- private file
          <img key={p.id} src={`/api/files/${p.avatarKey}`} alt={p.name} width={size} height={size} className="rounded-full border-2 border-surface object-cover" style={{ width: size, height: size }} />
        ) : (
          <span key={p.id} aria-label={p.name} className="grid place-items-center rounded-full border-2 border-surface bg-accent-soft font-bold text-accent" style={{ width: size, height: size, fontSize: size * 0.38 }}>
            {p.name
              .split(" ")
              .map((w) => w[0])
              .slice(0, 2)
              .join("")
              .toUpperCase()}
          </span>
        ),
      )}
      {list.length > max && <span className="pl-2 text-xs text-muted">+{list.length - max}</span>}
    </span>
  );
}

export const shortDate = (d: string | null | undefined) => (d ? new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { timeZone: "UTC", day: "numeric", month: "short" }) : "");
export const rangeLabel = (a: string | null, b: string | null) => (a && b ? (a === b ? shortDate(a) : `${shortDate(a)} – ${shortDate(b)}`) : a ? `From ${shortDate(a)}` : b ? `Due ${shortDate(b)}` : "");

/* ───────────── Toasts (module store, so they survive a board remount after refresh) ───────────── */

type Toast = { id: number; text: string; tone: "ok" | "bad" | "warn" };
let toasts: Toast[] = [];
let seq = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function toast(text: string, tone: Toast["tone"] = "ok") {
  const id = ++seq;
  toasts = [...toasts.slice(-3), { id, text, tone }];
  emit();
  setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== id);
    emit();
  }, tone === "ok" ? 3500 : 7000);
}

export function Toaster() {
  const list = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => toasts,
    () => EMPTY,
  );
  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-4 bottom-20 z-[60] flex flex-col items-center gap-2 sm:inset-x-auto sm:right-4 sm:items-end">
      {list.map((t) => (
        <p
          key={t.id}
          role={t.tone === "ok" ? "status" : "alert"}
          className={`pointer-events-auto max-w-sm rounded-lg px-3 py-2 text-[13px] font-semibold shadow-panel ${t.tone === "ok" ? "bg-fg text-bg" : t.tone === "warn" ? "bg-warn text-bg" : "bg-bad text-bg"}`}
        >
          {t.text}
        </p>
      ))}
    </div>
  );
}
const EMPTY: Toast[] = [];
