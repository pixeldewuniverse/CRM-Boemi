"use client";

import { startTransition, useActionState } from "react";
import { copyLastMonthTargets, saveTargets } from "@/app/actions/targets";
import { initialFormState } from "@/lib/forms";
import { TARGET_METRICS, type TargetMetric } from "@/lib/labels";
import { ActionButton } from "./action-button";

export type TargetRow = {
  id: string;
  name: string;
  region: string | null;
  cells: Record<TargetMetric, { target: number; actual: number }>;
};

const METRICS = Object.keys(TARGET_METRICS) as TargetMetric[];
const fmt = (n: number, money: boolean) => (money ? `Rp ${n.toLocaleString("en-US")}` : n.toLocaleString("en-US"));
const pctTone = (r: number) => (r >= 1 ? "text-ok" : r >= 0.6 ? "text-fg" : "text-warn");

/** Month grid: one row per rep, one input per metric. Saves every cell at once. */
export function TargetGrid({ period, previous, rows }: { period: string; previous: string; rows: TargetRow[] }) {
  const [state, action, pending] = useActionState(saveTargets, initialFormState);
  // Re-mount inputs when saved values change (e.g. after "Copy last month").
  const signature = rows.map((r) => METRICS.map((m) => r.cells[m].target).join(",")).join("|");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        startTransition(() => action(fd));
      }}
      noValidate
    >
      <input type="hidden" name="period" value={period} />
      <div className="relative overflow-x-auto">
        <table className="tbl min-w-[880px]">
          <thead>
            <tr>
              <th>Sales rep</th>
              {METRICS.map((m) => (
                <th key={m} className="num">
                  {TARGET_METRICS[m].label}
                  {TARGET_METRICS[m].money && <span className="font-normal"> (Rp)</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody key={signature}>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  <p className="font-semibold">{r.name}</p>
                  <p className="text-xs text-muted">{r.region}</p>
                </td>
                {METRICS.map((m) => {
                  const key = `t:${r.id}:${m}`;
                  const c = r.cells[m];
                  const err = state.fieldErrors?.[key];
                  const ratio = c.target ? c.actual / c.target : 0;
                  return (
                    <td key={m} className="num">
                      <input
                        name={key}
                        defaultValue={c.target ? (TARGET_METRICS[m].money ? c.target.toLocaleString("id-ID") : String(c.target)) : ""}
                        inputMode="numeric"
                        placeholder="—"
                        aria-label={`${r.name} ${TARGET_METRICS[m].label} target`}
                        aria-invalid={Boolean(err)}
                        className={`input ml-auto max-w-40 text-right ${err ? "border-bad" : ""}`}
                      />
                      <p className="mt-1 text-xs text-muted">
                        Actual {fmt(c.actual, TARGET_METRICS[m].money)}
                        {c.target > 0 && <span className={`ml-1 font-semibold ${pctTone(ratio)}`}>{Math.round(ratio * 100)}%</span>}
                      </p>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <footer className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-3">
        <p className="mr-auto text-xs text-muted">Leave a cell empty for no target. Type amounts as 150.000.000 or 150000000.</p>
        {state.error && (
          <p role="alert" className="text-[13px] text-bad">
            {state.error}
          </p>
        )}
        {state.ok && state.message && (
          <p role="status" className="text-[13px] text-ok">
            {state.message}
          </p>
        )}
        <ActionButton action={copyLastMonthTargets} fields={{ period }} title={`Fill empty cells with ${previous} targets`}>
          Copy last month
        </ActionButton>
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? "Saving…" : "Save targets"}
        </button>
      </footer>
    </form>
  );
}
