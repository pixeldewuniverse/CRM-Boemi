"use client";

import { useEffect, useRef, useState } from "react";
import { itemDetail } from "@/app/actions/board-items";
import { labelsOf } from "@/lib/boards/columns";
import { Cell, type CellCtx } from "./cells";
import { rangeLabel } from "./ui";
import type { Column, ItemRow } from "./types";

type Activity = { id: string; field: string; from: unknown; to: unknown; at: string; by: string | null };

const FIELD_NAMES: Record<string, string> = {
  created: "created the item",
  archived: "archived the item",
  group: "moved it to another group",
  name: "renamed it",
  status: "changed status",
  priority: "changed priority",
  people: "changed people",
  timeline: "changed the timeline",
  estimate_hours: "changed the estimate",
  milestone: "changed milestone",
  dependency: "changed dependencies",
  link_account: "changed the account",
  link_deal: "changed the deal",
};

function show(v: unknown, column: Column | undefined, ctx: CellCtx): string {
  if (v == null || v === "") return "—";
  if (column && ["status", "priority", "dropdown"].includes(column.type)) {
    const labels = labelsOf(column.settings);
    const keys = Array.isArray(v) ? v : [v];
    return keys.map((k) => labels.find((l) => l.key === k)?.label ?? String(k)).join(", ") || "—";
  }
  if (column?.type === "people") return (v as string[]).map((id) => ctx.people.find((p) => p.id === id)?.name ?? "someone").join(", ") || "—";
  if (column?.type === "timeline") {
    const t = v as { start: string | null; due: string | null };
    return rangeLabel(t.start, t.due) || "—";
  }
  if (column?.type === "link_account") return ctx.accounts.find((a) => a.value === v)?.label ?? "an account";
  if (column?.type === "link_deal") return ctx.deals.find((a) => a.value === v)?.label ?? "a deal";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "object") return (v as { url?: string }).url ?? JSON.stringify(v).slice(0, 60);
  return String(v).slice(0, 80);
}

/** Right-hand drawer: every field of one item, its subitems and its activity. */
export function ItemPanel({
  item,
  columns,
  ctx,
  subitems,
  onAddSubitem,
  onClose,
}: {
  item: ItemRow;
  columns: Column[];
  ctx: CellCtx;
  subitems: ItemRow[];
  onAddSubitem: (parent: ItemRow, name: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [activity, setActivity] = useState<Activity[] | null>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  useEffect(() => {
    let live = true;
    itemDetail(item.id).then((d) => live && setActivity((d?.activity as Activity[]) ?? []));
    return () => {
      live = false;
    };
  }, [item.id, item.updatedAt]);
  const can = ctx.editable(item);
  const subCols = columns.filter((c) => ["status", "people", "timeline"].includes(c.key));

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-label={item.name}
      className="fixed inset-y-0 right-0 m-0 ml-auto h-dvh max-h-dvh w-full max-w-[30rem] overflow-y-auto border-l border-line bg-surface p-0 text-fg shadow-panel backdrop:bg-black/30"
    >
      <div className="flex flex-col gap-4 p-4">
        <div className="flex items-start gap-2">
          <h2 className="min-w-0 flex-1 text-lg font-bold">{item.name}</h2>
          <button type="button" className="btn px-2 py-1" onClick={() => ref.current?.close()} aria-label="Close">
            ✕
          </button>
        </div>
        {!can && <p className="rounded-lg bg-surface-2 px-3 py-2 text-[13px] text-muted">Read-only: you can view this item but not change it.</p>}

        <dl className="grid grid-cols-[8.5rem_1fr] gap-x-2 gap-y-1 text-[13px]">
          {columns
            .filter((c) => c.key !== "name")
            .map((c) => (
              <div key={c.id} className="contents">
                <dt className="flex items-center text-muted">{c.title}</dt>
                <dd className="h-9 min-w-0 rounded-md border border-line">
                  <Cell column={c} item={item} ctx={ctx} />
                </dd>
              </div>
            ))}
          <dt className="flex items-center text-muted">Milestone</dt>
          <dd className="flex h-9 items-center">
            <label className="flex items-center gap-2">
              <input type="checkbox" disabled={!can} checked={item.isMilestone} onChange={(e) => ctx.save(item, "milestone", e.target.checked, { isMilestone: e.target.checked })} className="size-4 accent-[var(--accent)]" />
              Key date (◆ on the timeline)
            </label>
          </dd>
        </dl>

        {!item.parentItemId && (
          <section className="flex flex-col gap-2">
            <h3 className="font-bold">Subitems</h3>
            {subitems.length ? (
              <ul className="flex flex-col gap-1">
                {subitems.map((s) => (
                  <li key={s.id} className="grid grid-cols-[1fr_7rem] items-center gap-1 rounded-md border border-line sm:grid-cols-[1fr_7rem_5rem]">
                    <div className="h-9 min-w-0">
                      <Cell column={columns.find((c) => c.key === "name")!} item={s} ctx={ctx} />
                    </div>
                    {subCols
                      .filter((c) => c.key !== "timeline")
                      .map((c) => (
                        <div key={c.id} className={`h-9 min-w-0 ${c.key === "people" ? "hidden sm:block" : ""}`}>
                          <Cell column={c} item={s} ctx={ctx} />
                        </div>
                      ))}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[13px] text-muted">No subitems.</p>
            )}
            {can && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const input = e.currentTarget.elements.namedItem("name") as HTMLInputElement;
                  if (input.value.trim()) onAddSubitem(item, input.value.trim());
                  input.value = "";
                }}
              >
                <input name="name" placeholder="+ Add subitem" aria-label="New subitem" className="input py-1.5" maxLength={255} />
              </form>
            )}
          </section>
        )}

        <section className="flex flex-col gap-2">
          <h3 className="font-bold">Activity</h3>
          {activity === null ? (
            <p className="text-[13px] text-muted">Loading…</p>
          ) : activity.length ? (
            <ol className="flex flex-col gap-1.5 text-[13px]">
              {activity.map((a) => {
                const key = a.field.startsWith("v:") ? a.field.slice(2) : a.field;
                const col = columns.find((c) => c.key === key) ?? (key === "people" ? columns.find((c) => c.key === "people") : undefined);
                const verb = FIELD_NAMES[a.field] ?? `changed ${col?.title ?? "a field"}`;
                const detail = a.field === "created" || a.field === "archived" ? (typeof a.to === "string" ? a.to : "") : a.field === "group" ? "" : `${show(a.from, col, ctx)} → ${show(a.to, col, ctx)}`;
                return (
                  <li key={a.id} className="border-l-2 border-line pl-2">
                    <span className="font-semibold">{a.by ?? "Someone"}</span> {verb}
                    {detail && <span className="text-muted"> · {detail}</span>}
                    <span className="block text-xs text-muted">{new Date(a.at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                  </li>
                );
              })}
            </ol>
          ) : (
            <p className="text-[13px] text-muted">No activity yet.</p>
          )}
        </section>
      </div>
    </dialog>
  );
}
