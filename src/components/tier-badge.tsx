const STYLES = {
  hot: "bg-hot/15 text-hot",
  warm: "bg-warm/15 text-warm",
  cold: "bg-cold/15 text-cold",
} as const;

export function TierBadge({ tier }: { tier: keyof typeof STYLES | null }) {
  if (!tier) return <span className="text-xs text-muted">—</span>;
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${STYLES[tier]}`}>
      {tier}
    </span>
  );
}
