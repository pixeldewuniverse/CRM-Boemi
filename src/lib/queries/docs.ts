import "server-only";
import { and, asc, eq, notInArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { CurrentUser } from "@/lib/auth";
import { customerScope } from "@/lib/customers";
import { canSell, discountLimitFor } from "@/lib/permissions";
import { ownedBy } from "@/lib/scope";
import { getSetting } from "@/lib/settings";

/**
 * Everything the quotation / order forms need, scoped to the user:
 * accounts with their segment (→ price tier), open deals, the product list
 * and the document settings. Returns null for roles that can't sell.
 */
export async function docFormOptions(user: CurrentUser, accountId?: string) {
  if (!canSell(user)) return null;
  const db = getDb();
  const c = schema.customers;
  const o = schema.opportunities;
  const [accounts, deals, products, quote, order] = await Promise.all([
    db
      .select({ value: c.id, label: c.name, segment: c.businessType })
      .from(c)
      .where(and(customerScope(user), accountId ? eq(c.id, accountId) : undefined))
      .orderBy(asc(c.name)),
    db
      .select({ value: o.id, label: o.title, accountId: o.customerId })
      .from(o)
      .where(and(ownedBy(user, o.ownerId), notInArray(o.stage, ["won", "lost"]), accountId ? eq(o.customerId, accountId) : undefined))
      .orderBy(asc(o.title)),
    db
      .select({
        id: schema.products.id,
        sku: schema.products.sku,
        name: schema.products.name,
        variant: schema.products.variant,
        unit: schema.products.unit,
        price: schema.products.price,
        active: schema.products.active,
      })
      .from(schema.products)
      .orderBy(asc(schema.products.category), asc(schema.products.name)),
    getSetting("quotation"),
    getSetting("order"),
  ]);
  return {
    accounts,
    deals,
    products: products.map((p) => ({ ...p, price: p.price ?? 0 })),
    discountLimit: discountLimitFor(user, quote.salesDiscountLimit),
    defaultTerms: quote.terms,
    defaultDepositPct: order.defaultDepositPct,
  };
}
