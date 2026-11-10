"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { colorHex, groupHex, labelsOf } from "@/lib/boards/columns";
import { DEP_TYPE_LABEL, dayNum, dependencyHolds, fromDay, type DepType } from "@/lib/boards/dependency-rules";
import type { CellCtx } from "./cells";
import { Faces, rangeLabel, toast } from "./ui";
import type { Column, GroupData, ItemRow } from "./types";

type Zoom = "day" | "week" | "month";
const PX: Record<Zoom, number> = { day: 34, week: 14, month: 4.5 };
const PAD: Record<Zoom, number> = { day: 4, week: 10, month: 25 };
const ROW = 36;
const HEAD = 48;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dow = (n: number) => new Date(n * 86_400_000).getUTCDay();

type Drag = { id: string; kind: "move" | "start" | "end"; x0: number; s0: number; d0: number; dx: number };
type Row = { kind: "group"; group: GroupData } | { kind: "item"; item: ItemRow; group: GroupData };

/** Span of an item in day numbers (one-date items are one day long). */
function span(i: ItemRow): [number, number] | null {
  const s = i.startOn ?? i.dueOn;
  const d = i.dueOn ?? i.startOn;
  return s && d ? [dayNum(s), dayNum(d)] : null;
}

/**
 * Timeline (Gantt) — plain CSS + SVG, no chart library.
 * Bars: drag to move, drag an edge to change start/end, ←/→ to move a day
 * (Shift = change the end). Arrows show dependencies; broken ones are red.
 * Strict boards refuse breaking moves on the server.
 */
export function TimelineView({ groups, ctx, statusColumn, mode, canEditBoard }: { groups: GroupData[]; ctx: CellCtx; statusColumn: Column | undefined; mode: "strict" | "flexible" | "none"; canEditBoard: boolean }) {
  const [zoom, setZoom] = useState<Zoom>("week");
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set(groups.filter((g) => g.collapsed).map((g) => g.id)));
  const [drag, setDrag] = useState<Drag | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const labels = labelsOf(statusColumn?.settings);
  const px = PX[zoom];
  const today = dayNum(ctx.today);

  const all = groups.flatMap((g) => g.items);
  const byId = new Map(all.map((i) => [i.id, i]));
  /** Dates while dragging. */
  const live = (i: ItemRow): [number, number] | null => {
    const sp = span(i);
    if (!sp || !drag || drag.id !== i.id) return sp;
    if (drag.kind === "move") return [drag.s0 + drag.dx, drag.d0 + drag.dx];
    if (drag.kind === "start") return [Math.min(drag.s0 + drag.dx, drag.d0), drag.d0];
    return [drag.s0, Math.max(drag.d0 + drag.dx, drag.s0)];
  };

  const spans = all.map(span).filter((x): x is [number, number] => Boolean(x));
  let min = Math.min(today, ...spans.map((s) => s[0])) - PAD[zoom];
  const max = Math.max(today, ...spans.map((s) => s[1])) + PAD[zoom] * 2;
  if (zoom !== "day") min -= (dow(min) + 6) % 7; // start on a Monday
  const days = max - min + 1;
  const width = days * px;
  const x = (n: number) => (n - min) * px;

  const rows: Row[] = [];
  for (const g of groups) {
    rows.push({ kind: "group", group: g });
    if (!collapsed.has(g.id)) for (const i of g.items) rows.push({ kind: "item", item: i, group: g });
  }
  const rowOf = new Map<string, number>();
  rows.forEach((r, n) => r.kind === "item" && rowOf.set(r.item.id, n));
  const height = rows.length * ROW;

  /* ── dependency arrows ── */
  type Arrow = { key: string; d: string; bad: boolean; title: string };
  const arrows: Arrow[] = [];
  let broken = 0;
  for (const succ of all) {
    for (const p of succ.predecessors) {
      const pred = byId.get(p.id);
      if (!pred) continue;
      const ps = live(pred);
      const ss = live(succ);
      const ok = ps && ss ? dependencyHolds(p.type as DepType, p.lagDays, { start: fromDay(ps[0]), due: fromDay(ps[1]) }, { start: fromDay(ss[0]), due: fromDay(ss[1]) }) : null;
      if (ok === false) broken++;
      const pr = rowOf.get(pred.id);
      const sr = rowOf.get(succ.id);
      if (!ps || !ss || pr === undefined || sr === undefined) continue;
      const fromEnd = p.type === "FS" || p.type === "FF";
      const toEnd = p.type === "FF" || p.type === "SF";
      const x1 = fromEnd ? x(ps[1] + 1) : x(ps[0]);
      const x2 = toEnd ? x(ss[1] + 1) : x(ss[0]);
      const y1 = pr * ROW + ROW / 2;
      const y2 = sr * ROW + ROW / 2;
      const out = fromEnd ? x1 + 8 : x1 - 8;
      const into = toEnd ? x2 + 8 : x2 - 8;
      const midY = y1 + (y2 > y1 ? ROW / 2 : -ROW / 2);
      const d = `M${x1},${y1} H${out} V${midY} H${into} V${y2} H${x2}`;
      arrows.push({ key: `${p.id}-${succ.id}`, d, bad: ok === false && mode !== "none", title: `${pred.name} → ${succ.name} (${DEP_TYPE_LABEL[p.type as DepType]}${p.lagDays ? `, ${p.lagDays > 0 ? "+" : ""}${p.lagDays}d` : ""})` });
    }
  }

  /* ── header ticks ── */
  const months: { left: number; w: number; label: string }[] = [];
  const ticks: { left: number; label: string; weekend?: boolean; today?: boolean }[] = [];
  for (let n = min; n <= max; n++) {
    const dt = new Date(n * 86_400_000);
    if (n === min || dt.getUTCDate() === 1) months.push({ left: x(n), w: 0, label: `${MONTHS[dt.getUTCMonth()]} ${dt.getUTCFullYear()}` });
    if (zoom === "day") ticks.push({ left: x(n), label: String(dt.getUTCDate()), weekend: dow(n) === 0 || dow(n) === 6, today: n === today });
    else if (zoom === "week" && dow(n) === 1) ticks.push({ left: x(n), label: String(dt.getUTCDate()) });
  }
  months.forEach((m, k) => (m.w = (months[k + 1]?.left ?? width) - m.left));

  /* ── saving ── */
  const commit = (i: ItemRow, s: number, d: number) => {
    const start = fromDay(s);
    const due = fromDay(d);
    if (start === (i.startOn ?? i.dueOn) && due === (i.dueOn ?? i.startOn)) return;
    if (mode === "flexible") {
      const warn = [...i.predecessors.map((p) => [byId.get(p.id), p, true] as const), ...all.flatMap((o) => o.predecessors.filter((p) => p.id === i.id).map((p) => [o, p, false] as const))].find(([o, p, isPred]) => {
        const os = o && span(o);
        if (!os) return false;
        const other = { start: fromDay(os[0]), due: fromDay(os[1]) };
        const me = { start, due };
        return dependencyHolds(p.type as DepType, p.lagDays, isPred ? other : me, isPred ? me : other) === false;
      });
      if (warn?.[0]) toast(`Saved — but it now clashes with “${warn[0].name}” (${warn[1].type}).`, "warn");
    }
    ctx.save(i, "timeline", { start, due }, { startOn: start, dueOn: due });
  };

  const down = (e: PointerEvent, i: ItemRow, kind: Drag["kind"]) => {
    const sp = span(i);
    if (!sp || !ctx.editable(i) || e.button !== 0) return;
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDrag({ id: i.id, kind, x0: e.clientX, s0: sp[0], d0: sp[1], dx: 0 });
  };
  const moveDrag = (e: PointerEvent) => drag && setDrag({ ...drag, dx: Math.round((e.clientX - drag.x0) / px) });
  const up = (i: ItemRow) => {
    if (!drag) return;
    const d = drag;
    setDrag(null);
    if (d.dx === 0) {
      if (d.kind === "move") ctx.openItem(i);
      return;
    }
    const sp = live(i);
    if (sp) commit(i, sp[0], sp[1]);
  };
  const keys = (e: KeyboardEvent, i: ItemRow) => {
    const sp = span(i);
    if (!sp || !ctx.editable(i) || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
    e.preventDefault();
    const k = e.key === "ArrowLeft" ? -1 : 1;
    if (e.shiftKey) commit(i, sp[0], Math.max(sp[0], sp[1] + k));
    else commit(i, sp[0] + k, sp[1] + k);
  };

  // Open (and re-zoom) with today a little in from the left edge.
  const todayX = x(today);
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = Math.max(0, todayX - el.clientWidth / 4);
  }, [zoom]); // eslint-disable-line react-hooks/exhaustive-deps -- only on mount / zoom change

  const unscheduled = all.filter((i) => !span(i)).length;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 text-[13px]">
        <div role="group" aria-label="Zoom" className="flex overflow-hidden rounded-lg border border-line">
          {(["day", "week", "month"] as const).map((z) => (
            <button key={z} type="button" aria-pressed={zoom === z} onClick={() => setZoom(z)} className={`px-3 py-1.5 font-semibold capitalize ${zoom === z ? "bg-accent text-accent-ink" : "bg-surface text-muted hover:text-fg"}`}>
              {z}s
            </button>
          ))}
        </div>
        <span className="text-muted">
          Dependencies: <strong className="text-fg">{mode === "strict" ? "strict" : mode === "flexible" ? "flexible" : "off"}</strong>
        </span>
        {broken > 0 && mode !== "none" && (
          <span role="status" className="pill bg-bad-soft text-bad">
            {broken} dependenc{broken === 1 ? "y" : "ies"} out of order
          </span>
        )}
        {unscheduled > 0 && <span className="text-muted">· {unscheduled} without dates (open them to plan)</span>}
        {canEditBoard && <span className="ml-auto hidden text-xs text-muted lg:inline">Drag a bar to move it, its edges to resize. Keyboard: ←/→ moves a day, Shift+←/→ changes the end.</span>}
      </div>

      <div ref={scroller} className="relative overflow-x-auto rounded-xl border border-line bg-surface">
        <div className="grid min-w-max" style={{ gridTemplateColumns: `minmax(9.5rem, 15rem) ${width}px` }}>
          {/* header */}
          <div className="sticky left-0 z-20 border-b border-r border-line bg-surface px-3 text-xs font-semibold leading-[48px] text-muted" style={{ height: HEAD }}>
            Item
          </div>
          <div className="relative border-b border-line" style={{ height: HEAD }}>
            {months.map((m) => (
              <span key={m.left} className="absolute top-0 truncate border-l border-line px-1.5 text-xs font-semibold leading-6" style={{ left: m.left, width: m.w }}>
                {m.label}
              </span>
            ))}
            {ticks.map((t) => (
              <span key={t.left} className={`absolute bottom-0 text-center text-[11px] leading-6 tabular-nums ${t.today ? "font-bold text-accent" : t.weekend ? "text-muted/60" : "text-muted"}`} style={{ left: t.left, width: zoom === "day" ? px : px * 7 }}>
                {t.label}
              </span>
            ))}
          </div>

          {/* rows: labels */}
          <div className="sticky left-0 z-10 border-r border-line bg-surface">
            {rows.map((r) =>
              r.kind === "group" ? (
                <button
                  key={r.group.id}
                  type="button"
                  aria-expanded={!collapsed.has(r.group.id)}
                  onClick={() => setCollapsed((c) => { const n = new Set(c); if (n.has(r.group.id)) n.delete(r.group.id); else n.add(r.group.id); return n; })}
                  className="flex w-full items-center gap-1.5 border-b border-line px-2 text-left text-[13px] font-bold"
                  style={{ height: ROW, color: groupHex(r.group.color) }}
                >
                  <span className="w-4">{collapsed.has(r.group.id) ? "▸" : "▾"}</span>
                  <span className="truncate">{r.group.name}</span>
                  <span className="ml-auto text-xs font-normal text-muted">{r.group.items.length}</span>
                </button>
              ) : (
                <div key={r.item.id} className="flex items-center gap-2 border-b border-l-4 border-b-line px-2" style={{ height: ROW, borderLeftColor: groupHex(r.group.color) }}>
                  <button type="button" onClick={() => ctx.openItem(r.item)} className="min-w-0 flex-1 truncate text-left text-[13px] hover:text-accent" title={r.item.name}>
                    {r.item.name}
                  </button>
                  <span className="hidden sm:block">
                    <Faces ids={r.item.assignees} people={ctx.people} size={20} max={2} />
                  </span>
                </div>
              ),
            )}
          </div>

          {/* rows: chart */}
          <div className="relative" style={{ height }} onPointerMove={moveDrag}>
            {zoom !== "month" &&
              Array.from({ length: days }, (_, k) => min + k)
                .filter((n) => dow(n) === 0 || dow(n) === 6)
                .map((n) => <span key={n} aria-hidden className="absolute inset-y-0 bg-surface-2/70" style={{ left: x(n), width: px }} />)}
            {rows.map((r, n) => (
              <span key={r.kind === "group" ? r.group.id : r.item.id} aria-hidden className={`absolute inset-x-0 border-b border-line ${r.kind === "group" ? "bg-surface-2/40" : ""}`} style={{ top: n * ROW, height: ROW }} />
            ))}
            <span aria-hidden className="absolute inset-y-0 z-[1] w-0.5 bg-accent" style={{ left: x(today) + px / 2 - 1 }} title="Today" />

            <svg className="pointer-events-none absolute inset-0 z-[2]" width={width} height={height} aria-hidden>
              <defs>
                <marker id="tl-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
                  <path d="M0,0 L8,4 L0,8 z" fill="var(--muted)" />
                </marker>
                <marker id="tl-arrow-bad" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
                  <path d="M0,0 L8,4 L0,8 z" fill="var(--bad)" />
                </marker>
              </defs>
              {arrows.map((a) => (
                <path key={a.key} d={a.d} fill="none" stroke={a.bad ? "var(--bad)" : "var(--muted)"} strokeWidth={a.bad ? 1.75 : 1.25} strokeDasharray={a.bad ? "4 3" : undefined} markerEnd={`url(#${a.bad ? "tl-arrow-bad" : "tl-arrow"})`}>
                  <title>{a.title}</title>
                </path>
              ))}
            </svg>

            {rows.map((r, n) => {
              if (r.kind !== "item") return null;
              const i = r.item;
              const sp = live(i);
              if (!sp) return null;
              const can = ctx.editable(i);
              const label = labels.find((l) => l.key === i.statusKey);
              const color = colorHex(label?.color);
              const top = n * ROW + 7;
              const name = `${i.name}: ${rangeLabel(fromDay(sp[0]), fromDay(sp[1]))}`;
              if (i.isMilestone) {
                return (
                  <button
                    key={i.id}
                    type="button"
                    aria-label={`Milestone ${name}`}
                    title={name}
                    className={`absolute z-[3] size-[18px] rotate-45 rounded-[3px] border-2 border-surface ${can ? "cursor-grab touch-none" : ""}`}
                    style={{ left: x(sp[1]) + px / 2 - 9, top: top + 2, background: color }}
                    onPointerDown={(e) => down(e, i, "move")}
                    onPointerUp={() => up(i)}
                    onKeyDown={(e) => keys(e, i)}
                    onClick={(e) => (e.detail === 0 || !can) && ctx.openItem(i)}
                  />
                );
              }
              const w = (sp[1] - sp[0] + 1) * px;
              return (
                <div key={i.id} className="group/bar absolute z-[3]" style={{ left: x(sp[0]), width: Math.max(w, 6), top, height: ROW - 14 }}>
                  <button
                    type="button"
                    aria-label={name}
                    title={`${name}${label ? ` · ${label.label}` : ""}`}
                    className={`flex h-full w-full items-center overflow-hidden rounded-md px-2 text-left text-[11px] font-semibold text-white shadow-sm ${can ? "cursor-grab touch-none active:cursor-grabbing" : ""} ${drag?.id === i.id ? "ring-2 ring-accent ring-offset-1" : ""}`}
                    style={{ background: color }}
                    onPointerDown={(e) => down(e, i, "move")}
                    onPointerUp={() => up(i)}
                    onKeyDown={(e) => keys(e, i)}
                    onClick={(e) => (e.detail === 0 || !can) && ctx.openItem(i)}
                  >
                    <span className="truncate">{w > 60 ? i.name : ""}</span>
                  </button>
                  {can &&
                    (["start", "end"] as const).map((k) => (
                      <span
                        key={k}
                        aria-hidden
                        className={`absolute inset-y-0 w-2 cursor-ew-resize touch-none rounded opacity-0 group-hover/bar:opacity-100 ${k === "start" ? "-left-1" : "-right-1"} bg-fg/40`}
                        onPointerDown={(e) => down(e, i, k)}
                        onPointerUp={() => up(i)}
                      />
                    ))}
                  {w <= 60 && <span className="pointer-events-none absolute left-full top-0 ml-1.5 whitespace-nowrap text-[11px] leading-[22px] text-muted">{i.name}</span>}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
