import "server-only";
import { inArray } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { lineTotals, tierForSegment, unitPrice, type PriceTier } from "./pricing";

/** Line items as posted by the form (a JSON string in the "items" field). */
export const LineInput = z
  .array(
    z.object({
      productId: z.uuid("Choose a product."),
      quantity: z.coerce.number("Enter a quantity.").int("Whole numbers only.").min(1, "At least 1.").max(100_000),
    }),
  )
  .min(1, "Add at least one product.")
  .max(50, "Up to 50 lines.");

export function parseLines(raw: string | undefined): { ok: true; lines: z.infer<typeof LineInput> } | { ok: false; error: string } {
  let json: unknown;
  try {
    json = JSON.parse(raw ?? "[]");
  } catch {
    return { ok: false, error: "Add at least one product." };
  }
  const parsed = LineInput.safeParse(json);
  return parsed.success ? { ok: true, lines: parsed.data } : { ok: false, error: parsed.error.issues[0]?.message ?? "Check the products." };
}

export type PricedLine = { productId: string; quantity: number; unitPrice: number; subtotal: number };

/**
 * Prices lines on the server from the product list and the account's
 * segment (tier). Numbers sent by the browser are never used.
 * `allowInactive` lets an existing document keep a product that was later deactivated.
 */
export async function priceLines(
  lines: { productId: string; quantity: number }[],
  segment: string | null,
  discountPct: number,
  ppn: boolean,
  allowInactive: Set<string> = new Set(),
): Promise<
  | { ok: true; tier: PriceTier; lines: PricedLine[]; subtotal: number; discount: number; taxAmount: number; total: number }
  | { ok: false; error: string }
> {
  const ids = [...new Set(lines.map((l) => l.productId))];
  const products = await getDb()
    .select({ id: schema.products.id, price: schema.products.price, active: schema.products.active, name: schema.products.name })
    .from(schema.products)
    .where(inArray(schema.products.id, ids));
  const byId = new Map(products.map((p) => [p.id, p]));
  const tier = tierForSegment(segment);
  const priced: PricedLine[] = [];
  for (const l of lines) {
    const p = byId.get(l.productId);
    if (!p) return { ok: false, error: "A product in the list no longer exists." };
    if (!p.active && !allowInactive.has(p.id)) return { ok: false, error: `${p.name} is inactive and can't be added.` };
    const unit = unitPrice(p.price ?? 0, tier);
    priced.push({ productId: p.id, quantity: l.quantity, unitPrice: unit, subtotal: unit * l.quantity });
  }
  return { ok: true, tier, lines: priced, ...lineTotals(priced, discountPct, ppn) };
}
