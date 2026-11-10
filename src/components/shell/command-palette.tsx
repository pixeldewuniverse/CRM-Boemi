"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { globalSearch } from "@/app/actions/search";
import { Icon } from "@/components/icon";
import type { SearchGroup } from "@/lib/queries/search";

/**
 * Global search: header box + Ctrl/Cmd+K. Debounced; answers to older
 * queries are dropped, so fast typing never shows stale results.
 */
export function CommandPalette() {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const seq = useRef(0);
  const [q, setQ] = useState("");
  const [groups, setGroups] = useState<SearchGroup[]>([]);
  const [searched, setSearched] = useState("");
  const [active, setActive] = useState(0);
  const [pending, start] = useTransition();
  const [mac, setMac] = useState(false);

  const open = () => {
    dialog.current?.showModal();
    requestAnimationFrame(() => input.current?.select());
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- platform is only known in the browser
    setMac(/Mac|iPhone|iPad/.test(navigator.platform));
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (dialog.current?.open) dialog.current.close();
        else open();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) return;
    const id = ++seq.current;
    const timer = setTimeout(() => {
      start(async () => {
        const res = await globalSearch(term);
        if (id !== seq.current) return; // a newer query is on its way
        setGroups(res.groups);
        setSearched(term);
        setActive(0);
      });
    }, 250);
    return () => clearTimeout(timer);
  }, [q]);

  const short = q.trim().length < 2;
  const shown = short ? [] : groups;
  const flat = shown.flatMap((g) => g.hits.map((h) => ({ ...h, group: g.type })));
  const go = (href: string) => {
    dialog.current?.close();
    router.push(href);
  };

  return (
    <>
      <button
        type="button"
        onClick={open}
        aria-label="Search"
        aria-keyshortcuts="Control+K Meta+K"
        className="flex items-center gap-2 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[13px] text-muted hover:border-muted md:w-64"
      >
        <Icon name="search" className="size-4" />
        <span className="hidden md:inline">Search…</span>
        <kbd className="ml-auto hidden rounded border border-line px-1.5 text-[11px] md:inline">{mac ? "⌘" : "Ctrl"} K</kbd>
      </button>
      <dialog
        ref={dialog}
        aria-label="Search"
        className="mx-auto mb-auto mt-0 h-dvh max-h-dvh w-full max-w-none rounded-none border-line bg-surface p-0 text-fg shadow-panel backdrop:bg-black/40 sm:mt-[10vh] sm:h-auto sm:max-h-[75vh] sm:w-[min(94vw,40rem)] sm:rounded-xl sm:border"
        onClose={() => setQ("")}
      >
        <div className="flex h-full flex-col">
          <div className="flex items-center gap-2 border-b border-line px-4 py-3">
            <Icon name="search" className="size-4 text-muted" />
            <input
              ref={input}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setActive((a) => Math.min(a + 1, flat.length - 1));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setActive((a) => Math.max(a - 1, 0));
                } else if (e.key === "Enter" && flat[active]) {
                  e.preventDefault();
                  go(flat[active].href);
                }
              }}
              role="combobox"
              aria-expanded={flat.length > 0}
              aria-controls="search-results"
              aria-activedescendant={flat[active] ? `sr-${flat[active].group}-${flat[active].id}` : undefined}
              placeholder="Search accounts, contacts, leads, deals, quotes, orders, products…"
              className="min-w-0 flex-1 bg-transparent text-base outline-none focus-visible:outline-none sm:text-sm"
              autoComplete="off"
              spellCheck={false}
            />
            <button type="button" className="btn px-2 py-1 text-xs" onClick={() => dialog.current?.close()}>
              Esc
            </button>
          </div>
          <div id="search-results" role="listbox" aria-label="Results" className="min-h-0 flex-1 overflow-y-auto p-2">
            {short && <p className="px-3 py-6 text-center text-[13px] text-muted">Type at least 2 characters. Phone numbers work too.</p>}
            {!short && pending && shown.length === 0 && <p className="px-3 py-6 text-center text-[13px] text-muted">Searching…</p>}
            {!short && !pending && searched && shown.length === 0 && <p className="px-3 py-6 text-center text-[13px] text-muted">No results for “{searched}”.</p>}
            {shown.map((g) => (
              <section key={g.type} className="mb-2">
                <h3 className="flex items-baseline justify-between px-3 pb-1 pt-2 text-xs font-semibold text-muted">
                  {g.label}
                  {g.total > g.hits.length && g.href && (
                    <button type="button" className="font-normal text-accent hover:underline" onClick={() => go(g.href)}>
                      All {g.total}
                    </button>
                  )}
                </h3>
                <ul>
                  {g.hits.map((h) => {
                    const idx = flat.findIndex((f) => f.group === g.type && f.id === h.id);
                    return (
                      <li key={h.id} id={`sr-${g.type}-${h.id}`} role="option" aria-selected={idx === active}>
                        <button
                          type="button"
                          onMouseEnter={() => setActive(idx)}
                          onClick={() => go(h.href)}
                          className={`block w-full rounded-lg px-3 py-2 text-left ${idx === active ? "bg-accent-soft" : "hover:bg-surface-2"}`}
                        >
                          <span className="block truncate text-[13px] font-semibold">{h.title}</span>
                          {h.subtitle && <span className="block truncate text-xs text-muted">{h.subtitle}</span>}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
          <footer className="hidden border-t border-line px-4 py-2 text-[11px] text-muted sm:block">↑ ↓ to move · Enter to open · Esc to close · Results respect what your role can see</footer>
        </div>
      </dialog>
    </>
  );
}
