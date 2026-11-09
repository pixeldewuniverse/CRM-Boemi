"use client";

import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  pointerWithin,
  rectIntersection,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type KeyboardCoordinateGetter,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { useState, type ReactNode } from "react";

export type KanbanCard = { id: string; column: string; movable: boolean; title: string };
export type KanbanColumn = { key: string; label: string; meta?: ReactNode };

/** Pointer first (precise), falling back to overlap for keyboard moves. */
const collision: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  return hits.length ? hits : rectIntersection(args);
};

/** Arrow keys jump a whole column (left/right) instead of a few pixels. */
const columnJump: KeyboardCoordinateGetter = (event, { context }) => {
  const { collisionRect, droppableRects, droppableContainers } = context;
  if (!collisionRect) return undefined;
  const dir = event.code === "ArrowRight" ? 1 : event.code === "ArrowLeft" ? -1 : 0;
  if (!dir) return undefined;
  event.preventDefault();
  const center = collisionRect.left + collisionRect.width / 2;
  const columns = droppableContainers
    .getEnabled()
    .map((c) => droppableRects.get(c.id))
    .filter((r): r is NonNullable<typeof r> => Boolean(r))
    .sort((a, b) => a.left - b.left);
  const next = dir > 0 ? columns.find((r) => r.left > center) : [...columns].reverse().find((r) => r.left + r.width < center);
  if (!next) return undefined;
  return { x: next.left + (next.width - collisionRect.width) / 2, y: Math.max(next.top + 40, collisionRect.top) };
};

/**
 * Drag-and-drop board (mouse, touch long-press and keyboard: focus a card,
 * Space to pick up, left/right arrows to change column, Space to drop, Esc to cancel).
 * Persisting the move is up to `onDrop`.
 */
export function Kanban<T extends KanbanCard>({
  columns,
  cards,
  renderCard,
  onDrop,
  minWidth,
  emptyText = "Nothing here",
}: {
  columns: KanbanColumn[];
  cards: T[];
  renderCard: (card: T) => ReactNode;
  onDrop: (card: T, toColumn: string) => void;
  minWidth: number;
  emptyText?: string;
}) {
  const [active, setActive] = useState<T | null>(null);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: columnJump }),
  );
  const label = (key: string | number | undefined) => columns.find((c) => c.key === key)?.label ?? "";
  const title = (id: string | number) => cards.find((c) => c.id === id)?.title ?? "card";

  const onDragStart = (e: DragStartEvent) => setActive(cards.find((c) => c.id === e.active.id) ?? null);
  const onDragEnd = (e: DragEndEvent) => {
    setActive(null);
    const card = cards.find((c) => c.id === e.active.id);
    const to = e.over?.id;
    if (card && typeof to === "string" && to !== card.column) onDrop(card, to);
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collision}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => setActive(null)}
      accessibility={{
        screenReaderInstructions: {
          draggable: "To move this card, press Space. Use the left and right arrow keys to choose a column, Space again to drop, or Escape to cancel.",
        },
        announcements: {
          onDragStart: ({ active }) => `Picked up ${title(active.id)}.`,
          onDragOver: ({ active, over }) => (over ? `${title(active.id)} is over ${label(over.id)}.` : `${title(active.id)} is not over a column.`),
          onDragEnd: ({ active, over }) => (over ? `${title(active.id)} moved to ${label(over.id)}.` : `${title(active.id)} dropped.`),
          onDragCancel: ({ active }) => `Moving ${title(active.id)} was cancelled.`,
        },
      }}
    >
      <div className="-mx-4 overflow-x-auto px-4 pb-2 md:-mx-6 md:px-6">
        <div className="grid gap-3" style={{ minWidth, gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))` }}>
          {columns.map((col) => (
            <Column key={col.key} column={col} count={cards.filter((c) => c.column === col.key).length} dragging={active !== null}>
              {cards
                .filter((c) => c.column === col.key)
                .map((c) => (
                  <Draggable key={c.id} card={c}>
                    {renderCard(c)}
                  </Draggable>
                ))}
              {!cards.some((c) => c.column === col.key) && <p className="px-1 py-4 text-center text-xs text-muted">{emptyText}</p>}
            </Column>
          ))}
        </div>
      </div>
      <DragOverlay dropAnimation={null}>
        {active ? <div className="rotate-1 cursor-grabbing shadow-panel">{renderCard(active)}</div> : null}
      </DragOverlay>
    </DndContext>
  );
}

function Column({ column, count, dragging, children }: { column: KanbanColumn; count: number; dragging: boolean; children: ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: column.key });
  return (
    <section
      ref={setNodeRef}
      aria-label={column.label}
      className={`flex min-w-0 flex-col gap-2 rounded-xl p-2 transition-colors ${
        isOver ? "bg-accent-soft ring-2 ring-accent" : dragging ? "bg-surface-2 ring-1 ring-line" : "bg-surface-2/60"
      }`}
    >
      <header className="flex items-baseline justify-between gap-2 px-1 pt-1">
        <h2 className="truncate text-[13px] font-bold">{column.label}</h2>
        <span className="text-xs tabular-nums text-muted">{count}</span>
      </header>
      {column.meta && <p className="px-1 text-xs tabular-nums text-muted">{column.meta}</p>}
      {children}
    </section>
  );
}

function Draggable({ card, children }: { card: KanbanCard; children: ReactNode }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: card.id, disabled: !card.movable });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      aria-roledescription="Draggable card"
      className={`touch-manipulation rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-accent ${
        card.movable ? "cursor-grab" : "cursor-default"
      } ${isDragging ? "opacity-30" : ""}`}
    >
      {children}
    </div>
  );
}
