"use client";

import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useRef, useState, type CSSProperties, type ReactNode } from "react";
import { addDependency, bulkItems, createItem, loadMoreItems, moveItem, removeDependency, removeItemFile, updateItemField, uploadItemFile, type ItemResult } from "@/app/actions/board-items";
import { createGroup, deleteGroup, moveGroup, updateGroup } from "@/app/actions/boards";
import { GROUP_COLORS, groupHex, labelsOf, colorHex } from "@/lib/boards/columns";
import { Cell, PeoplePicker, type CellCtx } from "./cells";
import { AddColumn, ColumnMenu, LabelEditor } from "./columns-ui";
import { ItemPanel } from "./item-panel";
import { KanbanView } from "./kanban-view";
import { TimelineView } from "./timeline-view";
import { Toolbar } from "./toolbar";
import { Faces, Popover, rangeLabel, shortDate, toast } from "./ui";
import type { BoardAccessProps, Column, GroupData, GroupSummary, ItemRow, Opt, Person } from "./types";

export type BoardTableProps = {
  boardId: string;
  columns: Column[];
  groups: GroupData[];
  subitems: ItemRow[];
  people: Person[];
  accounts: Opt[];
  deals: Opt[];
  access: BoardAccessProps;
  userId: string;
  search: Record<string, string>;
  /** A sort is active: manual drag is off. */
  sorted: boolean;
  /** Grouped by a column instead of the board's groups. */
  virtual: boolean;
  truncated: boolean;
  realGroups: { id: string; name: string; color: string }[];
  /** Table (default) or Kanban; Kanban gets every matching item in one list. */
  view?: "table" | "kanban" | "timeline";
  dependencyMode?: "strict" | "flexible" | "none";
  archived: boolean;
  today: string;
};

const HANDLE = 56;
const SUB_KEYS = ["name", "status", "people", "timeline", "estimate_hours"];
const SUB_WIDTHS: Record<string, number> = { name: 260, status: 140, people: 110, timeline: 170, estimate_hours: 100 };

function bySubParent(rows: ItemRow[]) {
  const out: Record<string, ItemRow[]> = {};
  for (const r of rows) if (r.parentItemId) (out[r.parentItemId] ??= []).push(r);
  return out;
}

/** Summary from the loaded rows (used when the whole group is loaded, so edits show at once). */
function summarize(items: ItemRow[], numberKeys: string[]): GroupSummary {
  const status: Record<string, number> = {};
  const numbers: Record<string, number> = Object.fromEntries(numberKeys.map((k) => [k, 0]));
  let estimate = 0;
  let minStart: string | null = null;
  let maxDue: string | null = null;
  const people = new Set<string>();
  for (const i of items) {
    status[i.statusKey ?? ""] = (status[i.statusKey ?? ""] ?? 0) + 1;
    for (const k of numberKeys) if (typeof i.values[k] === "number") numbers[k] += i.values[k] as number;
    estimate += i.estimateHours ?? 0;
    if (i.startOn && (!minStart || i.startOn < minStart)) minStart = i.startOn;
    if (i.dueOn && (!maxDue || i.dueOn > maxDue)) maxDue = i.dueOn;
    i.assignees.forEach((a) => people.add(a));
  }
  return { status, numbers, estimate, minStart, maxDue, people: people.size };
}

function SortableRow({ id, disabled, style, className, children }: { id: string; disabled: boolean; style: CSSProperties; className: string; children: (handle: Record<string, unknown>) => ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id, disabled });
  return (
    <div ref={setNodeRef} role="row" style={{ ...style, transform: CSS.Translate.toString(transform), transition, opacity: isDragging ? 0.4 : undefined }} className={className}>
      {children(disabled ? {} : { ...attributes, ...listeners })}
    </div>
  );
}

function GroupDrop({ id, children }: { id: string; children: ReactNode }) {
  const { setNodeRef } = useDroppable({ id: `group:${id}` });
  return (
    <div ref={setNodeRef} className="min-h-2">
      {children}
    </div>
  );
}

function EditableTitle({ value, color, onSave, disabled }: { value: string; color: string; onSave: (v: string) => void; disabled: boolean }) {
  const [editing, setEditing] = useState(false);
  if (editing && !disabled)
    return (
      <input
        autoFocus
        defaultValue={value}
        aria-label="Group name"
        maxLength={80}
        className="input w-56 py-0.5 font-bold"
        style={{ color }}
        onBlur={(e) => {
          setEditing(false);
          const v = e.currentTarget.value.trim();
          if (v && v !== value) onSave(v);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") setEditing(false);
        }}
      />
    );
  return (
    <button type="button" disabled={disabled} onClick={() => setEditing(true)} className="truncate text-left font-bold disabled:cursor-default" style={{ color }} aria-label={disabled ? value : `Rename group ${value}`}>
      {value}
    </button>
  );
}

export function BoardTable(props: BoardTableProps) {
  const { boardId, access } = props;
  const [groups, setGroups] = useState(props.groups);
  const [subs, setSubs] = useState(() => bySubParent(props.subitems));
  const [cols, setCols] = useState(props.columns);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [openId, setOpenId] = useState<string | null>(null);
  const [labelCol, setLabelCol] = useState<Column | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const snapshot = useRef<GroupData[] | null>(null);

  const personalHidden = props.search.hide?.split(",") ?? [];
  const sortedCols = [...cols].sort((a, b) => (a.key === "name" ? -1 : b.key === "name" ? 1 : a.position - b.position));
  const visible = sortedCols.filter((c) => c.key === "name" || (!c.hidden && !personalHidden.includes(c.key)));
  const numberKeys = visible.filter((c) => c.type === "number").map((c) => c.key);
  const statusCol = cols.find((c) => c.key === "status");
  const statusLabels = labelsOf(statusCol?.settings);
  const template = `${HANDLE}px ${visible.map((c) => `${c.width}px`).join(" ")} 44px`;
  const dragOff = props.sorted || props.virtual || !access.edit || props.archived;
  const kanban = props.view === "kanban";
  const timeline = props.view === "timeline";
  const canAdd = access.edit && !props.archived && !props.virtual;

  const allItems = () => [...groups.flatMap((g) => g.items), ...Object.values(subs).flat()];
  const findItem = (id: string) => allItems().find((i) => i.id === id);

  const patchItem = (id: string, fn: (i: ItemRow) => ItemRow) => {
    setGroups((gs) => gs.map((g) => (g.items.some((i) => i.id === id) ? { ...g, items: g.items.map((i) => (i.id === id ? fn(i) : i)) } : g)));
    setSubs((s) => {
      const parent = Object.keys(s).find((k) => s[k].some((i) => i.id === id));
      return parent ? { ...s, [parent]: s[parent].map((i) => (i.id === id ? fn(i) : i)) } : s;
    });
  };

  const settle = (prev: ItemRow, r: ItemResult) => {
    if (!r.ok) {
      patchItem(prev.id, () => prev);
      toast(r.error, "bad");
      return;
    }
    patchItem(prev.id, () => r.item);
    if (r.conflict) toast(`${r.conflict.by} also changed “${prev.name}” a moment ago — your change was saved on top.`, "warn");
  };
  const offline = (prev: ItemRow) => () => {
    patchItem(prev.id, () => prev);
    toast("Couldn't save — check your connection and try again.", "bad");
  };

  const editable = (item: ItemRow) => !props.archived && access.edit && (!access.editAssignedOnly || item.assignees.includes(props.userId));

  const ctx: CellCtx = {
    today: props.today,
    people: props.people,
    accounts: props.accounts,
    deals: props.deals,
    manage: access.manage && !props.archived,
    editable,
    itemOptions: () => allItems().map((i) => ({ id: i.id, name: i.name })),
    save: (item, field, value, patch) => {
      patchItem(item.id, (i) => ({ ...i, ...patch }));
      updateItemField({ itemId: item.id, field, value, seen: item.updatedAt }).then((r) => settle(item, r), offline(item));
    },
    upload: (item, key, file) => {
      if (file.size > 3.5 * 1024 * 1024) return toast("Files up to 3.5 MB.", "bad");
      const fd = new FormData();
      fd.set("itemId", item.id);
      fd.set("key", key);
      fd.set("file", file);
      toast(`Uploading ${file.name}…`);
      uploadItemFile(fd).then((r) => settle(item, r), offline(item));
    },
    removeFile: (item, key, fileKey) => removeItemFile({ itemId: item.id, key, fileKey }).then((r) => settle(item, r), offline(item)),
    addDep: (item, predecessorId, type, lagDays) => addDependency({ successorId: item.id, predecessorId, type: type as "FS", lagDays }).then((r) => settle(item, r), offline(item)),
    removeDep: (item, predecessorId) => removeDependency({ successorId: item.id, predecessorId }).then((r) => settle(item, r), offline(item)),
    editLabels: (c) => setLabelCol(c),
    openItem: (i) => setOpenId(i.id),
  };

  async function addItem(groupId: string, name: string, parent?: ItemRow) {
    const r = await createItem({ boardId, groupId, name, parentItemId: parent?.id });
    if (!r.ok) {
      toast(r.error, "bad");
      return null;
    }
    if (parent) {
      setSubs((s) => ({ ...s, [parent.id]: [...(s[parent.id] ?? []), r.item] }));
      patchItem(parent.id, (i) => ({ ...i, subitemCount: i.subitemCount + 1 }));
      setExpanded((e) => new Set(e).add(parent.id));
    } else if (kanban) setGroups((gs) => gs.map((g, i) => (i === 0 ? { ...g, items: [...g.items, r.item], total: g.total + 1 } : g)));
    else setGroups((gs) => gs.map((g) => (g.id === groupId ? { ...g, items: [...g.items, r.item], total: g.total + 1 } : g)));
    return r.item;
  }

  async function showMore(g: GroupData) {
    setLoading(g.id);
    const r = await loadMoreItems({ boardId, groupId: g.id, offset: g.items.length, search: props.search });
    setLoading(null);
    if (!r.ok) return toast(r.error, "bad");
    setGroups((gs) => gs.map((x) => (x.id === g.id ? { ...x, items: [...x.items, ...r.items.filter((i) => !x.items.some((y) => y.id === i.id))] } : x)));
    setSubs((s) => ({ ...s, ...bySubParent(r.subitems) }));
  }

  function patchGroup(id: string, patch: Partial<GroupData>, server?: Parameters<typeof updateGroup>[0]) {
    setGroups((gs) => gs.map((g) => (g.id === id ? { ...g, ...patch } : g)));
    if (server) updateGroup(server).then((r) => !r.ok && toast(r.error, "bad"));
  }

  async function runBulk(action: "move" | "status" | "people" | "duplicate" | "archive" | "delete", extra: { groupId?: string; statusKey?: string; userIds?: string[] } = {}) {
    const r = await bulkItems({ boardId, ids: [...selected], action, ...extra });
    if (!r.ok) return toast(r.error, "bad");
    const verb = { move: "Moved", status: "Updated", people: "Updated", duplicate: "Duplicated", archive: "Archived", delete: "Deleted" }[action];
    toast(`${verb} ${r.changed} item${r.changed === 1 ? "" : "s"}${r.skipped ? ` · ${r.skipped} skipped (not assigned to you)` : ""}.`);
    setSelected(new Set());
  }

  /* ───── drag & drop ───── */
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const containerOf = (id: string) => (id.startsWith("group:") ? id.slice(6) : groups.find((g) => g.items.some((i) => i.id === id))?.id);

  const onDragStart = ({ active }: DragStartEvent) => {
    snapshot.current = groups;
    setActiveId(String(active.id));
  };
  const onDragOver = ({ active, over }: DragOverEvent) => {
    if (!over) return;
    const from = containerOf(String(active.id));
    const to = containerOf(String(over.id));
    if (!from || !to || from === to) return;
    setGroups((gs) => {
      const item = gs.find((g) => g.id === from)?.items.find((i) => i.id === active.id);
      if (!item) return gs;
      return gs.map((g) => {
        if (g.id === from) return { ...g, items: g.items.filter((i) => i.id !== active.id), total: g.total - 1 };
        if (g.id !== to) return g;
        const at = g.items.findIndex((i) => i.id === over.id);
        const items = [...g.items];
        items.splice(at < 0 ? items.length : at, 0, { ...item, groupId: to });
        return { ...g, items, total: g.total + 1 };
      });
    });
  };
  const onDragEnd = async ({ active, over }: DragEndEvent) => {
    setActiveId(null);
    const before = snapshot.current;
    snapshot.current = null;
    if (!over || !before) {
      if (before) setGroups(before);
      return;
    }
    const gid = containerOf(String(active.id));
    const g = groups.find((x) => x.id === gid);
    if (!g) return;
    let items = g.items;
    const from = items.findIndex((i) => i.id === active.id);
    const to = items.findIndex((i) => i.id === over.id);
    if (to >= 0 && from !== to) {
      items = arrayMove(items, from, to);
      setGroups((gs) => gs.map((x) => (x.id === g.id ? { ...x, items } : x)));
    }
    const idx = items.findIndex((i) => i.id === active.id);
    const origGroup = before.find((x) => x.items.some((i) => i.id === active.id));
    if (origGroup?.id === g.id && origGroup.items.findIndex((i) => i.id === active.id) === idx) return;
    const item = items[idx];
    const r = await moveItem({ itemId: item.id, groupId: g.id, beforeId: items[idx - 1]?.id ?? null, afterId: items[idx + 1]?.id ?? null });
    if (!r.ok) {
      setGroups(before);
      return toast(r.error, "bad");
    }
    patchItem(item.id, () => r.item);
  };

  /* ───── rendering helpers (plain functions, not components) ───── */
  const sel = (id: string, on: boolean) =>
    setSelected((s) => {
      const n = new Set(s);
      if (on) n.add(id);
      else n.delete(id);
      return n;
    });

  function summaryCell(c: Column, s: GroupSummary | null, total: number) {
    if (!s) return null;
    if (c.key === "status") {
      const n = Object.values(s.status).reduce((a, b) => a + b, 0) || 1;
      return (
        <div className="flex h-4 w-full overflow-hidden rounded" title={statusLabels.map((l) => `${l.label}: ${s.status[l.key] ?? 0}`).join(" · ")} aria-label={`Status: ${statusLabels.map((l) => `${s.status[l.key] ?? 0} ${l.label}`).join(", ")}`}>
          {statusLabels.map((l) => (s.status[l.key] ? <span key={l.key} style={{ width: `${((s.status[l.key] ?? 0) / n) * 100}%`, background: colorHex(l.color) }} /> : null))}
          {s.status[""] ? <span style={{ width: `${(s.status[""] / n) * 100}%` }} className="bg-line" /> : null}
        </div>
      );
    }
    if (c.type === "number" && s.numbers[c.key] != null) {
      const p = (c.settings.prefix as string) || "";
      const u = (c.settings.unit as string) || "";
      return <span className="block w-full text-right text-xs font-semibold tabular-nums">{`${p ? `${p} ` : ""}${s.numbers[c.key].toLocaleString("en-US")}${u ? ` ${u}` : ""}`}<span className="block text-[10px] font-normal text-muted">sum</span></span>;
    }
    if (c.key === "estimate_hours") return <span className="block w-full text-right text-xs font-semibold tabular-nums">{s.estimate.toLocaleString("en-US")} h</span>;
    if (c.key === "timeline") return <span className="w-full truncate text-center text-xs text-muted">{rangeLabel(s.minStart, s.maxDue) || "—"}</span>;
    if (c.key === "people") return <span className="w-full text-center text-xs text-muted">{s.people} {s.people === 1 ? "person" : "people"}</span>;
    if (c.key === "name") return <span className="text-xs text-muted">{total} item{total === 1 ? "" : "s"}</span>;
    return null;
  }

  function groupMenu(g: GroupData) {
    const others = props.realGroups.filter((x) => x.id !== g.id);
    return (
      <Popover label={`Group options: ${g.name}`} className="" panelClassName="w-60" buttonClassName="rounded px-1.5 text-muted hover:bg-surface-2" trigger={<span aria-hidden>⋯</span>}>
        {(close) => (
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Group colour">
              {GROUP_COLORS.map((c) => (
                <button key={c} type="button" aria-label={`Colour ${c}`} aria-pressed={g.color === c} className={`size-6 rounded-full ${g.color === c ? "ring-2 ring-fg ring-offset-2 ring-offset-surface" : ""}`} style={{ background: groupHex(c) }} onClick={() => patchGroup(g.id, { color: c }, { groupId: g.id, color: c })} />
              ))}
            </div>
            <div className="flex gap-1">
              {(["up", "down"] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  className="btn flex-1 justify-center py-1 text-xs"
                  onClick={async () => {
                    close();
                    const r = await moveGroup({ groupId: g.id, direction: d });
                    if (!r.ok) toast(r.error, "bad");
                  }}
                >
                  Move {d}
                </button>
              ))}
            </div>
            {others.length > 0 && (
              <form
                className="flex flex-col gap-1 border-t border-line pt-2"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const moveTo = String(new FormData(e.currentTarget).get("moveTo") || "") || undefined;
                  close();
                  const r = await deleteGroup({ groupId: g.id, moveTo });
                  if (!r.ok) toast(r.error, "bad");
                  else toast(`Group “${g.name}” deleted.`);
                }}
              >
                {g.total > 0 && (
                  <label className="flex flex-col gap-1 text-xs font-semibold">
                    Move its {g.total} items to
                    <select name="moveTo" className="input py-1 font-normal" defaultValue={others[0].id}>
                      {others.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <button className="btn border-bad py-1 text-xs text-bad">Delete group</button>
              </form>
            )}
          </div>
        )}
      </Popover>
    );
  }

  function addRow(g: GroupData, compact = false) {
    if (!canAdd || g.virtual) return null;
    return (
      <form
        className={compact ? "" : "grid border-b border-line"}
        style={compact ? undefined : { gridTemplateColumns: template }}
        onSubmit={async (e) => {
          e.preventDefault();
          const input = e.currentTarget.elements.namedItem("name") as HTMLInputElement;
          const name = input.value.trim();
          if (!name) return;
          input.value = "";
          await addItem(g.id, name);
        }}
      >
        {!compact && <span className="sticky left-0 z-[5] border-l-4 bg-surface" style={{ borderColor: groupHex(g.color) }} />}
        <input name="name" placeholder="+ Add item" aria-label={`Add item to ${g.name}`} maxLength={255} className={compact ? "input py-1.5" : "sticky z-[5] h-9 bg-surface px-3 text-[13px] outline-none placeholder:text-muted focus:bg-accent-soft"} style={compact ? undefined : { left: HANDLE }} />
      </form>
    );
  }

  function subTable(parent: ItemRow) {
    const list = subs[parent.id] ?? [];
    const subCols = SUB_KEYS.map((k) => cols.find((c) => c.key === k)).filter((c): c is Column => Boolean(c));
    const tpl = subCols.map((c) => `${SUB_WIDTHS[c.key]}px`).join(" ");
    return (
      <div className="border-b border-line bg-surface-2/50 py-2" style={{ paddingLeft: HANDLE + 24 }}>
        <div className="sticky inline-block rounded-lg border border-line bg-surface" style={{ left: HANDLE + 24 }} role="table" aria-label={`Subitems of ${parent.name}`}>
          <div className="grid border-b border-line text-xs font-semibold text-muted" style={{ gridTemplateColumns: tpl }} role="row">
            {subCols.map((c) => (
              <span key={c.id} role="columnheader" className="truncate px-2 py-1.5">
                {c.key === "name" ? "Subitem" : c.title}
              </span>
            ))}
          </div>
          {list.map((s) => (
            <div key={s.id} role="row" className="grid h-9 border-b border-line last:border-b-0" style={{ gridTemplateColumns: tpl }}>
              {subCols.map((c) => (
                <div key={c.id} role="cell" className="min-w-0 border-r border-line last:border-r-0">
                  <Cell column={c} item={s} ctx={ctx} />
                </div>
              ))}
            </div>
          ))}
          {editable(parent) && (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const input = e.currentTarget.elements.namedItem("name") as HTMLInputElement;
                const name = input.value.trim();
                if (!name) return;
                input.value = "";
                await addItem(parent.groupId, name, parent);
              }}
            >
              <input name="name" placeholder="+ Add subitem" aria-label={`Add subitem to ${parent.name}`} maxLength={255} className="h-9 w-full bg-transparent px-3 text-[13px] outline-none placeholder:text-muted focus:bg-accent-soft" />
            </form>
          )}
        </div>
      </div>
    );
  }

  function row(item: ItemRow, g: GroupData) {
    const can = editable(item);
    const open = expanded.has(item.id);
    return (
      <div key={item.id}>
        <SortableRow id={item.id} disabled={dragOff || !can} style={{ gridTemplateColumns: template }} className={`group/row grid h-9 border-b border-line ${selected.has(item.id) ? "bg-accent-soft" : "bg-surface hover:bg-surface-2"}`}>
          {(handle) => (
            <>
              <div role="cell" className="sticky left-0 z-[5] flex items-center gap-1 border-l-4 bg-inherit pl-1" style={{ borderColor: groupHex(g.color) }}>
                <span className={`flex h-full w-5 items-center justify-center ${dragOff || !can ? "invisible" : "cursor-grab touch-none text-muted"}`} aria-label={`Drag ${item.name}`} role="button" tabIndex={dragOff || !can ? -1 : 0} {...handle}>
                  ⋮⋮
                </span>
                <input type="checkbox" aria-label={`Select ${item.name}`} checked={selected.has(item.id)} onChange={(e) => sel(item.id, e.target.checked)} className="size-4 accent-[var(--accent)]" disabled={!access.edit || props.archived} />
              </div>
              {visible.map((c) =>
                c.key === "name" ? (
                  <div key={c.id} role="cell" className="sticky z-[5] flex min-w-0 items-center border-r border-line bg-inherit" style={{ left: HANDLE }}>
                    <button type="button" aria-expanded={open} aria-label={`${open ? "Hide" : "Show"} subitems of ${item.name}`} onClick={() => setExpanded((e) => (open ? new Set([...e].filter((x) => x !== item.id)) : new Set(e).add(item.id)))} className={`flex h-full w-7 flex-none items-center justify-center text-xs ${item.subitemCount ? "text-accent" : "text-muted opacity-0 group-hover/row:opacity-100 focus:opacity-100"}`}>
                      {open ? "▾" : "▸"}
                      {item.subitemCount ? <span className="text-[10px]">{item.subitemCount}</span> : null}
                    </button>
                    <div className="h-full min-w-0 flex-1">
                      <Cell column={c} item={item} ctx={ctx} />
                    </div>
                    <button type="button" onClick={() => setOpenId(item.id)} aria-label={`Open ${item.name}`} className="mr-1 flex-none rounded px-1.5 py-0.5 text-xs text-muted opacity-0 hover:bg-surface hover:text-accent focus:opacity-100 group-hover/row:opacity-100">
                      Open
                    </button>
                  </div>
                ) : (
                  <div key={c.id} role="cell" className="min-w-0 border-r border-line">
                    <Cell column={c} item={item} ctx={ctx} />
                  </div>
                ),
              )}
              <div role="cell" />
            </>
          )}
        </SortableRow>
        {open && activeId !== item.id && subTable(item)}
      </div>
    );
  }

  function groupBlock(g: GroupData) {
    const color = groupHex(g.color);
    const allLoaded = g.items.length >= g.total;
    const summary = allLoaded ? summarize(g.items, numberKeys) : g.summary;
    const ids = g.items.map((i) => i.id);
    const allSel = ids.length > 0 && ids.every((id) => selected.has(id));
    return (
      <section key={g.id} className="mb-6" aria-label={g.name}>
        <div className="sticky left-0 flex w-fit max-w-[calc(100vw-2rem)] items-center gap-2 py-2">
          <button
            type="button"
            aria-expanded={!g.collapsed}
            aria-label={`${g.collapsed ? "Expand" : "Collapse"} ${g.name}`}
            className="flex size-6 items-center justify-center rounded text-sm"
            style={{ color }}
            onClick={() => patchGroup(g.id, { collapsed: !g.collapsed }, g.virtual ? undefined : { groupId: g.id, collapsed: !g.collapsed })}
          >
            {g.collapsed ? "▸" : "▾"}
          </button>
          <EditableTitle value={g.name} color={color} disabled={!ctx.manage || Boolean(g.virtual)} onSave={(name) => patchGroup(g.id, { name }, { groupId: g.id, name })} />
          <span className="text-xs text-muted">
            {g.total} item{g.total === 1 ? "" : "s"}
          </span>
          {ctx.manage && !g.virtual && groupMenu(g)}
        </div>
        {g.collapsed ? (
          <div className="grid h-10 rounded-lg border border-line border-l-4 bg-surface" style={{ gridTemplateColumns: template, borderLeftColor: color }}>
            <span />
            {visible.map((c) => (
              <div key={c.id} className="flex min-w-0 items-center px-2">
                {summaryCell(c, summary, g.total)}
              </div>
            ))}
          </div>
        ) : (
          <div role="table" aria-label={`${g.name} items`} className="w-max min-w-full overflow-hidden rounded-lg border border-line">
            <div role="row" className="grid h-9 border-b border-line bg-surface text-xs font-semibold text-muted" style={{ gridTemplateColumns: template }}>
              <div className="sticky left-0 z-[6] flex items-center justify-end border-l-4 bg-surface pr-1" style={{ borderColor: color }}>
                <input type="checkbox" aria-label={`Select all in ${g.name}`} checked={allSel} disabled={!ids.length || !access.edit || props.archived} onChange={(e) => setSelected((s) => { const n = new Set(s); ids.forEach((id) => (e.target.checked ? n.add(id) : n.delete(id))); return n; })} className="size-4 accent-[var(--accent)]" />
              </div>
              {visible.map((c) => (
                <div key={c.id} role="columnheader" className={`flex min-w-0 items-center border-r border-line pl-2 ${c.key === "name" ? "sticky z-[6] bg-surface" : ""}`} style={c.key === "name" ? { left: HANDLE } : undefined}>
                  <span className={`min-w-0 flex-1 truncate ${c.key === "name" ? "" : "text-center"}`} title={c.title}>
                    {c.key === "name" && g.virtual ? "Item" : c.title}
                  </span>
                  {ctx.manage && (
                    <ColumnMenu
                      column={c}
                      onLabels={(col) => setLabelCol(col)}
                      onLocal={(patch) => setCols((cs) => cs.map((x) => (x.id === c.id ? { ...x, ...patch } : x)))}
                    />
                  )}
                </div>
              ))}
              <div className="flex items-center justify-center">{ctx.manage && <AddColumn boardId={boardId} />}</div>
            </div>
            <GroupDrop id={g.id}>
              <SortableContext items={ids} strategy={verticalListSortingStrategy}>
                {g.items.map((i) => row(i, g))}
              </SortableContext>
            </GroupDrop>
            {addRow(g)}
            <div className="grid h-11 bg-surface" style={{ gridTemplateColumns: template }}>
              <span className="sticky left-0 z-[5] bg-surface" />
              {visible.map((c) => (
                <div key={c.id} className={`flex min-w-0 items-center px-2 ${c.key === "name" ? "sticky z-[5] bg-surface" : ""}`} style={c.key === "name" ? { left: HANDLE } : undefined}>
                  {summaryCell(c, summary, g.total)}
                </div>
              ))}
            </div>
          </div>
        )}
        {!g.collapsed && !allLoaded && !g.virtual && (
          <button type="button" className="btn sticky left-0 mt-2" disabled={loading === g.id} onClick={() => showMore(g)}>
            {loading === g.id ? "Loading…" : `Show more (${g.total - g.items.length} more)`}
          </button>
        )}
      </section>
    );
  }

  function mobileGroup(g: GroupData) {
    const color = groupHex(g.color);
    const statusC = cols.find((c) => c.key === "status");
    return (
      <section key={g.id} aria-label={g.name} className="flex flex-col gap-2">
        <button type="button" className="flex items-center gap-2 text-left" onClick={() => patchGroup(g.id, { collapsed: !g.collapsed }, g.virtual ? undefined : { groupId: g.id, collapsed: !g.collapsed })} aria-expanded={!g.collapsed}>
          <span className="h-4 w-1 rounded" style={{ background: color }} />
          <span className="font-bold" style={{ color }}>
            {g.name}
          </span>
          <span className="text-xs text-muted">{g.total}</span>
          <span className="ml-auto text-muted">{g.collapsed ? "▸" : "▾"}</span>
        </button>
        {!g.collapsed && (
          <>
            <ul className="flex flex-col gap-2">
              {g.items.map((i) => (
                <li key={i.id} className="rounded-xl border border-line border-l-4 bg-surface p-3" style={{ borderLeftColor: color }}>
                  <button type="button" className="w-full text-left font-semibold" onClick={() => setOpenId(i.id)}>
                    {i.isMilestone ? "◆ " : ""}
                    {i.name}
                  </button>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                    {statusC && (
                      <span className="w-32">
                        <Cell column={statusC} item={i} ctx={ctx} />
                      </span>
                    )}
                    <Faces ids={i.assignees} people={props.people} size={22} />
                    {i.dueOn && <span className={`ml-auto ${!i.completedAt && i.dueOn < props.today ? "font-semibold text-bad" : "text-muted"}`}>Due {shortDate(i.dueOn)}</span>}
                    {i.subitemCount > 0 && <span className="text-muted">{i.subitemCount} subitems</span>}
                  </div>
                </li>
              ))}
              {!g.items.length && <li className="text-[13px] text-muted">No items.</li>}
            </ul>
            {addRow(g, true)}
            {g.items.length < g.total && !g.virtual && (
              <button type="button" className="btn justify-center" disabled={loading === g.id} onClick={() => showMore(g)}>
                {loading === g.id ? "Loading…" : `Show more (${g.total - g.items.length})`}
              </button>
            )}
          </>
        )}
      </section>
    );
  }

  const openItem = openId ? findItem(openId) : undefined;
  const active = activeId ? findItem(activeId) : undefined;
  const firstGroup = props.realGroups[0];

  return (
    <div className="flex flex-col gap-4">
      <Toolbar
        search={props.search}
        columns={sortedCols}
        people={props.people}
        groups={props.realGroups}
        manage={ctx.manage}
        view={props.view ?? "table"}
        canAdd={canAdd && Boolean(firstGroup)}
        onNewItem={async () => {
          const item = await addItem(firstGroup.id, "New item");
          if (item) setOpenId(item.id);
        }}
      />
      {props.sorted && !kanban && !timeline && <p className="text-[13px] text-muted">Sorted — drag and drop is off until you go back to manual order.</p>}
      {props.truncated && <p className="text-[13px] text-warn">Showing the first 500 matching items. Narrow the filters to see the rest.</p>}

      {timeline ? (
        <TimelineView groups={groups} ctx={ctx} statusColumn={cols.find((c) => c.key === "status")} mode={props.dependencyMode ?? "flexible"} canEditBoard={access.edit && !props.archived} />
      ) : kanban ? (
        (() => {
          const lanesBy = cols.find((c) => c.key === props.search.lanes && c.type === "status") ?? cols.find((c) => c.key === "status");
          return lanesBy ? (
            <KanbanView items={groups.flatMap((g) => g.items)} column={lanesBy} priority={cols.find((c) => c.key === "priority")} groups={props.realGroups} ctx={ctx} />
          ) : (
            <p className="py-10 text-center text-muted">This board has no status column.</p>
          );
        })()
      ) : (
        <>
        <div className="hidden md:block">
          <div className="relative overflow-x-auto pb-2">
            <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={onDragStart} onDragOver={onDragOver} onDragEnd={onDragEnd} onDragCancel={() => { if (snapshot.current) setGroups(snapshot.current); snapshot.current = null; setActiveId(null); }}>
              {groups.map(groupBlock)}
              <DragOverlay>{active ? <div className="rounded-lg border border-accent bg-surface px-3 py-2 text-[13px] font-semibold shadow-panel">{active.name}</div> : null}</DragOverlay>
            </DndContext>
          </div>
        </div>
        <div className="flex flex-col gap-5 md:hidden">{groups.map(mobileGroup)}</div>

        {!groups.length && <p className="py-10 text-center text-muted">No items match.</p>}
        </>
      )}

      {ctx.manage && !props.virtual && !kanban && !timeline && (
        <button
          type="button"
          className="btn self-start"
          onClick={async () => {
            const r = await createGroup({ boardId });
            if (!r.ok) toast(r.error, "bad");
          }}
        >
          + Add group
        </button>
      )}

      {selected.size > 0 && (
        <div role="region" aria-label="Bulk actions" className="fixed inset-x-2 bottom-3 z-50 mx-auto flex max-w-3xl flex-wrap items-center gap-2 rounded-xl border border-line bg-surface p-2 shadow-panel">
          <span className="px-1 text-[13px] font-bold">{selected.size} selected</span>
          <select aria-label="Move selected to group" className="input w-auto py-1" value="" onChange={(e) => e.target.value && runBulk("move", { groupId: e.target.value })}>
            <option value="">Move to…</option>
            {props.realGroups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
          <select aria-label="Set status of selected" className="input w-auto py-1" value="" onChange={(e) => e.target.value && runBulk("status", { statusKey: e.target.value })}>
            <option value="">Status…</option>
            {statusLabels.map((l) => (
              <option key={l.key} value={l.key}>
                {l.label}
              </option>
            ))}
          </select>
          <BulkPeople people={props.people} onApply={(userIds) => runBulk("people", { userIds })} />
          <button type="button" className="btn py-1" onClick={() => runBulk("duplicate")}>
            Duplicate
          </button>
          <button type="button" className="btn py-1" onClick={() => runBulk("archive")}>
            Archive
          </button>
          {ctx.manage && <BulkDelete count={selected.size} onConfirm={() => runBulk("delete")} />}
          <button type="button" className="ml-auto px-2 text-muted" aria-label="Clear selection" onClick={() => setSelected(new Set())}>
            ✕
          </button>
        </div>
      )}

      {openItem && <ItemPanel key={openItem.id} item={openItem} columns={visible} ctx={ctx} subitems={subs[openItem.id] ?? []} onAddSubitem={(p, name) => addItem(p.groupId, name, p)} onClose={() => setOpenId(null)} />}
      {labelCol && <LabelEditor column={labelCol} onClose={() => setLabelCol(null)} />}
    </div>
  );
}

function BulkPeople({ people, onApply }: { people: Person[]; onApply: (ids: string[]) => void }) {
  const [ids, setIds] = useState<string[]>([]);
  return (
    <Popover label="Set people on selected" className="" buttonClassName="btn py-1" trigger="People…" panelClassName="w-64">
      {(close) => (
        <div className="flex flex-col gap-2">
          <PeoplePicker people={people} current={ids} onChange={setIds} />
          <button
            type="button"
            className="btn btn-primary self-end px-2 py-1 text-xs"
            onClick={() => {
              close();
              onApply(ids);
            }}
          >
            {ids.length ? `Assign ${ids.length}` : "Clear people"}
          </button>
        </div>
      )}
    </Popover>
  );
}

function BulkDelete({ count, onConfirm }: { count: number; onConfirm: () => void }) {
  const [sure, setSure] = useState(false);
  return sure ? (
    <button type="button" className="btn border-bad bg-bad py-1 text-white hover:border-bad" onClick={onConfirm}>
      Delete {count} for good
    </button>
  ) : (
    <button type="button" className="btn py-1 text-bad" onClick={() => setSure(true)}>
      Delete…
    </button>
  );
}

