import type { ReactNode } from "react";

export type StatItem = {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "default" | "bad" | "ok" | "warn";
};

const TONE = { default: "", bad: "text-bad", ok: "text-ok", warn: "text-warn" } as const;

export function Stats({ items, cols = 4 }: { items: StatItem[]; cols?: 2 | 3 | 4 | 5 }) {
  const grid = {
    2: "sm:grid-cols-2",
    3: "sm:grid-cols-3",
    4: "sm:grid-cols-2 lg:grid-cols-4",
    5: "sm:grid-cols-3 lg:grid-cols-5",
  }[cols];
  return (
    <dl className={`grid grid-cols-2 gap-3 ${grid}`}>
      {items.map((s) => (
        <div key={s.label} className="panel min-w-0 p-4">
          <dt className="text-xs text-muted">{s.label}</dt>
          <dd className={`mt-1 truncate text-[22px] font-bold tabular-nums ${TONE[s.tone ?? "default"]}`}>
            {s.value}
          </dd>
          {s.hint && <dd className="mt-0.5 text-xs text-muted">{s.hint}</dd>}
        </div>
      ))}
    </dl>
  );
}
