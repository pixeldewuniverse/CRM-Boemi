"use client";

import { DndContext, KeyboardSensor, MouseSensor, TouchSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useEffect, useRef, useState } from "react";
import { addColumn, deleteColumn, updateColumn } from "@/app/actions/boards";
import { CATEGORY_LABEL, CUSTOM_TYPES, LABEL_COLORS, STATUS_CATEGORIES, colorHex, labelsOf, type CustomType, type Label } from "@/lib/boards/columns";
import { between } from "@/lib/boards/positions";
import { LabelChip, Popover, toast } from "./ui";
import type { Column } from "./types";

const report = (r: { ok: boolean; error?: string }, done?: string) => {
  if (!r.ok) toast(r.error ?? "Something went wrong.", "bad");
  else if (done) toast(done);
};

/** Header cell menu: rename, width, hide, labels, number format, delete. */
export function ColumnMenu({ column, onLabels, onLocal }: { column: Column; onLabels: (c: Column) => void; onLocal: (patch: Partial<Column>) => void }) {
  const [confirm, setConfirm] = useState(false);
  const hasLabels = ["status", "priority", "dropdown"].includes(column.type);
  return (
    <Popover label={`Column options: ${column.title}`} className="h-full w-6 flex-none" align="right" panelClassName="w-60" trigger={<span aria-hidden className="text-xs text-muted">▾</span>}>
      {(close) => (
        <div className="flex flex-col gap-2">
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const title = String(new FormData(e.currentTarget).get("title") ?? "").trim();
              if (!title || title === column.title) return close();
              onLocal({ title });
              close();
              report(await updateColumn({ columnId: column.id, title }));
            }}
            className="flex gap-1"
          >
            <input name="title" defaultValue={column.title} aria-label="Column name" className="input py-1" maxLength={60} />
            <button className="btn px-2 py-1 text-xs">Rename</button>
          </form>
          <div className="flex items-center gap-1 text-xs">
            <span className="text-muted">Width</span>
            {[-40, 40].map((d) => (
              <button
                key={d}
                type="button"
                className="btn px-2 py-0.5 text-xs"
                onClick={async () => {
                  const width = Math.min(600, Math.max(60, column.width + d));
                  onLocal({ width });
                  report(await updateColumn({ columnId: column.id, width }));
                }}
              >
                {d < 0 ? "Narrower" : "Wider"}
              </button>
            ))}
          </div>
          {column.type === "number" && (
            <form
              className="flex gap-1"
              onSubmit={async (e) => {
                e.preventDefault();
                const fd = new FormData(e.currentTarget);
                close();
                report(await updateColumn({ columnId: column.id, prefix: String(fd.get("prefix") ?? ""), unit: String(fd.get("unit") ?? "") }), "Number format saved.");
              }}
            >
              <input name="prefix" defaultValue={(column.settings.prefix as string) ?? ""} placeholder="Prefix (Rp)" aria-label="Prefix" className="input w-20 py-1" maxLength={6} />
              <input name="unit" defaultValue={(column.settings.unit as string) ?? ""} placeholder="Unit" aria-label="Unit" className="input w-16 py-1" maxLength={10} />
              <button className="btn px-2 py-1 text-xs">Save</button>
            </form>
          )}
          {hasLabels && (
            <button
              type="button"
              className="rounded-md px-2 py-1 text-left hover:bg-surface-2"
              onClick={() => {
                close();
                onLabels(column);
              }}
            >
              Edit labels…
            </button>
          )}
          {column.key !== "name" && (
            <button
              type="button"
              className="rounded-md px-2 py-1 text-left hover:bg-surface-2"
              onClick={async () => {
                close();
                report(await updateColumn({ columnId: column.id, hidden: true }), `${column.title} hidden. Show it again under Columns.`);
              }}
            >
              Hide column
            </button>
          )}
          {!column.isSystem &&
            (confirm ? (
              <button
                type="button"
                className="btn border-bad bg-bad py-1 text-xs text-white hover:border-bad"
                onClick={async () => {
                  close();
                  report(await deleteColumn({ columnId: column.id }), `${column.title} deleted.`);
                }}
              >
                Delete column and its values
              </button>
            ) : (
              <button type="button" className="rounded-md px-2 py-1 text-left text-bad hover:bg-surface-2" onClick={() => setConfirm(true)}>
                Delete column…
              </button>
            ))}
        </div>
      )}
    </Popover>
  );
}

export function AddColumn({ boardId }: { boardId: string }) {
  return (
    <Popover label="Add column" align="right" panelClassName="w-48" trigger={<span className="text-lg leading-none text-muted">+</span>}>
      {(close) => (
        <div className="flex flex-col">
          <p className="px-2 pb-1 text-xs font-semibold text-muted">Add a column</p>
          {(Object.keys(CUSTOM_TYPES) as CustomType[]).map((t) => (
            <button
              key={t}
              type="button"
              className="rounded-md px-2 py-1 text-left hover:bg-surface-2"
              onClick={async () => {
                close();
                report(await addColumn({ boardId, type: t }), `${CUSTOM_TYPES[t]} column added.`);
              }}
            >
              {CUSTOM_TYPES[t]}
            </button>
          ))}
        </div>
      )}
    </Popover>
  );
}

/** Modal editor for status / priority / dropdown labels. */
export function LabelEditor({ column, onClose }: { column: Column; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [labels, setLabels] = useState<Label[]>(() => labelsOf(column.settings).map((l) => ({ ...l })));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const isStatus = column.type === "status";
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  const set = (i: number, patch: Partial<Label>) => setLabels((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  return (
    <dialog ref={ref} onClose={onClose} aria-label={`Labels: ${column.title}`} className="m-auto max-h-[92dvh] w-[min(94vw,34rem)] overflow-y-auto rounded-xl border border-line bg-surface p-0 text-fg shadow-panel backdrop:bg-black/40">
      <div className="flex flex-col gap-3 p-4">
        <div>
          <h2 className="font-bold">Labels: {column.title}</h2>
          {isStatus && <p className="text-[13px] text-muted">The category decides progress, reports and automations — the label text and colour are free.</p>}
        </div>
        <ul className="flex flex-col gap-2">
          {labels.map((l, i) => (
            <li key={l.key} className="flex flex-wrap items-center gap-1.5 rounded-lg border border-line p-1.5">
              <LabelChip label={l} className="w-24" />
              <input value={l.label} onChange={(e) => set(i, { label: e.target.value })} aria-label="Label text" className="input min-w-0 flex-1 py-1" maxLength={40} />
              <select value={l.color} onChange={(e) => set(i, { color: e.target.value })} aria-label={`Colour of ${l.label}`} className="input w-auto py-1" style={{ color: colorHex(l.color) }}>
                {Object.keys(LABEL_COLORS).map((c) => (
                  <option key={c} value={c} style={{ color: colorHex(c) }}>
                    ● {c}
                  </option>
                ))}
              </select>
              {isStatus && (
                <select value={l.category ?? ""} onChange={(e) => set(i, { category: e.target.value as Label["category"] })} aria-label={`Category of ${l.label}`} className="input w-auto py-1">
                  {STATUS_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {CATEGORY_LABEL[c]}
                    </option>
                  ))}
                </select>
              )}
              <button type="button" aria-label={`Remove ${l.label}`} className="px-1 text-bad" disabled={labels.length <= 1} onClick={() => setLabels((ls) => ls.filter((_, j) => j !== i))}>
                ✕
              </button>
            </li>
          ))}
        </ul>
        <button
          type="button"
          className="btn self-start py-1 text-xs"
          onClick={() => setLabels((ls) => [...ls, { key: `l${Date.now().toString(36)}`, label: "New label", color: "blue", ...(isStatus ? { category: "working" as const } : {}) }])}
        >
          + Add label
        </button>
        <p className="text-xs text-muted">Removing a label leaves items that use it without a value.</p>
        {error && (
          <p role="alert" className="text-[13px] text-bad">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn" onClick={() => ref.current?.close()}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              const r = await updateColumn({ columnId: column.id, labels: labels.map((l) => ({ ...l, label: l.label.trim() })) as never });
              setBusy(false);
              if (!r.ok) return setError(r.error);
              toast("Labels saved.");
              ref.current?.close();
            }}
          >
            Save labels
          </button>
        </div>
      </div>
    </dialog>
  );
}

function SortableColumn({ column, hidden, onToggle, canDrag }: { column: Column; hidden: boolean; onToggle: () => void; canDrag: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: column.id, disabled: !canDrag });
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={`flex items-center gap-2 rounded-md bg-surface px-1 py-1 ${isDragging ? "shadow-panel" : ""}`}>
      {canDrag && (
        <button type="button" aria-label={`Drag ${column.title}`} className="cursor-grab touch-none px-1 text-muted" {...attributes} {...listeners}>
          ⋮⋮
        </button>
      )}
      <label className="flex min-w-0 flex-1 items-center gap-2">
        <input type="checkbox" checked={!hidden} onChange={onToggle} className="size-4 accent-[var(--accent)]" />
        <span className="truncate">{column.title}</span>
      </label>
    </li>
  );
}

/**
 * Toolbar "Columns": show/hide and drag order. Board owners change the board
 * for everyone; others only hide columns for themselves (kept in the URL).
 */
export function ColumnsManager({ columns, manage, personalHidden, onPersonal }: { columns: Column[]; manage: boolean; personalHidden: string[]; onPersonal: (keys: string[]) => void }) {
  const [order, setOrder] = useState(columns.filter((c) => c.key !== "name"));
  const sensors = useSensors(useSensor(MouseSensor, { activationConstraint: { distance: 4 } }), useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const onEnd = async ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const from = order.findIndex((c) => c.id === active.id);
    const to = order.findIndex((c) => c.id === over.id);
    const next = arrayMove(order, from, to);
    setOrder(next);
    const before = next[to - 1]?.position ?? columns.find((c) => c.key === "name")?.position ?? null;
    const after = next[to + 1]?.position ?? null;
    report(await updateColumn({ columnId: String(active.id), position: between(before, after) }));
  };
  return (
    <div className="flex flex-col gap-1">
      <p className="text-xs text-muted">{manage ? "Changes apply to everyone on this board. Drag to reorder." : "Hidden only for you."}</p>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onEnd}>
        <SortableContext items={order.map((c) => c.id)} strategy={verticalListSortingStrategy}>
          <ul className="flex max-h-72 flex-col overflow-y-auto">
            {order.map((c) => (
              <SortableColumn
                key={c.id}
                column={c}
                canDrag={manage}
                hidden={manage ? c.hidden : c.hidden || personalHidden.includes(c.key)}
                onToggle={async () => {
                  if (!manage) {
                    if (c.hidden) return toast("The board owner hid this column.", "warn");
                    return onPersonal(personalHidden.includes(c.key) ? personalHidden.filter((k) => k !== c.key) : [...personalHidden, c.key]);
                  }
                  setOrder((o) => o.map((x) => (x.id === c.id ? { ...x, hidden: !x.hidden } : x)));
                  report(await updateColumn({ columnId: c.id, hidden: !c.hidden }));
                }}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
    </div>
  );
}
