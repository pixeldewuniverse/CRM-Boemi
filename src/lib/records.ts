import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { CurrentUser } from "./auth";
import { customerScope } from "./customers";
import { canEditOwned } from "./permissions";
import { ownedBy } from "./scope";

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** An account the user can see; `editable` when they own it or manage. */
export async function loadAccount(user: CurrentUser, accountId: string) {
  const [acc] = await getDb()
    .select({ id: schema.customers.id, name: schema.customers.name, segment: schema.customers.businessType, ownerId: schema.customers.ownerId })
    .from(schema.customers)
    .where(and(eq(schema.customers.id, accountId), customerScope(user)));
  return acc ? { ...acc, editable: canEditOwned(user, acc.ownerId) } : null;
}

export async function loadQuotation(user: CurrentUser, id: string) {
  const q = schema.quotations;
  const [row] = await getDb()
    .select({ quote: q, account: schema.customers.name, segment: schema.customers.businessType, accountOwner: schema.customers.ownerId })
    .from(q)
    .innerJoin(schema.customers, eq(schema.customers.id, q.customerId))
    .where(and(eq(q.id, id), ownedBy(user, q.ownerId)));
  return row ? { ...row, editable: canEditOwned(user, row.quote.ownerId) } : null;
}

export async function loadOrder(user: CurrentUser, id: string) {
  const o = schema.orders;
  const [row] = await getDb()
    .select({ order: o, account: schema.customers.name, segment: schema.customers.businessType })
    .from(o)
    .innerJoin(schema.customers, eq(schema.customers.id, o.customerId))
    .where(and(eq(o.id, id), ownedBy(user, o.salesId)));
  return row ? { ...row, editable: canEditOwned(user, row.order.salesId) } : null;
}

/** paid_amount and payment_status always follow the recorded payments. */
export async function recalcPayments(tx: Tx | Db, orderId: string) {
  const [sum] = await tx
    .select({ paid: sql<number>`coalesce(sum(${schema.orderPayments.amount}), 0)`.mapWith(Number) })
    .from(schema.orderPayments)
    .where(eq(schema.orderPayments.orderId, orderId));
  const [order] = await tx.select({ total: schema.orders.total }).from(schema.orders).where(eq(schema.orders.id, orderId));
  const paid = sum?.paid ?? 0;
  const status = paid <= 0 ? "unpaid" : paid >= (order?.total ?? 0) ? "paid" : "deposit";
  await tx.update(schema.orders).set({ paidAmount: paid, paymentStatus: status }).where(eq(schema.orders.id, orderId));
  return { paid, status };
}
