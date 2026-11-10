"use client";

import { useState } from "react";
import { labelsOf } from "@/lib/boards/columns";
import { dayNum, fromDay } from "@/lib/boards/dependency-rules";
import type { CellCtx } from "./cells";
import { Faces, Popover, shortDate } from "./ui";
import type { Column, ItemRow, Person } from "./types";

const WEEKS = 8;
const dow = (n: number) => new Date(n * 86_400_000).getUTCDay();
const workday = (n: number) => dow(n) !== 0 && dow(n) !== 6;

type Share = { item: ItemRow; hours: number };

/**
 * Workload: estimated hours per person per week for items that aren't done.
 * An item's estimate is split evenly over its working days and over its
 * assignees. Capacity is per person per week (pick 20/32/40 h).
 */
export function WorkloadView({ items, ctx, statusColumn }: { items: ItemRow[]; ctx: CellCtx; statusColumn: Column | undefined }) {
  const [offset, setOffset] = useState(0);
  const [capacity, setCapacity] = useState(40);
  const done = new Set(labelsOf(statusColumn?.settings).filter((l) => l.category === "done").map((l) => l.key));
  const open = items.filter((i) => !i.completedAt && !done.has(i.statusKey ?? ""));

  const today = dayNum(ctx.today);
  const monday = today - ((dow(today) + 6) % 7) + offset * 7;
  const weeks = Array.from({ length: WEEKS }, (_, k) => monday + k * 7);
  const weekOf = (n: number) => Math.floor((n - monday) / 7);

  // person id ("" = unassigned) → week index → shares
  const grid = new Map<string, Share[][]>();
  const undated = new Map<string, ItemRow[]>();
  const add = (pid: string, w: number, item: ItemRow, hours: number) => {
    if (w < 0 || w >= WEEKS) return;
    const rows = grid.get(pid) ?? Array.from({ length: WEEKS }, () => []);
    const hit = rows[w].find((s) => s.item.id === item.id);
    if (hit) hit.hours += hours;
    else rows[w].push({ item, hours });
    grid.set(pid, rows);
  };
  for (const i of open) {
    const owners = i.assignees.length ? i.assignees : [""];
    const s = i.startOn ?? i.dueOn;
    const d = i.dueOn ?? i.startOn;
    if (!s || !d) {
      for (const p of owners) undated.set(p, [...(undated.get(p) ?? []), i]);
      continue;
    }
    const days = Array.from({ length: dayNum(d) - dayNum(s) + 1 }, (_, k) => dayNum(s) + k);
    const work = days.filter(workday);
    const spread = work.length ? work : days;
    const per = (i.estimateHours ?? 0) / spread.length / owners.length;
    for (const p of owners) for (const n of spread) add(p, weekOf(n), i, per);
  }

  const people: (Person & { unassigned?: boolean })[] = [
    ...ctx.people.filter((p) => grid.has(p.id) || undated.has(p.id)),
    ...(grid.has("") || undated.has("") ? [{ id: "", name: "Unassigned", avatarKey: null, unassigned: true }] : []),
  ];
  const fmt = (h: number) => (h >= 10 ? Math.round(h).toString() : h.toFixed(1).replace(/\.0$/, ""));
  const tone = (pct: number) => (pct > 100 ? { cls: "bg-bad-soft text-bad", note: "Over capacity" } : pct >= 80 ? { cls: "bg-warn-soft text-warn", note: "Nearly full" } : pct > 0 ? { cls: "bg-ok-soft text-ok", note: "OK" } : { cls: "text-muted", note: "Free" });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 text-[13px]">
        <button type="button" className="btn px-2.5" aria-label="Earlier weeks" onClick={() => setOffset((o) => o - 4)}>
          ‹
        </button>
        <button type="button" className="btn" onClick={() => setOffset(0)}>
          This week
        </button>
        <button type="button" className="btn px-2.5" aria-label="Later weeks" onClick={() => setOffset((o) => o + 4)}>
          ›
        </button>
        <label className="flex items-center gap-2">
          <span className="text-muted">Capacity</span>
          <select className="input w-auto py-1" value={capacity} onChange={(e) => setCapacity(Number(e.target.value))} aria-label="Capacity per person per week">
            {[20, 32, 40].map((c) => (
              <option key={c} value={c}>
                {c} h / week
              </option>
            ))}
          </select>
        </label>
        <span className="flex flex-wrap items-center gap-2 text-xs text-muted">
          <span className="pill bg-ok-soft text-ok">≤ 80%</span>
          <span className="pill bg-warn-soft text-warn">80–100%</span>
          <span className="pill bg-bad-soft text-bad">! over 100%</span>
          Open items only; estimates split over working days and assignees.
        </span>
      </div>

      <div className="relative overflow-x-auto rounded-xl border border-line bg-surface">
        <table className="w-full min-w-[760px] border-collapse text-[13px]" aria-label="Workload per person and week">
          <thead>
            <tr>
              <th scope="col" className="sticky left-0 z-10 border-b border-r border-line bg-surface px-3 py-2 text-left text-xs font-semibold text-muted">
                Person
              </th>
              {weeks.map((w) => (
                <th key={w} scope="col" className={`border-b border-line px-2 py-2 text-center text-xs font-semibold ${w <= today && today < w + 7 ? "text-accent" : "text-muted"}`}>
                  {shortDate(fromDay(w))}
                </th>
              ))}
              <th scope="col" className="border-b border-l border-line px-2 py-2 text-center text-xs font-semibold text-muted">
                No dates
              </th>
            </tr>
          </thead>
          <tbody>
            {people.map((p) => {
              const rows = grid.get(p.id) ?? Array.from({ length: WEEKS }, () => [] as Share[]);
              const nd = undated.get(p.id) ?? [];
              return (
                <tr key={p.id || "none"}>
                  <th scope="row" className="sticky left-0 z-10 border-b border-r border-line bg-surface px-3 py-1.5 text-left font-semibold">
                    <span className="flex items-center gap-2">
                      {!p.unassigned && <Faces ids={[p.id]} people={ctx.people} size={22} />}
                      <span className={`truncate ${p.unassigned ? "text-muted" : ""}`}>{p.name}</span>
                    </span>
                  </th>
                  {rows.map((shares, w) => {
                    const hours = shares.reduce((a, s) => a + s.hours, 0);
                    const pct = p.unassigned ? 0 : (hours / capacity) * 100;
                    const t = p.unassigned ? { cls: hours ? "bg-surface-2" : "text-muted", note: "Unassigned" } : tone(pct);
                    return (
                      <td key={w} className="border-b border-line p-1 text-center">
                        {shares.length ? (
                          <Popover
                            label={`${p.name}, week of ${shortDate(fromDay(weeks[w]))}: ${fmt(hours)} h — ${t.note}`}
                            className=""
                            panelClassName="w-72"
                            buttonClassName={`w-full rounded-md px-1 py-1.5 font-semibold tabular-nums ${t.cls}`}
                            trigger={
                              <>
                                {pct > 100 ? "! " : ""}
                                {fmt(hours)} h<span className="block text-[10px] font-normal opacity-80">{shares.length} item{shares.length === 1 ? "" : "s"}</span>
                              </>
                            }
                          >
                            {() => (
                              <ul className="flex flex-col gap-1">
                                {shares
                                  .sort((a, b) => b.hours - a.hours)
                                  .map((s) => (
                                    <li key={s.item.id}>
                                      <button type="button" onClick={() => ctx.openItem(s.item)} className="flex w-full gap-2 rounded px-1.5 py-1 text-left hover:bg-surface-2">
                                        <span className="min-w-0 flex-1 truncate">{s.item.name}</span>
                                        <span className="tabular-nums text-muted">{fmt(s.hours)} h</span>
                                      </button>
                                    </li>
                                  ))}
                              </ul>
                            )}
                          </Popover>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                    );
                  })}
                  <td className="border-b border-l border-line p-1 text-center">
                    {nd.length ? (
                      <Popover label={`${p.name}: ${nd.length} open items without dates`} className="" panelClassName="w-64" buttonClassName="w-full rounded-md px-1 py-1.5 text-muted hover:bg-surface-2" trigger={`${nd.length}`}>
                        {() => (
                          <ul className="flex flex-col gap-1">
                            {nd.map((i) => (
                              <li key={i.id}>
                                <button type="button" onClick={() => ctx.openItem(i)} className="w-full truncate rounded px-1.5 py-1 text-left hover:bg-surface-2">
                                  {i.name}
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                      </Popover>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {!people.length && (
              <tr>
                <td colSpan={WEEKS + 2} className="px-4 py-10 text-center text-muted">
                  No open items with people on them.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
