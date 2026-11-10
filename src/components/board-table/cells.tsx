"use client";

import { useState } from "react";
import { labelsOf, type FileValue, type LinkValue } from "@/lib/boards/columns";
import { Faces, LabelChip, Popover, rangeLabel, shortDate } from "./ui";
import type { Column, ItemRow, Opt, Person } from "./types";

export type CellCtx = {
  /** Today in Asia/Jakarta (yyyy-mm-dd), from the server. */
  today: string;
  people: Person[];
  accounts: Opt[];
  deals: Opt[];
  /** Items of the board for the dependency picker. */
  itemOptions: () => { id: string; name: string }[];
  editable: (item: ItemRow) => boolean;
  manage: boolean;
  save: (item: ItemRow, field: string, value: unknown, patch: Partial<ItemRow>) => void;
  upload: (item: ItemRow, key: string, file: File) => void;
  removeFile: (item: ItemRow, key: string, fileKey: string) => void;
  addDep: (item: ItemRow, predecessorId: string, type: string, lagDays: number) => void;
  removeDep: (item: ItemRow, predecessorId: string) => void;
  editLabels: (column: Column) => void;
  openItem: (item: ItemRow) => void;
};

const fmtNumber = (n: number, s: Record<string, unknown>) => `${s.prefix ? `${s.prefix} ` : ""}${n.toLocaleString("en-US")}${s.unit ? ` ${s.unit}` : ""}`;

/** Inline text/number editor that saves on Enter or blur. */
function InlineInput({
  value,
  onSave,
  type = "text",
  label,
  disabled,
  display,
  className = "",
}: {
  value: string;
  onSave: (v: string) => void;
  type?: "text" | "number" | "date";
  label: string;
  disabled: boolean;
  display?: React.ReactNode;
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  if (!editing || disabled) {
    return (
      <button type="button" disabled={disabled} aria-label={label} onClick={() => setEditing(true)} className={`h-full w-full min-w-0 truncate px-2 text-left disabled:cursor-default ${className}`}>
        {display ?? (value || <span className="text-muted">—</span>)}
      </button>
    );
  }
  return (
    <input
      autoFocus
      aria-label={label}
      type={type}
      inputMode={type === "number" ? "decimal" : undefined}
      defaultValue={value}
      className="h-full w-full min-w-0 rounded border border-accent bg-surface px-2 text-[13px] outline-none"
      onBlur={(e) => {
        setEditing(false);
        if (e.currentTarget.value !== value) onSave(e.currentTarget.value);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") setEditing(false);
      }}
    />
  );
}

function LabelPicker({ column, current, onPick, close, ctx, multi }: { column: Column; current: string[]; onPick: (keys: string[]) => void; close: () => void; ctx: CellCtx; multi?: boolean }) {
  const labels = labelsOf(column.settings);
  return (
    <div className="flex flex-col gap-1">
      {labels.map((l) => {
        const on = current.includes(l.key);
        return (
          <button
            key={l.key}
            type="button"
            onClick={() => {
              if (multi) onPick(on ? current.filter((k) => k !== l.key) : [...current, l.key]);
              else {
                onPick(on ? [] : [l.key]);
                close();
              }
            }}
            className={`rounded-md p-0.5 ${on ? "ring-2 ring-accent" : ""}`}
          >
            <LabelChip label={l} className="w-full py-1" />
          </button>
        );
      })}
      {ctx.manage && (
        <button
          type="button"
          className="mt-1 rounded-md px-2 py-1 text-left text-xs text-accent hover:bg-surface-2"
          onClick={() => {
            close();
            ctx.editLabels(column);
          }}
        >
          Edit labels…
        </button>
      )}
    </div>
  );
}

export function PeoplePicker({ people, current, onChange }: { people: Person[]; current: string[]; onChange: (ids: string[]) => void }) {
  const [q, setQ] = useState("");
  const list = people.filter((p) => p.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="flex flex-col gap-1">
      <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search people" aria-label="Search people" className="input py-1" />
      <ul className="max-h-56 overflow-y-auto">
        {list.map((p) => (
          <li key={p.id}>
            <label className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-surface-2">
              <input type="checkbox" checked={current.includes(p.id)} onChange={(e) => onChange(e.target.checked ? [...current, p.id] : current.filter((x) => x !== p.id))} className="size-4 accent-[var(--accent)]" />
              <Faces ids={[p.id]} people={people} size={20} />
              <span className="truncate">{p.name}</span>
            </label>
          </li>
        ))}
        {!list.length && <li className="px-1.5 py-1 text-muted">Nobody found.</li>}
      </ul>
    </div>
  );
}

function DateRange({ start, due, onSave, close }: { start: string | null; due: string | null; onSave: (v: { start: string | null; due: string | null }) => void; close: () => void }) {
  const [a, setA] = useState(start ?? "");
  const [b, setB] = useState(due ?? "");
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        onSave({ start: a || null, due: b || null });
        close();
      }}
    >
      <label className="flex flex-col gap-1 text-xs font-semibold">
        Start
        <input type="date" value={a} onChange={(e) => setA(e.target.value)} className="input py-1 font-normal" />
      </label>
      <label className="flex flex-col gap-1 text-xs font-semibold">
        Due
        <input type="date" value={b} min={a || undefined} onChange={(e) => setB(e.target.value)} className="input py-1 font-normal" />
      </label>
      <div className="flex justify-between gap-2">
        <button
          type="button"
          className="btn px-2 py-1 text-xs"
          onClick={() => {
            onSave({ start: null, due: null });
            close();
          }}
        >
          Clear
        </button>
        <button type="submit" className="btn btn-primary px-2 py-1 text-xs">
          Save
        </button>
      </div>
    </form>
  );
}

/** One cell of the table (or one field in the item panel). */
export function Cell({ column, item, ctx }: { column: Column; item: ItemRow; ctx: CellCtx }) {
  const can = ctx.editable(item);
  const s = column.settings ?? {};
  const val = item.values?.[column.key];
  const save = (field: string, value: unknown, patch: Partial<ItemRow> = {}) => ctx.save(item, field, value, patch);
  const custom = (value: unknown) => save(`v:${column.key}`, value, { values: { ...item.values, [column.key]: value } as Record<string, unknown> });

  switch (column.type) {
    case "name":
      return <InlineInput value={item.name} label={`Rename ${item.name}`} disabled={!can} onSave={(v) => v.trim() && save("name", v.trim(), { name: v.trim() })} className="font-medium" />;

    case "status":
    case "priority": {
      const isSystem = column.isSystem;
      const key = isSystem ? (column.type === "status" ? item.statusKey : item.priority) : (val as string | null);
      const labels = labelsOf(s);
      const field = isSystem ? column.type : `v:${column.key}`;
      return (
        <Popover label={`${column.title}: ${labels.find((l) => l.key === key)?.label ?? "none"}`} disabled={!can} trigger={<LabelChip label={labels.find((l) => l.key === key)} className="w-full py-1" />}>
          {(close) => (
            <LabelPicker
              column={column}
              current={key ? [key] : []}
              ctx={ctx}
              close={close}
              onPick={([k]) => {
                const next = k ?? null;
                if (!isSystem) custom(next);
                else save(field, next, column.type === "status" ? { statusKey: next } : { priority: next });
              }}
            />
          )}
        </Popover>
      );
    }

    case "people": {
      const ids = column.isSystem ? item.assignees : Array.isArray(val) ? (val as string[]) : [];
      return (
        <Popover label={`${column.title}: ${ids.length} people`} disabled={!can} trigger={<Faces ids={ids} people={ctx.people} />}>
          {() => <PeoplePicker people={ctx.people} current={ids} onChange={(next) => (column.isSystem ? save("people", next, { assignees: next }) : custom(next))} />}
        </Popover>
      );
    }

    case "timeline": {
      const label = rangeLabel(item.startOn, item.dueOn);
      const late = item.dueOn && !item.completedAt && item.dueOn < ctx.today;
      return (
        <Popover
          label={`Timeline: ${label || "not set"}`}
          disabled={!can}
          trigger={label ? <span className={`w-full truncate rounded-full px-2 py-0.5 text-center text-xs font-semibold ${late ? "bg-bad-soft text-bad" : "bg-accent-soft text-accent"}`}>{item.isMilestone ? "◆ " : ""}{label}</span> : <span className="text-muted">—</span>}
        >
          {(close) => <DateRange start={item.startOn} due={item.dueOn} close={close} onSave={(v) => save("timeline", v, { startOn: v.start, dueOn: v.due })} />}
        </Popover>
      );
    }

    case "estimate_hours":
      return (
        <InlineInput
          type="number"
          label={`Estimate for ${item.name}`}
          disabled={!can}
          value={item.estimateHours != null ? String(item.estimateHours) : ""}
          display={item.estimateHours != null ? <span className="block text-right tabular-nums">{item.estimateHours} h</span> : undefined}
          onSave={(v) => {
            const n = v.trim() === "" ? null : Number(v.replace(",", "."));
            if (n === null || Number.isFinite(n)) save("estimate_hours", n, { estimateHours: n });
          }}
        />
      );

    case "dependency":
      return (
        <Popover
          label={`Depends on: ${item.predecessors.map((p) => p.name).join(", ") || "nothing"}`}
          disabled={!can}
          panelClassName="w-72"
          trigger={item.predecessors.length ? <span className="w-full truncate text-xs">{item.predecessors.map((p) => p.name).join(", ")}</span> : <span className="text-muted">—</span>}
        >
          {() => <DependencyEditor item={item} ctx={ctx} />}
        </Popover>
      );

    case "link_account":
    case "link_deal": {
      const isAcc = column.type === "link_account";
      const opts = isAcc ? ctx.accounts : ctx.deals;
      const current = isAcc ? item.customerId : item.opportunityId;
      const name = isAcc ? item.customerName : item.dealTitle;
      return (
        <Popover label={`${column.title}: ${name ?? "none"}`} disabled={!can} trigger={<span className={`w-full truncate text-xs ${name ? "" : "text-muted"}`}>{name ?? "—"}</span>}>
          {(close) => (
            <select
              autoFocus
              aria-label={column.title}
              className="input"
              value={current ?? ""}
              onChange={(e) => {
                const id = e.target.value || null;
                const label = opts.find((o) => o.value === id)?.label ?? null;
                save(column.type, id, isAcc ? { customerId: id, customerName: label } : { opportunityId: id, dealTitle: label });
                close();
              }}
            >
              <option value="">None</option>
              {opts.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          )}
        </Popover>
      );
    }

    case "text":
      return <InlineInput value={(val as string) ?? ""} label={`${column.title} for ${item.name}`} disabled={!can} onSave={(v) => custom(v.trim() || null)} />;

    case "number":
      return (
        <InlineInput
          type="number"
          label={`${column.title} for ${item.name}`}
          disabled={!can}
          value={val != null ? String(val) : ""}
          display={typeof val === "number" ? <span className="block text-right tabular-nums">{fmtNumber(val, s)}</span> : undefined}
          onSave={(v) => {
            const n = v.trim() === "" ? null : Number(v.replace(/[^\d.-]/g, ""));
            if (n === null || Number.isFinite(n)) custom(n);
          }}
        />
      );

    case "date":
      return <InlineInput type="date" value={(val as string) ?? ""} label={`${column.title} for ${item.name}`} disabled={!can} display={val ? shortDate(val as string) : undefined} onSave={(v) => custom(v || null)} />;

    case "checkbox":
      return (
        <label className="flex h-full w-full items-center justify-center">
          <input type="checkbox" aria-label={`${column.title} for ${item.name}`} disabled={!can} checked={Boolean(val)} onChange={(e) => custom(e.target.checked)} className="size-4 accent-[var(--accent)]" />
        </label>
      );

    case "dropdown": {
      const keys = Array.isArray(val) ? (val as string[]) : [];
      const labels = labelsOf(s);
      return (
        <Popover
          label={`${column.title}: ${keys.length} selected`}
          disabled={!can}
          trigger={
            keys.length ? (
              <span className="flex min-w-0 gap-1 overflow-hidden">
                {keys.map((k) => (
                  <LabelChip key={k} label={labels.find((l) => l.key === k)} />
                ))}
              </span>
            ) : (
              <span className="text-muted">—</span>
            )
          }
        >
          {(close) => <LabelPicker column={column} current={keys} ctx={ctx} close={close} multi onPick={(next) => custom(next)} />}
        </Popover>
      );
    }

    case "long_text": {
      const text = (val as string) ?? "";
      return (
        <Popover label={`${column.title} for ${item.name}`} disabled={!can} panelClassName="w-80" trigger={<span className={`w-full truncate text-xs ${text ? "" : "text-muted"}`}>{text || "—"}</span>}>
          {(close) => <LongText value={text} onSave={(v) => custom(v || null)} close={close} readOnly={!can} />}
        </Popover>
      );
    }

    case "link": {
      const link = val as LinkValue | null;
      return (
        <div className="flex h-full min-w-0 items-center gap-1 px-1.5">
          {link?.url ? (
            <a href={link.url} target="_blank" rel="noopener noreferrer" className="min-w-0 truncate text-xs text-accent underline">
              {link.text || link.url.replace(/^https?:\/\//, "")}
            </a>
          ) : (
            <span className="text-muted">—</span>
          )}
          {can && (
            <Popover label={`Edit ${column.title}`} className="ml-auto h-full w-6 flex-none" trigger={<span className="text-xs text-muted">✎</span>} panelClassName="w-72" align="right">
              {(close) => <LinkEditor value={link} onSave={(v) => custom(v)} close={close} />}
            </Popover>
          )}
        </div>
      );
    }

    case "file": {
      const files = Array.isArray(val) ? (val as FileValue[]) : [];
      return (
        <Popover label={`${column.title}: ${files.length} files`} panelClassName="w-72" trigger={files.length ? <span className="text-xs">📎 {files.length}</span> : <span className="text-muted">—</span>}>
          {() => (
            <div className="flex flex-col gap-1">
              {files.map((f) => (
                <div key={f.key} className="flex items-center gap-2">
                  <a href={`/api/files/${f.key}`} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 truncate text-accent underline">
                    {f.name}
                  </a>
                  {can && (
                    <button type="button" className="text-xs text-bad" aria-label={`Remove ${f.name}`} onClick={() => ctx.removeFile(item, column.key, f.key)}>
                      ✕
                    </button>
                  )}
                </div>
              ))}
              {!files.length && <p className="text-muted">No files.</p>}
              {can && (
                <label className="btn mt-1 justify-center py-1 text-xs">
                  Upload (PDF, image, CSV · max 3.5 MB)
                  <input type="file" className="sr-only" accept=".pdf,.jpg,.jpeg,.png,.webp,.csv,.txt" onChange={(e) => e.target.files?.[0] && ctx.upload(item, column.key, e.target.files[0])} />
                </label>
              )}
            </div>
          )}
        </Popover>
      );
    }

    default:
      return <span className="px-2 text-muted">—</span>;
  }
}

function LongText({ value, onSave, close, readOnly }: { value: string; onSave: (v: string) => void; close: () => void; readOnly: boolean }) {
  const [v, setV] = useState(value);
  return (
    <div className="flex flex-col gap-2">
      <textarea autoFocus readOnly={readOnly} value={v} onChange={(e) => setV(e.target.value)} rows={6} className="input" aria-label="Text" />
      {!readOnly && (
        <button
          type="button"
          className="btn btn-primary self-end px-2 py-1 text-xs"
          onClick={() => {
            onSave(v.trim());
            close();
          }}
        >
          Save
        </button>
      )}
    </div>
  );
}

function LinkEditor({ value, onSave, close }: { value: LinkValue | null; onSave: (v: LinkValue | null) => void; close: () => void }) {
  const [url, setUrl] = useState(value?.url ?? "");
  const [text, setText] = useState(value?.text ?? "");
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(url.trim() ? { url: url.trim(), ...(text.trim() ? { text: text.trim() } : {}) } : null);
        close();
      }}
    >
      <input autoFocus value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" aria-label="Link" className="input py-1" />
      <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Text to show (optional)" aria-label="Link text" className="input py-1" />
      <button type="submit" className="btn btn-primary self-end px-2 py-1 text-xs">
        Save
      </button>
    </form>
  );
}

function DependencyEditor({ item, ctx }: { item: ItemRow; ctx: CellCtx }) {
  const [pick, setPick] = useState("");
  const [type, setType] = useState("FS");
  const [lag, setLag] = useState("0");
  const can = ctx.editable(item);
  const options = ctx.itemOptions().filter((o) => o.id !== item.id && !item.predecessors.some((p) => p.id === o.id));
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-semibold text-muted">{item.name} starts after:</p>
      {item.predecessors.map((p) => (
        <div key={p.id} className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate">{p.name}</span>
          <span className="text-xs text-muted">
            {p.type}
            {p.lagDays ? ` ${p.lagDays > 0 ? "+" : ""}${p.lagDays}d` : ""}
          </span>
          {can && (
            <button type="button" className="text-xs text-bad" aria-label={`Remove dependency on ${p.name}`} onClick={() => ctx.removeDep(item, p.id)}>
              ✕
            </button>
          )}
        </div>
      ))}
      {!item.predecessors.length && <p className="text-muted">No dependencies.</p>}
      {can && (
        <form
          className="flex flex-col gap-1.5 border-t border-line pt-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (pick) ctx.addDep(item, pick, type, Number(lag) || 0);
            setPick("");
          }}
        >
          <select value={pick} onChange={(e) => setPick(e.target.value)} className="input py-1" aria-label="Item it depends on">
            <option value="">Pick an item…</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
          <div className="flex gap-1.5">
            <select value={type} onChange={(e) => setType(e.target.value)} className="input w-auto py-1" aria-label="Dependency type" title="FS = finish→start, SS = start→start, FF = finish→finish, SF = start→finish">
              {["FS", "SS", "FF", "SF"].map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
            <input value={lag} onChange={(e) => setLag(e.target.value)} inputMode="numeric" className="input w-16 py-1" aria-label="Lag in days" title="Lag (days)" />
            <button type="submit" className="btn btn-primary ml-auto px-2 py-1 text-xs" disabled={!pick}>
              Add
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
