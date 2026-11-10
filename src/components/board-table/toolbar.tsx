"use client";

import { usePathname, useRouter } from "next/navigation";
import { useTransition } from "react";
import { labelsOf } from "@/lib/boards/columns";
import { ColumnsManager } from "./columns-ui";
import { LabelChip, Popover } from "./ui";
import type { Column, Person } from "./types";

const SORTABLE = new Set(["name", "status", "priority", "timeline", "estimate_hours", "number", "date", "text", "checkbox"]);

/** Search, filters, sort, group-by and columns — all kept in the URL. */
export function Toolbar({
  search,
  columns,
  people,
  groups,
  manage,
  canAdd,
  onNewItem,
}: {
  search: Record<string, string>;
  columns: Column[];
  people: Person[];
  groups: { id: string; name: string }[];
  manage: boolean;
  canAdd: boolean;
  onNewItem: () => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, start] = useTransition();
  const go = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams(Object.entries({ ...search, ...patch }).filter((e): e is [string, string] => Boolean(e[1])));
    start(() => router.replace(`${pathname}${next.size ? `?${next}` : ""}`, { scroll: false }));
  };
  const statusCol = columns.find((c) => c.key === "status");
  const statusLabels = labelsOf(statusCol?.settings);
  const picked = search.status?.split(",").filter(Boolean) ?? [];
  const hidden = search.hide?.split(",").filter(Boolean) ?? [];
  const filtered = Boolean(search.q || search.person || search.status || search.group || search.from || search.to);
  const sortable = columns.filter((c) => SORTABLE.has(c.type) && !c.hidden);

  return (
    <div className={`flex flex-wrap items-center gap-2 ${pending ? "opacity-70" : ""}`} aria-busy={pending}>
      {canAdd && (
        <button type="button" className="btn btn-primary" onClick={onNewItem}>
          New item
        </button>
      )}
      <form
        className="order-first w-full sm:order-none sm:w-auto"
        onSubmit={(e) => {
          e.preventDefault();
          go({ q: String(new FormData(e.currentTarget).get("q") ?? "").trim() || undefined });
        }}
      >
        <input name="q" defaultValue={search.q ?? ""} placeholder="Search items" aria-label="Search items" className="input w-full py-1.5 sm:w-52" />
      </form>

      <select aria-label="Person" value={search.person ?? ""} onChange={(e) => go({ person: e.target.value || undefined })} className="input w-auto py-1.5">
        <option value="">Person: all</option>
        {people.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>

      <Popover
        label="Status filter"
        className="" buttonClassName="flex"
        panelClassName="w-56"
        trigger={<span className={`btn py-1.5 ${picked.length ? "border-accent text-accent" : ""}`}>Status{picked.length ? ` · ${picked.length}` : ""}</span>}
      >
        {() => (
          <div className="flex flex-col gap-1">
            {statusLabels.map((l) => (
              <label key={l.key} className="flex items-center gap-2 rounded-md px-1 py-0.5 hover:bg-surface-2">
                <input
                  type="checkbox"
                  className="size-4 accent-[var(--accent)]"
                  checked={picked.includes(l.key)}
                  onChange={(e) => go({ status: (e.target.checked ? [...picked, l.key] : picked.filter((k) => k !== l.key)).join(",") || undefined })}
                />
                <LabelChip label={l} className="flex-1" />
              </label>
            ))}
          </div>
        )}
      </Popover>

      {groups.length > 1 && (
        <select aria-label="Group" value={search.group ?? ""} onChange={(e) => go({ group: e.target.value || undefined })} className="input w-auto py-1.5">
          <option value="">Group: all</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
      )}

      <Popover label="Date filter" className="" buttonClassName="flex" panelClassName="w-60" trigger={<span className={`btn py-1.5 ${search.from || search.to ? "border-accent text-accent" : ""}`}>Dates</span>}>
        {(close) => (
          <form
            className="flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              go({ from: String(fd.get("from") || "") || undefined, to: String(fd.get("to") || "") || undefined });
              close();
            }}
          >
            <p className="text-xs text-muted">Items whose timeline overlaps these dates.</p>
            <label className="flex flex-col gap-1 text-xs font-semibold">
              From
              <input type="date" name="from" defaultValue={search.from} className="input py-1 font-normal" />
            </label>
            <label className="flex flex-col gap-1 text-xs font-semibold">
              To
              <input type="date" name="to" defaultValue={search.to} className="input py-1 font-normal" />
            </label>
            <button className="btn btn-primary self-end px-2 py-1 text-xs">Apply</button>
          </form>
        )}
      </Popover>

      <select aria-label="Sort" value={search.sort ?? ""} onChange={(e) => go({ sort: e.target.value || undefined, dir: e.target.value ? search.dir : undefined })} className="input w-auto py-1.5">
        <option value="">Sort: manual</option>
        {sortable.map((c) => (
          <option key={c.key} value={c.key}>
            Sort: {c.title}
          </option>
        ))}
      </select>
      {search.sort && (
        <button type="button" className="btn py-1.5" aria-label={search.dir === "desc" ? "Sort ascending" : "Sort descending"} onClick={() => go({ dir: search.dir === "desc" ? undefined : "desc" })}>
          {search.dir === "desc" ? "↓" : "↑"}
        </button>
      )}

      <select aria-label="Group by" value={search.groupBy ?? ""} onChange={(e) => go({ groupBy: e.target.value || undefined })} className="input w-auto py-1.5">
        <option value="">Group by: groups</option>
        <option value="status">Group by: status</option>
        <option value="priority">Group by: priority</option>
        <option value="person">Group by: person</option>
      </select>

      <Popover label="Columns" className="" buttonClassName="flex" align="right" panelClassName="w-64" trigger={<span className="btn py-1.5">Columns</span>}>
        {() => <ColumnsManager columns={columns} manage={manage} personalHidden={hidden} onPersonal={(keys) => go({ hide: keys.join(",") || undefined })} />}
      </Popover>

      {filtered && (
        <button type="button" className="text-[13px] font-semibold text-accent" onClick={() => go({ q: undefined, person: undefined, status: undefined, group: undefined, from: undefined, to: undefined })}>
          Clear filters
        </button>
      )}
    </div>
  );
}
