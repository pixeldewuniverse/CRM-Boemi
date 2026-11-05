const STYLES = {
  hot: "bg-bad-soft text-bad",
  warm: "bg-warn-soft text-warn",
  cold: "bg-info-soft text-info",
} as const;

export function TierBadge({ tier }: { tier: keyof typeof STYLES | null }) {
  if (!tier) return <span className="text-xs text-muted">—</span>;
  return <span className={`pill capitalize ${STYLES[tier]}`}>{tier}</span>;
}
