"use client";

import { Kanban, type KanbanCard } from "@/components/board/kanban";
import { colorHex, groupHex, labelsOf } from "@/lib/boards/columns";
import type { CellCtx } from "./cells";
import { Faces, LabelChip, shortDate } from "./ui";
import type { Column, ItemRow } from "./types";

type Card = KanbanCard & { item: ItemRow };
const NONE = "__none";

/**
 * Kanban view: one lane per label of a status column (system Status by
 * default). Dragging a card saves the new label through the same cell save
 * as the table (optimistic, conflict toast, edit-own-only respected).
 */
export function KanbanView({
  items,
  column,
  priority,
  groups,
  ctx,
}: {
  items: ItemRow[];
  /** The status-type column that defines the lanes. */
  column: Column;
  priority: Column | undefined;
  groups: { id: string; name: string; color: string }[];
  ctx: CellCtx;
}) {
  const labels = labelsOf(column.settings);
  const keyOf = (i: ItemRow) => ((column.isSystem ? i.statusKey : (i.values[column.key] as string | null)) ?? NONE);
  const lanes = labels.map((l) => {
    const list = items.filter((i) => keyOf(i) === l.key);
    const hours = list.reduce((a, i) => a + (i.estimateHours ?? 0), 0);
    return {
      key: l.key,
      label: l.label,
      meta: (
        <span className="flex items-center gap-2">
          <span className="h-1.5 w-8 rounded-full" style={{ background: colorHex(l.color) }} />
          {hours ? `${hours.toLocaleString("en-US")} h` : null}
        </span>
      ),
    };
  });
  if (items.some((i) => keyOf(i) === NONE || !labels.some((l) => l.key === keyOf(i)))) lanes.push({ key: NONE, label: "No status", meta: <span className="text-muted">Drag out to set a status</span> });

  const cards: Card[] = items.map((i) => {
    const k = keyOf(i);
    return { id: i.id, column: labels.some((l) => l.key === k) ? k : NONE, movable: ctx.editable(i), title: i.name, item: i };
  });
  const prio = labelsOf(priority?.settings);

  return (
    <Kanban<Card>
      columns={lanes}
      cards={cards}
      minWidth={lanes.length * 250}
      emptyText="No items"
      onDrop={(card, to) => {
        const next = to === NONE ? null : to;
        if (column.isSystem) ctx.save(card.item, "status", next, { statusKey: next });
        else ctx.save(card.item, `v:${column.key}`, next, { values: { ...card.item.values, [column.key]: next } });
      }}
      renderCard={({ item: i }) => {
        const g = groups.find((x) => x.id === i.groupId);
        const late = i.dueOn && !i.completedAt && i.dueOn < ctx.today;
        return (
          <article className="flex flex-col gap-2 rounded-xl border border-line border-l-4 bg-surface p-3" style={{ borderLeftColor: g ? groupHex(g.color) : undefined }}>
            <button type="button" className="text-left text-[13px] font-semibold hover:text-accent" onClick={() => ctx.openItem(i)} aria-label={`Open ${i.name}`}>
              {i.isMilestone ? "◆ " : ""}
              {i.name}
            </button>
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              {g && <span className="text-muted">{g.name}</span>}
              {i.priority && <LabelChip label={prio.find((l) => l.key === i.priority)} />}
              {i.subitemCount > 0 && <span className="text-muted">· {i.subitemCount} subitems</span>}
            </div>
            <div className="flex items-center gap-2 text-xs">
              <Faces ids={i.assignees} people={ctx.people} size={22} />
              {i.dueOn && <span className={`ml-auto ${late ? "font-semibold text-bad" : "text-muted"}`}>Due {shortDate(i.dueOn)}</span>}
            </div>
          </article>
        );
      }}
    />
  );
}
