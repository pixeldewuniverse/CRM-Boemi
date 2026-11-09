/**
 * Server-rendered column chart (single or stacked series).
 * Marks follow the dataviz spec: ≤24px columns, 4px rounded top, 2px surface
 * gap between stacked segments, hairline solid gridlines, legend for ≥2
 * series, hover/focus tooltip, and a table view for exact values.
 */
export type Series = { name: string; color: "c1" | "c2" | "c3" | "c4"; values: number[] };

const FILL = { c1: "bg-c1", c2: "bg-c2", c3: "bg-c3", c4: "bg-c4" } as const;

function niceMax(v: number) {
  if (v <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(v));
  const step = [1, 2, 2.5, 5, 10].find((m) => m * pow >= v / 4)! * pow;
  return Math.ceil(v / step) * step;
}

export function ColumnChart({
  categories,
  series,
  format,
  height = 200,
  highlightLast = false,
  caption,
}: {
  categories: string[];
  series: Series[];
  format: (n: number) => string;
  height?: number;
  /** Mark the last category as "in progress" (e.g. the current month). */
  highlightLast?: boolean;
  caption: string;
}) {
  const totals = categories.map((_, i) => series.reduce((s, x) => s + (x.values[i] ?? 0), 0));
  const max = niceMax(Math.max(...totals, 0));
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);

  return (
    <figure className="min-w-0">
      {series.length > 1 && (
        <figcaption className="mb-5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
          {series.map((s) => (
            <span key={s.name} className="inline-flex items-center gap-1.5">
              <span className={`size-2.5 rounded-sm ${FILL[s.color]}`} aria-hidden="true" />
              {s.name}
            </span>
          ))}
        </figcaption>
      )}

      <div className="flex gap-2" aria-hidden="true">
        {/* y axis */}
        <div className="relative w-14 shrink-0 text-right text-[11px] text-muted" style={{ height }}>
          {ticks.map((t) => (
            <span key={t} className="absolute right-0 -translate-y-1/2" style={{ bottom: `${(t / max) * 100}%` }}>
              {format(t)}
            </span>
          ))}
        </div>

        <div className="relative min-w-0 flex-1" style={{ height }}>
          {ticks.map((t) => (
            <div
              key={t}
              className="absolute inset-x-0 border-t border-line"
              style={{ bottom: `${(t / max) * 100}%` }}
            />
          ))}
          <div className="absolute inset-0 flex items-end">
            {categories.map((cat, i) => {
              const last = highlightLast && i === categories.length - 1;
              return (
                <div
                  key={cat}
                  tabIndex={0}
                  className="group relative flex h-full min-w-0 flex-1 cursor-default flex-col items-center justify-end px-px outline-none"
                >
                  <div className="flex w-full max-w-6 flex-col-reverse gap-[2px]" style={{ height: `${(totals[i] / max) * 100}%` }}>
                    {series.map((s, si) => {
                      const v = s.values[i] ?? 0;
                      if (!v) return null;
                      const top = series.slice(si + 1).every((x) => !(x.values[i] ?? 0));
                      return (
                        <div
                          key={s.name}
                          className={`w-full ${FILL[s.color]} ${top ? "rounded-t" : ""} ${last ? "opacity-60" : ""}`}
                          style={{ flexGrow: v, flexBasis: 0 }}
                        />
                      );
                    })}
                  </div>
                  {/* tooltip */}
                  <div className="pointer-events-none absolute bottom-full z-10 mb-1 hidden min-w-40 rounded-lg border border-line bg-surface p-2.5 text-xs shadow-panel group-hover:block group-focus-visible:block">
                    <p className="mb-1 font-semibold">
                      {cat}
                      {last ? " (to date)" : ""}
                    </p>
                    {series.map((s) => (
                      <p key={s.name} className="flex items-center justify-between gap-3">
                        <span className="inline-flex items-center gap-1.5 text-muted">
                          <span className={`size-2 rounded-sm ${FILL[s.color]}`} />
                          {s.name}
                        </span>
                        <span className="tabular-nums">{format(s.values[i] ?? 0)}</span>
                      </p>
                    ))}
                    {series.length > 1 && (
                      <p className="mt-1 flex justify-between border-t border-line pt-1 font-semibold">
                        <span>Total</span>
                        <span className="tabular-nums">{format(totals[i])}</span>
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <div className="ml-16 mt-1.5 flex text-[11px] text-muted" aria-hidden="true">
        {categories.map((c) => (
          <span key={c} className="flex-1 truncate text-center">
            {c}
          </span>
        ))}
      </div>

      <details className="mt-3 text-xs">
        <summary className="cursor-pointer text-muted hover:text-fg">Show as table</summary>
        <div className="mt-2 overflow-x-auto">
          <table className="tbl text-xs">
            <caption className="sr-only">{caption}</caption>
            <thead>
              <tr>
                <th scope="col">Period</th>
                {series.map((s) => (
                  <th key={s.name} scope="col" className="num">
                    {s.name}
                  </th>
                ))}
                {series.length > 1 && <th scope="col" className="num">Total</th>}
              </tr>
            </thead>
            <tbody>
              {categories.map((c, i) => (
                <tr key={c}>
                  <th scope="row" className="font-semibold text-fg">{c}</th>
                  {series.map((s) => (
                    <td key={s.name} className="num">
                      {format(s.values[i] ?? 0)}
                    </td>
                  ))}
                  {series.length > 1 && <td className="num font-semibold">{format(totals[i])}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
      <span className="sr-only">{caption}. Exact values are in the table.</span>
    </figure>
  );
}

/** Horizontal bars for ranked categories (one series). */
export function BarList({
  rows,
  format,
  color = "c1",
}: {
  rows: { label: string; value: number; hint?: string }[];
  format: (n: number) => string;
  color?: Series["color"];
}) {
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <ul className="flex flex-col gap-3">
      {rows.map((r) => (
        <li key={r.label} className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-3 text-[13px]">
          <span className="truncate" title={r.label}>
            {r.label}
          </span>
          <span className="h-3 overflow-hidden rounded-r bg-transparent">
            <span
              className={`block h-full rounded-r ${FILL[color]}`}
              style={{ width: `${Math.max((r.value / max) * 100, r.value ? 1 : 0)}%`, maxWidth: "100%" }}
            />
          </span>
          <span className="whitespace-nowrap text-right tabular-nums">
            {format(r.value)}
            {r.hint && <span className="ml-1.5 text-muted">{r.hint}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}
