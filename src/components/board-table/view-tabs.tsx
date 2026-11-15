"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { setMyBoardView } from "@/app/actions/boards";
import { BOARD_VIEWS, BOARD_VIEW_LABEL, WIDE_VIEWS, type BoardViewKey } from "@/lib/boards/views";
import { Popover, toast } from "./ui";

/**
 * Board tabs + "Set as my default". Every tab link carries ?view= so an
 * explicit choice always wins over the defaults. When the tab came from a
 * default (not a link) and it's too wide for a phone, open Main Table instead.
 */
export function ViewTabs({
  boardId,
  view,
  source,
  mine,
  boardDefault,
  filters,
}: {
  boardId: string;
  view: BoardViewKey;
  source: "link" | "mine" | "board" | "none";
  mine: BoardViewKey | null;
  boardDefault: BoardViewKey | null;
  filters: Record<string, string>;
}) {
  const router = useRouter();
  const [saved, setSaved] = useState<BoardViewKey | null>(mine);
  const [pending, start] = useTransition();
  const href = (v: BoardViewKey) => ({ pathname: `/projects/${boardId}`, query: { ...filters, view: v } });

  // Opened on a default: write the tab into the URL, so search / sort / group-by keep it and the link can be shared.
  useEffect(() => {
    if (source === "link") return;
    const phone = WIDE_VIEWS.includes(view) && window.matchMedia("(max-width: 767px)").matches;
    const qs = new URLSearchParams(window.location.search);
    qs.set("view", phone ? "table" : view);
    if (phone) router.replace(`/projects/${boardId}?${qs}`);
    else window.history.replaceState(window.history.state, "", `/projects/${boardId}?${qs}`);
  }, [source, view, boardId, router]);

  const save = (v: BoardViewKey | null) =>
    start(async () => {
      const r = await setMyBoardView({ boardId, view: v });
      if (!r.ok) return toast(r.error, "bad");
      setSaved(v);
      toast(v ? `${BOARD_VIEW_LABEL[v]} is now your default for this board.` : `Back to the board's default (${BOARD_VIEW_LABEL[boardDefault ?? "table"]}).`);
    });

  const star = (v: BoardViewKey) => (saved ?? boardDefault ?? "table") === v;
  const defaultControl = (after?: () => void) =>
    saved === view ? (
      <>
        <span className="text-muted">Your default</span>
        <button type="button" className="font-semibold text-accent hover:underline disabled:opacity-60" disabled={pending} onClick={() => { save(null); after?.(); }}>
          Reset
        </button>
      </>
    ) : (
      <button type="button" className="font-semibold text-accent hover:underline disabled:opacity-60" disabled={pending} onClick={() => { save(view); after?.(); }}>
        Set {BOARD_VIEW_LABEL[view]} as my default
      </button>
    );

  return (
    <>
      {/* Phone: one dropdown (six tabs don't fit at 375 px). */}
      <div className="flex items-center gap-2 border-b border-line pb-2 md:hidden">
        <Popover
          label="Board view"
          className=""
          panelClassName="w-60"
          buttonClassName="btn w-auto justify-between gap-2"
          trigger={
            <>
              <span className="text-muted">View:</span>
              <span>
                {BOARD_VIEW_LABEL[view]}
                {star(view) && <span className={saved ? "text-accent" : "text-muted"}> ★</span>}
              </span>
              <span aria-hidden="true">▾</span>
            </>
          }
        >
          {(close) => (
            <div className="flex flex-col">
              <ul className="flex flex-col">
                {BOARD_VIEWS.map((v) => (
                  <li key={v}>
                    <Link
                      href={href(v)}
                      onClick={close}
                      aria-current={view === v ? "page" : undefined}
                      className={`flex items-center gap-2 rounded-lg px-2.5 py-2 ${view === v ? "bg-accent-soft font-semibold text-accent" : "hover:bg-surface-2"}`}
                    >
                      <span className="flex-1">{BOARD_VIEW_LABEL[v]}</span>
                      {star(v) && (
                        <span aria-label={saved ? "(your default)" : "(board default)"} className={saved ? "text-accent" : "text-muted"}>
                          ★
                        </span>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
              <div className="mt-1 flex items-center gap-2 border-t border-line px-2.5 pt-2 text-xs">{defaultControl(close)}</div>
            </div>
          )}
        </Popover>
      </div>

      {/* Tablet / desktop: tabs. */}
      <div className="hidden flex-wrap items-end gap-x-3 gap-y-1 border-b border-line md:flex">
        <nav aria-label="Board views" className="-mb-px flex min-w-0 max-w-full gap-1 overflow-x-auto">
          {BOARD_VIEWS.map((v) => (
            <Link
              key={v}
              href={href(v)}
              aria-current={view === v ? "page" : undefined}
              className={`flex items-center gap-1 whitespace-nowrap border-b-2 px-3 py-2 text-[13px] ${view === v ? "border-accent font-semibold text-accent" : "border-transparent text-muted hover:text-fg"}`}
            >
              {BOARD_VIEW_LABEL[v]}
              {star(v) && (
                <span aria-label={saved ? "(your default)" : "(board default)"} title={saved ? "Your default" : "Board default"} className={saved ? "text-accent" : "text-muted"}>
                  ★
                </span>
              )}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2 pb-1.5 text-xs">{defaultControl()}</div>
      </div>
    </>
  );
}
