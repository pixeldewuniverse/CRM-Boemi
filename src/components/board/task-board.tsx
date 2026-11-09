"use client";

import Link from "next/link";
import { useOptimistic, useState, useTransition } from "react";
import { moveTask } from "@/app/actions/tasks";
import { daysBetween, fday, initials } from "@/lib/format";
import { TASK_COLUMNS, TASK_STATUS } from "@/lib/labels";
import { Kanban, type KanbanCard } from "./kanban";

export type TaskCard = KanbanCard & {
  type: string | null;
  due: string | null;
  account: string | null;
  accountId: string | null;
  assignee: string | null;
};

export function TaskBoard({ tasks, today }: { tasks: TaskCard[]; today: string }) {
  const [pending, startTransition] = useTransition();
  const [optimistic, apply] = useOptimistic(tasks, (state, m: { id: string; column: string }) =>
    state.map((t) => (t.id === m.id ? { ...t, column: m.column } : t)),
  );
  const [error, setError] = useState<string | null>(null);

  const onDrop = (card: TaskCard, column: string) => {
    setError(null);
    startTransition(async () => {
      apply({ id: card.id, column });
      const res = await moveTask({ taskId: card.id, status: column as (typeof TASK_COLUMNS)[number] });
      if (!res.ok) setError(res.error);
    });
  };

  return (
    <>
      <div className="flex min-h-5 items-center text-[13px]" aria-live="polite">
        {error ? (
          <p role="alert" className="text-bad">
            {error}
          </p>
        ) : pending ? (
          <p className="text-muted">Saving…</p>
        ) : (
          <p className="text-muted">Drag a card to another column to update it.</p>
        )}
      </div>
      <Kanban
        columns={TASK_COLUMNS.map((c) => ({ key: c, label: TASK_STATUS[c].label }))}
        cards={optimistic}
        minWidth={960}
        onDrop={onDrop}
        renderCard={(c) => {
          const done = c.column === "done";
          const days = c.due ? daysBetween(today, c.due) : null;
          const late = !done && days !== null && days < 0;
          const dueToday = !done && days === 0;
          return (
            <article className="panel flex flex-col gap-1.5 p-3 text-[13px]">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-muted">{c.type ?? "Task"}</span>
                <span
                  title={c.assignee ?? ""}
                  className="grid size-6 place-items-center rounded-full bg-accent-soft text-[10px] font-bold text-accent"
                >
                  {initials(c.assignee ?? "?")}
                </span>
              </div>
              <p className={`leading-snug ${done ? "text-muted line-through" : "font-semibold"}`}>{c.title}</p>
              {c.account && (
                <Link href={`/database/accounts/${c.accountId}`} className="truncate text-xs text-muted hover:text-accent">
                  {c.account}
                </Link>
              )}
              <p className={`text-xs ${late ? "font-semibold text-bad" : dueToday ? "font-semibold text-warn" : "text-muted"}`}>
                {done ? `Due ${fday(c.due)}` : late ? `Overdue · ${fday(c.due)}` : dueToday ? "Due today" : `Due ${fday(c.due)}`}
              </p>
            </article>
          );
        }}
      />
    </>
  );
}
