"use client";

import { DndContext, DragOverlay, KeyboardSensor, MouseSensor, TouchSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { useState, useTransition, type ReactNode } from "react";
import { rescheduleContent } from "@/app/actions/content";
import { CONTENT_CHANNELS, type ContentStatus } from "@/lib/content-flow";
import { CONTENT_FLOW, CONTENT_STATUS } from "@/lib/labels";
import { dayNum, fromDay } from "@/lib/boards/dependency-rules";
import { StatusPill } from "@/components/ui/pill";
import { openNewBrief, type BriefOptions } from "./brief-form";
import { ContentPanel } from "./content-panel";

export type Post = {
  id: string;
  title: string;
  date: string;
  time: string;
  status: ContentStatus;
  channels: string[];
  format: string | null;
  writer: string | null;
  designer: string | null;
  keyMessage: string | null;
  myTurn: boolean;
  canMove: boolean;
  files: number;
};
type View = "month" | "week" | "list";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const SHOWN = 3;
/** Left edge colour per status tone (text stays in the normal ink). */
const EDGE: Record<string, string> = { neutral: "border-l-muted bg-surface-2", info: "border-l-info bg-info-soft", accent: "border-l-accent bg-accent-soft", warn: "border-l-warn bg-warn-soft", bad: "border-l-bad bg-bad-soft", ok: "border-l-ok bg-ok-soft" };
const edge = (s: string) => EDGE[CONTENT_STATUS[s]?.tone ?? "neutral"];
const dow = (d: string) => (new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7;
const short = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" });

function Chip({ p, onOpen, big = false }: { p: Post; onOpen: (id: string) => void; big?: boolean }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: p.id, disabled: !p.canMove });
  return (
    <button
      ref={setNodeRef}
      type="button"
      {...attributes}
      {...listeners}
      aria-roledescription={p.canMove ? "Draggable post" : undefined}
      aria-label={`${p.time} ${p.title}, ${CONTENT_STATUS[p.status].label}${p.myTurn ? ", your turn" : ""}`}
      onClick={() => onOpen(p.id)}
      className={`flex w-full min-w-0 flex-col rounded border-l-4 px-1.5 py-0.5 text-left ${edge(p.status)} ${p.canMove ? "cursor-grab touch-manipulation" : ""} ${isDragging ? "opacity-30" : ""} ${p.myTurn ? "ring-2 ring-accent" : ""}`}
      title={`${p.title} — ${CONTENT_STATUS[p.status].label}`}
    >
      <span className="flex min-w-0 items-center gap-1 text-[11px]">
        <span className="flex-none tabular-nums text-muted">{p.time}</span>
        <span className="truncate font-semibold">{p.title}</span>
      </span>
      {big && (
        <span className="mt-0.5 flex flex-col gap-0.5 text-[11px] text-muted">
          <span className="truncate">
            {p.channels.join(" · ")} · {p.format}
          </span>
          <span className="truncate">{CONTENT_STATUS[p.status].label}{p.files ? ` · ${p.files} file${p.files > 1 ? "s" : ""}` : ""}</span>
        </span>
      )}
    </button>
  );
}

function Day({ date, label, muted, today, canCreate, minH, children }: { date: string; label: ReactNode; muted: boolean; today: boolean; canCreate: boolean; minH: string; children: ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: date });
  return (
    <div ref={setNodeRef} role="gridcell" aria-label={date} className={`group flex ${minH} min-w-0 flex-col gap-1 border-b border-r border-line p-1.5 ${muted ? "bg-surface-2/50" : "bg-surface"} ${isOver ? "bg-accent-soft ring-2 ring-inset ring-accent" : ""}`}>
      <div className="flex items-center gap-1">
        {canCreate && (
          <button type="button" aria-label={`New brief on ${date}`} title="New brief" onClick={() => openNewBrief(date)} className="grid size-6 place-items-center rounded-md text-muted opacity-0 hover:bg-accent-soft hover:text-accent focus-visible:opacity-100 group-hover:opacity-100">
            +
          </button>
        )}
        <span className={`ml-auto text-xs tabular-nums ${today ? "grid h-6 min-w-6 place-items-center rounded-full bg-accent px-1.5 font-bold text-accent-ink" : muted ? "text-muted" : ""}`}>{label}</span>
      </div>
      {children}
    </div>
  );
}

/**
 * Content Calendar: month and week grids (drag a post to another day to move
 * its publish date; "+" on a day starts a brief) and the list view. Clicking a
 * post opens its panel: brief, design versions, review and comments.
 */
export function ContentCalendar({
  posts,
  today,
  canCreate,
  options,
  people,
  initialView,
  initialOpen,
}: {
  posts: Post[];
  today: string;
  canCreate: boolean;
  options: BriefOptions;
  people: Record<string, string>;
  initialView: View;
  initialOpen: string | null;
}) {
  const [view, setView] = useState<View>(initialView);
  const [anchor, setAnchor] = useState(today);
  const [status, setStatus] = useState<string>("");
  const [channel, setChannel] = useState<string>("");
  const [mine, setMine] = useState(false);
  const [openId, setOpenId] = useState<string | null>(initialOpen);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [active, setActive] = useState<Post | null>(null);
  const [moved, setMoved] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();
  const sensors = useSensors(useSensor(MouseSensor, { activationConstraint: { distance: 5 } }), useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 6 } }), useSensor(KeyboardSensor));

  const setUrl = (next: { view?: View; open?: string | null }) => {
    try {
      const u = new URL(window.location.href);
      if (next.view) u.searchParams.set("view", next.view);
      if (next.open !== undefined) {
        if (next.open) u.searchParams.set("open", next.open);
        else u.searchParams.delete("open");
      }
      window.history.replaceState(null, "", u);
    } catch {}
  };
  const open = (id: string) => {
    setOpenId(id);
    setUrl({ open: id });
  };
  const changeView = (v: View) => {
    setView(v);
    setUrl({ view: v });
  };

  const shown = posts
    .map((p) => (moved[p.id] ? { ...p, date: moved[p.id] } : p))
    .filter((p) => (!status || p.status === status) && (!channel || p.channels.includes(channel)) && (!mine || p.myTurn));
  const byDay = new Map<string, Post[]>();
  for (const p of shown) byDay.set(p.date, [...(byDay.get(p.date) ?? []), p]);
  const turnCount = posts.filter((p) => p.myTurn).length;

  // Visible range
  const [y, m] = anchor.slice(0, 7).split("-").map(Number);
  let cells: string[];
  let title: string;
  if (view === "week") {
    const start0 = dayNum(anchor) - dow(anchor);
    cells = Array.from({ length: 7 }, (_, k) => fromDay(start0 + k));
    title = `${short(cells[0])} – ${short(cells[6])}`;
  } else {
    const first = dayNum(`${anchor.slice(0, 7)}-01`);
    const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const startDow = dow(`${anchor.slice(0, 7)}-01`);
    const weeks = Math.ceil((startDow + lastDay) / 7);
    cells = Array.from({ length: weeks * 7 }, (_, k) => fromDay(first - startDow + k));
    title = `${MONTHS[m - 1]} ${y}`;
  }
  const shift = (delta: number) => {
    if (view === "week") return setAnchor(fromDay(dayNum(anchor) + delta * 7));
    const d = new Date(Date.UTC(y, m - 1 + delta, 1));
    setAnchor(d.toISOString().slice(0, 10));
  };
  const inRange = shown.filter((p) => p.date >= cells[0] && p.date <= cells[cells.length - 1] && (view === "week" || p.date.startsWith(anchor.slice(0, 7))));

  const onDragEnd = ({ active: a, over }: DragEndEvent) => {
    setActive(null);
    const post = shown.find((p) => p.id === a.id);
    const to = typeof over?.id === "string" ? over.id : null;
    if (!post || !to || to === post.date) return;
    setMoved((s) => ({ ...s, [post.id]: to }));
    start(async () => {
      const r = await rescheduleContent({ id: post.id, date: to });
      if (!r.ok) {
        setError(`Not moved — ${r.error}`);
        setMoved((s) => {
          const n = { ...s };
          delete n[post.id];
          return n;
        });
      } else setError(null);
    });
  };

  const grid = (minH: string, big: boolean) => (
    <DndContext sensors={sensors} onDragStart={(e) => setActive(shown.find((p) => p.id === e.active.id) ?? null)} onDragEnd={onDragEnd} onDragCancel={() => setActive(null)}>
      <div role="grid" aria-label={title} className="hidden overflow-hidden rounded-xl border-l border-t border-line md:grid md:grid-cols-7">
        {WEEKDAYS.map((w, i) => (
          <div key={w} role="columnheader" className="border-b border-r border-line bg-surface px-2 py-1.5 text-xs font-semibold text-muted">
            {w}
            {view === "week" && <span className="ml-1 font-normal">{Number(cells[i].slice(8))}</span>}
          </div>
        ))}
        {cells.map((d) => {
          const list = (byDay.get(d) ?? []).sort((a, b) => a.time.localeCompare(b.time));
          const all = view === "week" || expanded.has(d);
          return (
            <Day key={d} date={d} label={view === "week" ? (d === today ? "Today" : "") : Number(d.slice(8))} muted={view === "month" && !d.startsWith(anchor.slice(0, 7))} today={d === today} canCreate={canCreate} minH={minH}>
              {(all ? list : list.slice(0, SHOWN)).map((p) => (
                <Chip key={p.id} p={p} onOpen={open} big={big} />
              ))}
              {!all && list.length > SHOWN && (
                <button type="button" className="text-left text-[11px] font-semibold text-accent" onClick={() => setExpanded((s) => new Set(s).add(d))}>
                  +{list.length - SHOWN} more
                </button>
              )}
            </Day>
          );
        })}
      </div>
      <DragOverlay dropAnimation={null}>{active ? <div className={`w-40 rounded border-l-4 px-1.5 py-0.5 text-[11px] font-semibold shadow-panel ${edge(active.status)}`}>{active.title}</div> : null}</DragOverlay>
    </DndContext>
  );

  /** Phones (and the List view): posts grouped by day. */
  const agenda = (list: Post[], always: boolean, empty: string) => {
    const days = [...new Set(list.map((p) => p.date))].sort();
    return (
      <ol className={`flex flex-col gap-3 ${always ? "" : "md:hidden"}`}>
        {days.map((d) => (
          <li key={d} className="grid gap-2 sm:grid-cols-[6.5rem_1fr]">
            <h3 className={`text-[13px] font-bold ${d === today ? "text-accent" : d < today ? "text-muted" : ""}`}>
              {short(d)}
              {d === today && " · today"}
            </h3>
            <ul className="flex flex-col gap-1.5">
              {list
                .filter((p) => p.date === d)
                .sort((a, b) => a.time.localeCompare(b.time))
                .map((p) => (
                  <li key={p.id}>
                    <button type="button" onClick={() => open(p.id)} className={`flex w-full flex-col gap-0.5 rounded-lg border border-l-4 border-line px-3 py-2 text-left ${edge(p.status).split(" ")[0]} ${p.myTurn ? "ring-2 ring-accent" : ""}`}>
                      <span className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="tabular-nums text-muted">{p.time}</span>
                        <span className="font-semibold">{p.channels.join(" · ")}</span>
                        <span className="text-muted">{p.format}</span>
                        <span className="ml-auto">
                          <StatusPill map={CONTENT_STATUS} value={p.status} />
                        </span>
                      </span>
                      <span className="font-semibold">{p.title}</span>
                      {p.keyMessage && <span className="line-clamp-2 text-[13px] text-muted">{p.keyMessage}</span>}
                      <span className="text-xs text-muted">
                        Writer {p.writer ?? "—"} · Designer {p.designer ?? "—"}
                        {p.files ? ` · ${p.files} file${p.files > 1 ? "s" : ""}` : ""}
                        {p.myTurn && <span className="ml-1 font-semibold text-accent">· your turn</span>}
                      </span>
                    </button>
                  </li>
                ))}
            </ul>
          </li>
        ))}
        {!days.length && <li className="py-6 text-center text-[13px] text-muted">{empty}</li>}
      </ol>
    );
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div role="tablist" aria-label="View" className="flex rounded-lg border border-line p-0.5">
          {(["month", "week", "list"] as View[]).map((v) => (
            <button key={v} type="button" role="tab" aria-selected={view === v} onClick={() => changeView(v)} className={`rounded-md px-2.5 py-1 text-[13px] capitalize ${view === v ? "bg-accent-soft font-semibold text-accent" : "text-muted"}`}>
              {v}
            </button>
          ))}
        </div>
        {view !== "list" && (
          <div className="flex items-center gap-2">
            <button type="button" className="btn px-2.5" aria-label={view === "week" ? "Previous week" : "Previous month"} onClick={() => shift(-1)}>
              ‹
            </button>
            <h2 className="min-w-0 text-center text-base font-bold sm:min-w-40 sm:text-lg" aria-live="polite">
              {title}
            </h2>
            <button type="button" className="btn px-2.5" aria-label={view === "week" ? "Next week" : "Next month"} onClick={() => shift(1)}>
              ›
            </button>
            <button type="button" className="btn" onClick={() => setAnchor(today)}>
              Today
            </button>
          </div>
        )}
        <div className="flex w-full flex-wrap items-center gap-2 lg:ml-auto lg:w-auto">
          <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} className="input w-auto py-1 text-[13px]">
            <option value="">All statuses</option>
            {CONTENT_FLOW.map((s) => (
              <option key={s} value={s}>
                {CONTENT_STATUS[s].label} ({posts.filter((p) => p.status === s).length})
              </option>
            ))}
          </select>
          <select aria-label="Channel" value={channel} onChange={(e) => setChannel(e.target.value)} className="input w-auto py-1 text-[13px]">
            <option value="">All channels</option>
            {CONTENT_CHANNELS.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          {turnCount > 0 && (
            <label className="flex items-center gap-1.5 text-[13px]">
              <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} className="size-4 accent-[var(--accent)]" />
              My turn ({turnCount})
            </label>
          )}
        </div>
      </div>
      {error && (
        <p role="alert" className="rounded-lg bg-bad-soft px-3 py-2 text-[13px] text-bad">
          {error}
        </p>
      )}

      {view === "month" && grid("min-h-28", false)}
      {view === "week" && grid("min-h-80", true)}
      {view !== "list" && agenda(inRange, false, view === "week" ? "Nothing planned this week." : "Nothing planned this month.")}
      {view !== "list" && <p className="hidden text-xs text-muted md:block">{canCreate ? "Hover a day and press + to start a brief. Drag a post to another day to move it." : "Click a post to see its brief and design."}</p>}
      {view === "list" && agenda(shown, true, "No content matches these filters.")}

      {openId && (
        <ContentPanel
          key={openId}
          id={openId}
          options={options}
          people={people}
          onClose={() => {
            setOpenId(null);
            setUrl({ open: null });
          }}
        />
      )}
    </div>
  );
}
