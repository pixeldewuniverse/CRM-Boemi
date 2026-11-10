"use client";

import { DndContext, DragOverlay, KeyboardSensor, MouseSensor, TouchSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { useState, type ReactNode } from "react";
import { colorHex, labelsOf } from "@/lib/boards/columns";
import { dayNum, fromDay } from "@/lib/boards/dependency-rules";
import type { CellCtx } from "./cells";
import type { Column, ItemRow } from "./types";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const SHOWN = 3;

/** The day an item sits on: its due date (or start when there is no due date). */
const dayOf = (i: ItemRow) => i.dueOn ?? i.startOn;

function Chip({ item, color, can, late, onOpen }: { item: ItemRow; color: string; can: boolean; late: boolean; onOpen: () => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: item.id, disabled: !can });
  return (
    <button
      ref={setNodeRef}
      type="button"
      {...attributes}
      {...listeners}
      aria-roledescription={can ? "Draggable item" : undefined}
      aria-label={`${item.name}${late ? " (overdue)" : ""}`}
      onClick={onOpen}
      className={`flex w-full min-w-0 items-center gap-1 rounded px-1.5 py-0.5 text-left text-[11px] font-semibold text-white ${can ? "cursor-grab touch-manipulation" : ""} ${isDragging ? "opacity-30" : ""} ${late ? "ring-2 ring-bad ring-offset-1 ring-offset-surface" : ""}`}
      style={{ background: color }}
      title={`${item.name}${item.startOn && item.dueOn && item.startOn !== item.dueOn ? ` (from ${item.startOn})` : ""}`}
    >
      <span className="truncate">
        {item.isMilestone ? "◆ " : ""}
        {item.name}
      </span>
    </button>
  );
}

function Day({ date, muted, today, children }: { date: string; muted: boolean; today: boolean; children: ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: date });
  return (
    <div ref={setNodeRef} role="gridcell" aria-label={date} className={`flex min-h-28 min-w-0 flex-col gap-1 border-b border-r border-line p-1.5 ${muted ? "bg-surface-2/50" : "bg-surface"} ${isOver ? "bg-accent-soft ring-2 ring-inset ring-accent" : ""}`}>
      <span className={`self-end text-xs tabular-nums ${today ? "grid size-6 place-items-center rounded-full bg-accent font-bold text-accent-ink" : muted ? "text-muted" : ""}`}>{Number(date.slice(8))}</span>
      {children}
    </div>
  );
}

/**
 * Calendar: items on their due date by month. Drag an item to another day
 * to move its timeline (start and due shift together, so the length stays).
 * Phones get an agenda list for the month instead of the grid.
 */
export function CalendarView({ items, ctx, statusColumn }: { items: ItemRow[]; ctx: CellCtx; statusColumn: Column | undefined }) {
  const [month, setMonth] = useState(ctx.today.slice(0, 7));
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const [active, setActive] = useState<ItemRow | null>(null);
  const sensors = useSensors(useSensor(MouseSensor, { activationConstraint: { distance: 5 } }), useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 6 } }), useSensor(KeyboardSensor));
  const labels = labelsOf(statusColumn?.settings);
  const colorOf = (i: ItemRow) => colorHex(labels.find((l) => l.key === i.statusKey)?.color);
  const lateOf = (i: ItemRow) => Boolean(i.dueOn && !i.completedAt && i.dueOn < ctx.today);

  const [y, m] = month.split("-").map(Number);
  const first = dayNum(`${month}-01`);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const startDow = (new Date(first * 86_400_000).getUTCDay() + 6) % 7;
  const gridStart = first - startDow;
  const weeks = Math.ceil((startDow + lastDay) / 7);
  const cells = Array.from({ length: weeks * 7 }, (_, k) => fromDay(gridStart + k));

  const byDay = new Map<string, ItemRow[]>();
  for (const i of items) {
    const d = dayOf(i);
    if (d) byDay.set(d, [...(byDay.get(d) ?? []), i]);
  }
  const noDate = items.filter((i) => !dayOf(i)).length;
  const inMonth = items.filter((i) => dayOf(i)?.startsWith(month)).sort((a, b) => dayOf(a)!.localeCompare(dayOf(b)!));
  const shift = (delta: number) => {
    const d = new Date(Date.UTC(y, m - 1 + delta, 1));
    setMonth(d.toISOString().slice(0, 7));
  };

  const onDragEnd = ({ active: a, over }: DragEndEvent) => {
    setActive(null);
    const item = items.find((i) => i.id === a.id);
    const to = typeof over?.id === "string" ? over.id : null;
    const from = item && dayOf(item);
    if (!item || !to || !from || to === from) return;
    const delta = dayNum(to) - dayNum(from);
    const start = item.startOn ? fromDay(dayNum(item.startOn) + delta) : null;
    const due = item.dueOn ? fromDay(dayNum(item.dueOn) + delta) : null;
    ctx.save(item, "timeline", { start, due }, { startOn: start, dueOn: due });
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn px-2.5" aria-label="Previous month" onClick={() => shift(-1)}>
          ‹
        </button>
        <h2 className="min-w-40 text-center text-lg font-bold" aria-live="polite">
          {MONTHS[m - 1]} {y}
        </h2>
        <button type="button" className="btn px-2.5" aria-label="Next month" onClick={() => shift(1)}>
          ›
        </button>
        <button type="button" className="btn" onClick={() => setMonth(ctx.today.slice(0, 7))}>
          Today
        </button>
        <span className="text-[13px] text-muted">
          {inMonth.length} due this month{noDate ? ` · ${noDate} without dates` : ""}
        </span>
        <span className="ml-auto hidden text-xs text-muted lg:inline">Drag an item to another day to move its dates.</span>
      </div>

      {/* Desktop / tablet: month grid */}
      <DndContext sensors={sensors} onDragStart={(e) => setActive(items.find((i) => i.id === e.active.id) ?? null)} onDragEnd={onDragEnd} onDragCancel={() => setActive(null)}>
        <div role="grid" aria-label={`${MONTHS[m - 1]} ${y}`} className="hidden overflow-hidden rounded-xl border-l border-t border-line md:grid md:grid-cols-7">
          {WEEKDAYS.map((w) => (
            <div key={w} role="columnheader" className="border-b border-r border-line bg-surface px-2 py-1.5 text-xs font-semibold text-muted">
              {w}
            </div>
          ))}
          {cells.map((d) => {
            const list = byDay.get(d) ?? [];
            const all = open.has(d);
            return (
              <Day key={d} date={d} muted={!d.startsWith(month)} today={d === ctx.today}>
                {(all ? list : list.slice(0, SHOWN)).map((i) => (
                  <Chip key={i.id} item={i} color={colorOf(i)} can={ctx.editable(i)} late={lateOf(i)} onOpen={() => ctx.openItem(i)} />
                ))}
                {list.length > SHOWN && (
                  <button type="button" className="text-left text-[11px] font-semibold text-accent" onClick={() => setOpen((s) => { const n = new Set(s); if (all) n.delete(d); else n.add(d); return n; })}>
                    {all ? "Show less" : `+${list.length - SHOWN} more`}
                  </button>
                )}
              </Day>
            );
          })}
        </div>
        <DragOverlay dropAnimation={null}>{active ? <div className="w-40 rounded px-1.5 py-0.5 text-[11px] font-semibold text-white shadow-panel" style={{ background: colorOf(active) }}>{active.name}</div> : null}</DragOverlay>
      </DndContext>

      {/* Phone: agenda */}
      <ol className="flex flex-col gap-3 md:hidden">
        {[...new Set(inMonth.map(dayOf))].map((d) => (
          <li key={d}>
            <h3 className={`text-[13px] font-bold ${d === ctx.today ? "text-accent" : ""}`}>{new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" })}</h3>
            <ul className="mt-1 flex flex-col gap-1">
              {inMonth
                .filter((i) => dayOf(i) === d)
                .map((i) => (
                  <li key={i.id}>
                    <button type="button" onClick={() => ctx.openItem(i)} className="flex w-full items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-left text-[13px]">
                      <span className="size-2.5 flex-none rounded-full" style={{ background: colorOf(i) }} />
                      <span className="min-w-0 flex-1 truncate">
                        {i.isMilestone ? "◆ " : ""}
                        {i.name}
                      </span>
                      {lateOf(i) && <span className="text-xs font-semibold text-bad">Overdue</span>}
                    </button>
                  </li>
                ))}
            </ul>
          </li>
        ))}
        {!inMonth.length && <li className="py-6 text-center text-[13px] text-muted">Nothing due this month.</li>}
      </ol>
    </div>
  );
}
