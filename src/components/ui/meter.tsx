/** Progress toward a target. Over 100% caps the bar and shows the real number. */
export function Meter({
  value,
  max,
  label,
  kind = "progress",
}: {
  value: number;
  max: number;
  label?: string;
  /** "spend": reaching the max is bad (budgets), not good. */
  kind?: "progress" | "spend";
}) {
  const ratio = max > 0 ? value / max : 0;
  const width = Math.min(100, Math.max(0, ratio * 100));
  const tone = kind === "spend" ? (ratio > 1 ? "bg-bad" : ratio >= 0.8 ? "bg-warn" : "bg-accent") : ratio >= 1 ? "bg-ok" : ratio >= 0.6 ? "bg-accent" : "bg-warn";
  return (
    <div className="flex min-w-32 items-center gap-2">
      <div
        className="h-2 flex-1 overflow-hidden rounded-full bg-surface-2"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-label={label}
      >
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${width}%` }} />
      </div>
      <span className="w-11 text-right text-xs font-semibold tabular-nums">{Math.round(ratio * 100)}%</span>
    </div>
  );
}
