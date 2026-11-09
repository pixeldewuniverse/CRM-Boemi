/**
 * Price tiers: retail price × tier factor, rounded to Rp 100.
 * Tier is chosen automatically from the account segment.
 */
export const PRICE_TIERS = {
  retail: { label: "Retail", factor: 1 },
  reseller: { label: "Reseller", factor: 0.78 },
  hotel: { label: "Hotel & Spa", factor: 0.68 },
  corporate: { label: "Corporate", factor: 0.85 },
} as const;

export type PriceTier = keyof typeof PRICE_TIERS;

export const SEGMENT_TIER: Record<string, PriceTier> = {
  "Hotel & Spa": "hotel",
  "Retail Partner": "reseller",
  "Corporate Gift": "corporate",
  "Online & Event": "retail",
};

export const PPN_RATE = 0.11;

export function tierForSegment(segment: string | null | undefined): PriceTier {
  return (segment && SEGMENT_TIER[segment]) || "retail";
}

export function unitPrice(retailPrice: number, tier: PriceTier): number {
  return Math.round((retailPrice * PRICE_TIERS[tier].factor) / 100) * 100;
}

export function lineTotals(
  lines: { subtotal: number }[],
  discountPct = 0,
  ppn = true,
): { subtotal: number; discount: number; taxAmount: number; total: number } {
  const subtotal = lines.reduce((s, l) => s + l.subtotal, 0);
  const discount = Math.round((subtotal * discountPct) / 100);
  const taxAmount = ppn ? Math.round((subtotal - discount) * PPN_RATE) : 0;
  return { subtotal, discount, taxAmount, total: subtotal - discount + taxAmount };
}
