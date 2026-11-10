"use client";

import { colorHex, groupHex, labelsOf } from "@/lib/boards/columns";
import { dayNum } from "@/lib/boards/dependency-rules";
import type { CellCtx } from "./cells";
import { Faces, shortDate } from "./ui";
import type { Column, GroupData, ItemRow } from "./types";

const rp = (n: number) => `Rp ${Math.round(n).toLocaleString("en-US")}`;

function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "bad" | "warn" | "ok" }) {
  const cls = tone === "bad" ? "text-bad" : tone === "warn" ? "text-warn" : tone === "ok" ? "text-ok" : "";
  return (
    <div className="panel flex flex-col gap-0.5 p-4">
      <span className="text-xs font-semibold text-muted">{label}</span>
      <span className={`text-2xl font-bold tabular-nums ${cls}`}>{value}</span>
      {sub && <span className="text-xs text-muted">{sub}</span>}
    </div>
  );
}

function Card({ title, children, className = "" }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`panel flex min-w-0 flex-col gap-3 p-4 ${className}`}>
      <h3 className="font-bold">{title}</h3>
      {children}
    </section>
  );
}

/**
 * Board dashboard: progress, status mix, groups, people, what's due and —
 * for projects — budget. Everything follows the toolbar filters; "done"
 * means a status label in the Done category.
 */
export function DashboardView({
  groups,
  ctx,
  columns,
  project,
}: {
  groups: GroupData[];
  ctx: CellCtx;
  columns: Column[];
  project: { budget: number | null; actualCost: number | null; dueOn: string | null } | null;
}) {
  const status = columns.find((c) => c.key === "status");
  const labels = labelsOf(status?.settings);
  const cat = (i: ItemRow) => labels.find((l) => l.key === i.statusKey)?.category ?? "not_started";
  const items = groups.flatMap((g) => g.items);
  const isDone = (i: ItemRow) => cat(i) === "done";
  const open = items.filter((i) => !isDone(i));
  const today = dayNum(ctx.today);
  const overdue = open.filter((i) => i.dueOn && dayNum(i.dueOn) < today).sort((a, b) => a.dueOn!.localeCompare(b.dueOn!));
  const soon = open.filter((i) => i.dueOn && dayNum(i.dueOn) >= today && dayNum(i.dueOn) <= today + 14).sort((a, b) => a.dueOn!.localeCompare(b.dueOn!));
  const stuck = open.filter((i) => cat(i) === "stuck");
  const pct = items.length ? Math.round(((items.length - open.length) / items.length) * 100) : 0;
  const hoursLeft = open.reduce((a, i) => a + (i.estimateHours ?? 0), 0);
  const hoursAll = items.reduce((a, i) => a + (i.estimateHours ?? 0), 0);
  const milestones = items.filter((i) => i.isMilestone).sort((a, b) => (a.dueOn ?? "").localeCompare(b.dueOn ?? ""));

  const byStatus = labels.map((l) => ({ l, n: items.filter((i) => i.statusKey === l.key).length })).filter((x) => x.n);
  const noStatus = items.filter((i) => !labels.some((l) => l.key === i.statusKey)).length;

  const people = ctx.people
    .map((p) => {
      const mine = items.filter((i) => i.assignees.includes(p.id));
      const o = mine.filter((i) => !isDone(i));
      return { p, open: o.length, late: o.filter((i) => i.dueOn && dayNum(i.dueOn) < today).length, hours: o.reduce((a, i) => a + (i.estimateHours ?? 0) / Math.max(1, i.assignees.length), 0) };
    })
    .filter((x) => x.open)
    .sort((a, b) => b.open - a.open);
  const maxOpen = Math.max(1, ...people.map((x) => x.open));

  // "Rp" number columns = planned spend per item.
  const money = columns.filter((c) => c.type === "number" && String(c.settings.prefix ?? "").toLowerCase() === "rp");
  const planned = money.map((c) => ({ c, sum: items.reduce((a, i) => a + (typeof i.values[c.key] === "number" ? (i.values[c.key] as number) : 0), 0) }));

  const dueList = (list: ItemRow[], empty: string) =>
    list.length ? (
      <ul className="flex flex-col divide-y divide-line">
        {list.slice(0, 8).map((i) => (
          <li key={i.id}>
            <button type="button" onClick={() => ctx.openItem(i)} className="flex w-full items-center gap-2 py-1.5 text-left text-[13px] hover:text-accent">
              <span className="size-2.5 flex-none rounded-full" style={{ background: colorHex(labels.find((l) => l.key === i.statusKey)?.color) }} aria-hidden />
              <span className="min-w-0 flex-1 truncate">
                {i.isMilestone ? "◆ " : ""}
                {i.name}
              </span>
              <Faces ids={i.assignees} people={ctx.people} size={20} max={2} />
              <span className="w-14 text-right text-xs tabular-nums text-muted">{shortDate(i.dueOn)}</span>
            </button>
          </li>
        ))}
        {list.length > 8 && <li className="pt-1.5 text-xs text-muted">+{list.length - 8} more</li>}
      </ul>
    ) : (
      <p className="text-[13px] text-muted">{empty}</p>
    );

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <Tile label="Done" value={`${pct}%`} sub={`${items.length - open.length} of ${items.length} items`} tone={pct === 100 && items.length ? "ok" : undefined} />
        <Tile label="Open items" value={String(open.length)} sub={`${hoursLeft.toLocaleString("en-US")} h of ${hoursAll.toLocaleString("en-US")} h left`} />
        <Tile label="Overdue" value={String(overdue.length)} sub={overdue.length ? "past due, not done" : "nothing late"} tone={overdue.length ? "bad" : undefined} />
        <Tile label="Stuck" value={String(stuck.length)} sub="status in the Stuck category" tone={stuck.length ? "warn" : undefined} />
        <Tile label="Due in 14 days" value={String(soon.length)} sub={project?.dueOn ? `project due ${shortDate(project.dueOn)}` : undefined} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Status">
          {items.length ? (
            <>
              <div className="flex h-3 w-full gap-0.5 overflow-hidden rounded" role="img" aria-label={byStatus.map((x) => `${x.l.label}: ${x.n}`).join(", ")}>
                {byStatus.map((x) => (
                  <span key={x.l.key} title={`${x.l.label}: ${x.n}`} style={{ width: `${(x.n / items.length) * 100}%`, background: colorHex(x.l.color) }} />
                ))}
                {noStatus > 0 && <span title={`No status: ${noStatus}`} className="bg-line" style={{ width: `${(noStatus / items.length) * 100}%` }} />}
              </div>
              <ul className="grid grid-cols-2 gap-x-4 gap-y-1 text-[13px]">
                {byStatus.map((x) => (
                  <li key={x.l.key} className="flex items-center gap-2">
                    <span className="size-2.5 rounded-sm" style={{ background: colorHex(x.l.color) }} aria-hidden />
                    <span className="flex-1">{x.l.label}</span>
                    <span className="tabular-nums text-muted">{x.n}</span>
                  </li>
                ))}
                {noStatus > 0 && (
                  <li className="flex items-center gap-2">
                    <span className="size-2.5 rounded-sm bg-line" aria-hidden />
                    <span className="flex-1">No status</span>
                    <span className="tabular-nums text-muted">{noStatus}</span>
                  </li>
                )}
              </ul>
            </>
          ) : (
            <p className="text-[13px] text-muted">No items.</p>
          )}
        </Card>

        <Card title="Progress per group">
          <ul className="flex flex-col gap-2.5">
            {groups.map((g) => {
              const d = g.items.filter(isDone).length;
              const p = g.items.length ? Math.round((d / g.items.length) * 100) : 0;
              return (
                <li key={g.id} className="flex flex-col gap-1 text-[13px]" title={`${g.name}: ${d} of ${g.items.length} done`}>
                  <span className="flex items-center gap-2">
                    <span className="h-3 w-1 rounded" style={{ background: groupHex(g.color) }} aria-hidden />
                    <span className="flex-1 truncate font-semibold">{g.name}</span>
                    <span className="tabular-nums text-muted">
                      {d}/{g.items.length} · {p}%
                    </span>
                  </span>
                  <span className="h-2 overflow-hidden rounded-full bg-surface-2">
                    <span className="block h-full rounded-full bg-accent" style={{ width: `${p}%` }} />
                  </span>
                </li>
              );
            })}
          </ul>
        </Card>

        <Card title="Open items per person">
          {people.length ? (
            <ul className="flex flex-col gap-2">
              {people.map((x) => (
                <li key={x.p.id} className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-2 text-[13px]" title={`${x.p.name}: ${x.open} open, ${x.late} overdue, ${Math.round(x.hours)} h`}>
                  <span className="flex min-w-0 items-center gap-1.5">
                    <Faces ids={[x.p.id]} people={ctx.people} size={20} />
                    <span className="truncate">{x.p.name}</span>
                  </span>
                  <span className="h-2 overflow-hidden rounded-full bg-surface-2">
                    <span className="block h-full rounded-full bg-accent" style={{ width: `${(x.open / maxOpen) * 100}%` }} />
                  </span>
                  <span className="w-28 text-right text-xs tabular-nums text-muted">
                    {x.open} open{x.late ? <span className="font-semibold text-bad"> · {x.late} late</span> : null}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-muted">Nobody has open items.</p>
          )}
        </Card>

        {project ? (
          <Card title="Budget">
            <dl className="grid grid-cols-2 gap-3 text-[13px]">
              <div>
                <dt className="text-muted">Project budget</dt>
                <dd className="text-lg font-bold tabular-nums">{project.budget ? rp(project.budget) : "—"}</dd>
              </div>
              <div>
                <dt className="text-muted">Spent (actual cost)</dt>
                <dd className="text-lg font-bold tabular-nums">{project.actualCost ? rp(project.actualCost) : "—"}</dd>
              </div>
              {planned.map((x) => (
                <div key={x.c.key} className="col-span-2">
                  <dt className="text-muted">Planned in “{x.c.title}” column</dt>
                  <dd className={`font-semibold tabular-nums ${project.budget && x.sum > project.budget ? "text-bad" : ""}`}>
                    {rp(x.sum)}
                    {project.budget ? <span className="font-normal text-muted"> · {Math.round((x.sum / project.budget) * 100)}% of budget{x.sum > project.budget ? " — over budget" : ""}</span> : null}
                  </dd>
                </div>
              ))}
            </dl>
            {project.budget ? (
              <div className="flex flex-col gap-1 text-xs text-muted">
                <span className="h-2 overflow-hidden rounded-full bg-surface-2" aria-hidden>
                  <span className={`block h-full rounded-full ${(project.actualCost ?? 0) > project.budget ? "bg-bad" : "bg-accent"}`} style={{ width: `${Math.min(100, ((project.actualCost ?? 0) / project.budget) * 100)}%` }} />
                </span>
                {Math.round(((project.actualCost ?? 0) / project.budget) * 100)}% of the budget spent
              </div>
            ) : null}
          </Card>
        ) : (
          <Card title="Milestones">{dueList(milestones, "No milestones on this board.")}</Card>
        )}

        <Card title={`Overdue (${overdue.length})`}>{dueList(overdue, "Nothing is overdue.")}</Card>
        <Card title="Due in the next 14 days">{dueList(soon, "Nothing due in the next two weeks.")}</Card>
        {project && <Card title="Milestones">{dueList(milestones, "No milestones on this board.")}</Card>}
      </div>
    </div>
  );
}
