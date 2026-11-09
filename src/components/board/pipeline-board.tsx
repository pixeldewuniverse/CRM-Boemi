"use client";

import Link from "next/link";
import { useOptimistic, useRef, useState, useTransition } from "react";
import { moveDeal } from "@/app/actions/pipeline";
import { daysBetween, fday, rpk } from "@/lib/format";
import { LOST_REASONS, STAGE, STAGES } from "@/lib/labels";
import { Kanban, type KanbanCard } from "./kanban";

export type DealCard = KanbanCard & {
  value: number;
  close: string | null;
  account: string;
  accountId: string;
  owner: string;
  lostReason: string | null;
};

type Move = { id: string; column: string; lostReason?: string | null };

export function PipelineBoard({ deals, today }: { deals: DealCard[]; today: string }) {
  const [pending, startTransition] = useTransition();
  const [optimistic, apply] = useOptimistic(deals, (state, m: Move) =>
    state.map((d) => (d.id === m.id ? { ...d, column: m.column, lostReason: m.lostReason ?? null } : d)),
  );
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState<DealCard | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);

  const commit = (card: DealCard, column: string, lostReason?: (typeof LOST_REASONS)[number]) => {
    setError(null);
    startTransition(async () => {
      apply({ id: card.id, column, lostReason });
      const res = await moveDeal({ dealId: card.id, stage: column as (typeof STAGES)[number], lostReason });
      if (!res.ok) setError(res.error);
    });
  };

  const onDrop = (card: DealCard, column: string) => {
    if (column === "lost") {
      setAsking(card);
      dialog.current?.showModal();
      return;
    }
    commit(card, column);
  };

  const columns = STAGES.map((s) => {
    const sum = optimistic.filter((d) => d.column === s).reduce((t, d) => t + d.value, 0);
    return { key: s, label: STAGE[s].label, meta: `${rpk(sum)} · ${STAGE[s].probability}%` };
  });

  return (
    <>
      <div className="flex min-h-5 items-center gap-3 text-[13px]" aria-live="polite">
        {error ? (
          <p role="alert" className="text-bad">
            {error}
          </p>
        ) : pending ? (
          <p className="text-muted">Saving…</p>
        ) : (
          <p className="text-muted">Drag a card to another stage to update it.</p>
        )}
      </div>

      <Kanban
        columns={columns}
        cards={optimistic}
        minWidth={1260}
        emptyText="No deals"
        onDrop={onDrop}
        renderCard={(d) => {
          const days = d.close ? daysBetween(today, d.close) : null;
          const late = days !== null && days < 0 && d.column !== "won" && d.column !== "lost";
          return (
            <article className="panel flex flex-col gap-1 p-3 text-[13px]">
              <p className="font-semibold leading-snug">{d.title}</p>
              <Link href={`/database/accounts/${d.accountId}`} className="truncate text-xs text-muted hover:text-accent">
                {d.account}
              </Link>
              <p className="font-bold tabular-nums">{rpk(d.value)}</p>
              <p className="flex justify-between gap-2 text-xs text-muted">
                <span className="truncate">{d.owner}</span>
                <span className={late ? "font-semibold text-bad" : ""}>{fday(d.close)}</span>
              </p>
              {d.column === "lost" && d.lostReason && <p className="text-xs text-bad">{d.lostReason}</p>}
            </article>
          );
        }}
      />

      <dialog
        ref={dialog}
        onClose={() => setAsking(null)}
        className="m-auto w-[min(92vw,26rem)] rounded-xl border border-line bg-surface p-0 text-fg shadow-panel backdrop:bg-black/40"
      >
        <form
          method="dialog"
          className="flex flex-col gap-4 p-5"
          onSubmit={(e) => {
            const reason = new FormData(e.currentTarget).get("reason") as (typeof LOST_REASONS)[number] | null;
            if (asking && reason) commit(asking, "lost", reason);
          }}
        >
          <div>
            <h2 className="text-lg font-bold">Mark as lost</h2>
            <p className="text-[13px] text-muted">{asking?.title}</p>
          </div>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-[13px] font-semibold">Why was it lost?</legend>
            {LOST_REASONS.map((r, i) => (
              <label key={r} className="flex items-center gap-2 text-[13px]">
                <input type="radio" name="reason" value={r} required defaultChecked={i === 0} className="accent-[var(--accent)]" />
                {r}
              </label>
            ))}
          </fieldset>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn" onClick={() => dialog.current?.close()}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary">
              Mark as lost
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
