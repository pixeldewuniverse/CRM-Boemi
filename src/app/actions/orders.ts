"use server";

import { and, eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { audit } from "@/lib/audit";
import { verifyUser } from "@/lib/auth";
import { fieldErrors, formObject, parseRupiah, type FormState } from "@/lib/forms";
import { rp, ymd } from "@/lib/format";
import { ORDER_FLOW, PAYMENT_METHODS } from "@/lib/labels";
import { parseLines, priceLines } from "@/lib/lines";
import { notify } from "@/lib/notifications";
import { nextDocumentNumber } from "@/lib/numbering";
import { canRecordPayments, canSell, discountLimitFor, isManager } from "@/lib/permissions";
import { loadAccount, loadOrder, recalcPayments } from "@/lib/records";
import { getSetting } from "@/lib/settings";

const Order = z.object({
  customerId: z.uuid("Choose an account."),
  opportunityId: z.uuid().optional(),
  orderedOn: z.iso.date("Pick a date.").optional(),
  status: z.enum(["draft", "confirmed"]).default("confirmed"),
  discountPct: z.coerce.number("Enter a percentage.").min(0, "0–100%.").max(100, "0–100%.").default(0),
  ppn: z.literal("on").optional(),
  depositPct: z.coerce.number().int().min(0, "0–100%.").max(100, "0–100%.").optional(),
  reference: z.string().max(80).optional(),
  notes: z.string().max(2000).optional(),
  items: z.string().optional(),
});

/** Order date in Jakarta, kept at noon so it never slips a day. */
const orderedAt = (date: string) => new Date(`${date}T12:00:00+07:00`);

export async function createOrder(_prev: FormState, fd: FormData): Promise<FormState> {
  const user = await verifyUser();
  if (!canSell(user)) return { ok: false, error: "Your role can't create orders." };
  const parsed = Order.safeParse(formObject(fd));
  if (!parsed.success) return fieldErrors(parsed.error);
  const d = parsed.data;
  const account = await loadAccount(user, d.customerId);
  if (!account) return { ok: false, error: "Account not found.", fieldErrors: { customerId: "Choose one of your accounts." } };
  if (!account.editable) return { ok: false, error: "Only the account owner or a manager can add orders to this account." };
  if (d.opportunityId) {
    const [deal] = await getDb()
      .select({ id: schema.opportunities.id })
      .from(schema.opportunities)
      .where(and(eq(schema.opportunities.id, d.opportunityId), eq(schema.opportunities.customerId, account.id)));
    if (!deal) return { ok: false, error: "That deal belongs to another account.", fieldErrors: { opportunityId: "Choose a deal of this account." } };
  }
  const [quoteSettings, orderSettings] = await Promise.all([getSetting("quotation"), getSetting("order")]);
  const limit = discountLimitFor(user, quoteSettings.salesDiscountLimit);
  if (d.discountPct > limit) {
    return { ok: false, error: `Discounts above ${limit}% need a quotation approved by a manager.`, fieldErrors: { discountPct: `Max ${limit}%.` } };
  }
  const lines = parseLines(d.items);
  if (!lines.ok) return { ok: false, error: lines.error, fieldErrors: { items: lines.error } };
  const priced = await priceLines(lines.lines, account.segment, d.discountPct, Boolean(d.ppn));
  if (!priced.ok) return { ok: false, error: priced.error, fieldErrors: { items: priced.error } };

  const salesId = isManager(user) ? (account.ownerId ?? user.id) : user.id;
  const created = await getDb().transaction(async (tx) => {
    const orderNo = await nextDocumentNumber(tx, "order");
    const [o] = await tx
      .insert(schema.orders)
      .values({
        orderNo,
        customerId: account.id,
        opportunityId: d.opportunityId ?? null,
        salesId,
        status: d.status,
        orderedAt: orderedAt(d.orderedOn ?? ymd(new Date())),
        subtotal: priced.subtotal,
        discountPct: d.discountPct,
        ppn: Boolean(d.ppn),
        taxAmount: priced.taxAmount,
        total: priced.total,
        depositPct: d.depositPct ?? orderSettings.defaultDepositPct,
        channel: account.segment, // sales channel = account segment
        reference: d.reference ?? null,
        notes: d.notes ?? null,
      })
      .returning({ id: schema.orders.id, orderNo: schema.orders.orderNo });
    await tx.insert(schema.orderItems).values(priced.lines.map((l) => ({ ...l, orderId: o.id })));
    if (d.status === "confirmed") {
      await tx.update(schema.customers).set({ status: "active" }).where(and(eq(schema.customers.id, account.id), eq(schema.customers.status, "prospect")));
    }
    return o;
  });
  await audit({ actorId: user.id, action: "create", entity: "order", entityId: created.orderNo, changes: { account: account.name, total: priced.total } });
  refresh();
  redirect(`/sales/orders/${created.id}`);
}

const Details = z.object({
  id: z.uuid(),
  depositPct: z.coerce.number().int().min(0, "0–100%.").max(100, "0–100%."),
  reference: z.string().max(80).optional(),
  notes: z.string().max(2000).optional(),
});

/** Header fields only — items are fixed once an order exists (re-create a draft instead). */
export async function updateOrder(_prev: FormState, fd: FormData): Promise<FormState> {
  const user = await verifyUser();
  const parsed = Details.safeParse(formObject(fd));
  if (!parsed.success) return fieldErrors(parsed.error);
  const { id, ...v } = parsed.data;
  const o = await loadOrder(user, id);
  if (!o?.editable) return { ok: false, error: "Only the order owner or a manager can edit it." };
  await getDb().update(schema.orders).set({ ...v, reference: v.reference ?? null, notes: v.notes ?? null }).where(eq(schema.orders.id, id));
  await audit({ actorId: user.id, action: "update", entity: "order", entityId: o.order.orderNo, changes: { depositPct: [o.order.depositPct, v.depositPct] } });
  refresh();
  return { ok: true, message: "Order saved." };
}

const Status = z.object({ id: z.uuid(), status: z.enum(ORDER_FLOW) });

export async function setOrderStatus(_prev: FormState, fd: FormData): Promise<FormState> {
  const user = await verifyUser();
  const parsed = Status.safeParse(formObject(fd));
  if (!parsed.success) return { ok: false, error: "Invalid status." };
  const { id, status } = parsed.data;
  const o = await loadOrder(user, id);
  if (!o?.editable) return { ok: false, error: "Only the order owner or a manager can change it." };
  const from = o.order.status;
  if (from === status) return { ok: true };
  if (from === "cancelled" || from === "completed") {
    if (!isManager(user)) return { ok: false, error: `This order is ${from}. Ask a sales manager to reopen it.` };
  }
  if (status === "cancelled" && o.order.paidAmount > 0) {
    return { ok: false, error: "Payments are recorded on this order. Remove or refund them before cancelling." };
  }
  if (status === "completed" && (o.order.paymentStatus !== "paid" || o.order.deliveryStatus !== "delivered")) {
    return { ok: false, error: "Complete an order once it is delivered and fully paid." };
  }
  await getDb().update(schema.orders).set({ status }).where(eq(schema.orders.id, id));
  await audit({ actorId: user.id, action: "update", entity: "order", entityId: o.order.orderNo, changes: { status: [from, status] } });
  refresh();
  return { ok: true, message: "Status updated." };
}

const Delivery = z.object({ id: z.uuid(), deliveryStatus: z.enum(["pending", "shipped", "delivered"]) });

export async function setDeliveryStatus(_prev: FormState, fd: FormData): Promise<FormState> {
  const user = await verifyUser();
  const parsed = Delivery.safeParse(formObject(fd));
  if (!parsed.success) return { ok: false, error: "Invalid status." };
  const { id, deliveryStatus } = parsed.data;
  const o = await loadOrder(user, id);
  if (!o?.editable) return { ok: false, error: "Only the order owner or a manager can change it." };
  if (o.order.status === "cancelled" || o.order.status === "draft") return { ok: false, error: "Confirm the order before shipping it." };
  const nowTs = new Date();
  await getDb()
    .update(schema.orders)
    .set({
      deliveryStatus,
      shippedAt: deliveryStatus === "pending" ? null : (o.order.shippedAt ?? nowTs),
      deliveredAt: deliveryStatus === "delivered" ? (o.order.deliveredAt ?? nowTs) : null,
      // Shipping starts processing.
      ...(o.order.status === "confirmed" && deliveryStatus !== "pending" ? { status: "processing" as const } : {}),
    })
    .where(eq(schema.orders.id, id));
  await audit({ actorId: user.id, action: "update", entity: "order", entityId: o.order.orderNo, changes: { delivery: [o.order.deliveryStatus, deliveryStatus] } });
  refresh();
  return { ok: true, message: "Delivery updated." };
}

export async function deleteOrder(_prev: FormState, fd: FormData): Promise<FormState> {
  const user = await verifyUser();
  const id = z.uuid().safeParse(fd.get("id"));
  if (!id.success) return { ok: false, error: "Invalid order." };
  const o = await loadOrder(user, id.data);
  if (!o?.editable) return { ok: false, error: "Only the order owner or a manager can delete it." };
  if (o.order.status !== "draft" || o.order.paidAmount > 0) return { ok: false, error: "Only unpaid drafts can be deleted. Cancel the order instead." };
  await getDb().delete(schema.orders).where(eq(schema.orders.id, id.data));
  await audit({ actorId: user.id, action: "delete", entity: "order", entityId: o.order.orderNo });
  refresh();
  redirect("/sales/orders");
}

const Payment = z.object({
  orderId: z.uuid(),
  kind: z.enum(["deposit", "settlement", "other"]),
  amount: z.string("Enter the amount."),
  paidOn: z.iso.date("Pick a date."),
  method: z.enum(PAYMENT_METHODS).default("Transfer"),
  reference: z.string().max(80).optional(),
  note: z.string().max(500).optional(),
});

/** Deposit / settlement. Order owner, finance and managers can record. */
export async function recordPayment(_prev: FormState, fd: FormData): Promise<FormState> {
  const user = await verifyUser();
  const parsed = Payment.safeParse(formObject(fd));
  if (!parsed.success) return fieldErrors(parsed.error);
  const d = parsed.data;
  const o = await loadOrder(user, d.orderId);
  if (!o) return { ok: false, error: "Order not found." };
  if (!o.editable && !canRecordPayments(user)) return { ok: false, error: "Only the order owner, finance or a manager can record payments." };
  if (o.order.status === "cancelled" || o.order.status === "draft") return { ok: false, error: "Confirm the order before recording payments." };
  const amount = parseRupiah(d.amount);
  if (!amount) return { ok: false, error: "Please check the highlighted fields.", fieldErrors: { amount: "Enter the amount." } };
  const outstanding = o.order.total - o.order.paidAmount;
  if (amount > outstanding) return { ok: false, error: "Please check the highlighted fields.", fieldErrors: { amount: `Outstanding is only ${rp(outstanding)}.` } };
  if (d.paidOn > ymd(new Date())) return { ok: false, error: "Please check the highlighted fields.", fieldErrors: { paidOn: "Can't be in the future." } };

  const result = await getDb().transaction(async (tx) => {
    await tx.insert(schema.orderPayments).values({ orderId: d.orderId, kind: d.kind, amount, paidOn: d.paidOn, method: d.method, reference: d.reference ?? null, note: d.note ?? null, recordedBy: user.id });
    return recalcPayments(tx, d.orderId);
  });
  await audit({ actorId: user.id, action: "record_payment", entity: "order", entityId: o.order.orderNo, changes: { kind: d.kind, amount, paymentStatus: result.status } });
  if (o.order.salesId && o.order.salesId !== user.id) {
    await notify({
      userIds: [o.order.salesId],
      type: "order.payment",
      title: `${o.order.orderNo}: ${d.kind} ${rp(amount)} received`,
      body: `${o.account} · ${result.status === "paid" ? "fully paid" : `${rp(o.order.total - result.paid)} outstanding`}`,
      link: `/sales/orders/${d.orderId}`,
    });
  }
  refresh();
  return { ok: true, message: result.status === "paid" ? "Payment recorded — order fully paid." : "Payment recorded." };
}

/** Correcting a mistake: finance and managers only. */
export async function deletePayment(_prev: FormState, fd: FormData): Promise<FormState> {
  const user = await verifyUser();
  if (!canRecordPayments(user)) return { ok: false, error: "Only finance or a manager can remove payments." };
  const id = z.uuid().safeParse(fd.get("id"));
  if (!id.success) return { ok: false, error: "Invalid payment." };
  const db = getDb();
  const [p] = await db
    .select({ id: schema.orderPayments.id, orderId: schema.orderPayments.orderId, amount: schema.orderPayments.amount, kind: schema.orderPayments.kind, orderNo: schema.orders.orderNo })
    .from(schema.orderPayments)
    .innerJoin(schema.orders, eq(schema.orders.id, schema.orderPayments.orderId))
    .where(eq(schema.orderPayments.id, id.data));
  if (!p) return { ok: false, error: "Payment not found." };
  const result = await db.transaction(async (tx) => {
    await tx.delete(schema.orderPayments).where(eq(schema.orderPayments.id, p.id));
    return recalcPayments(tx, p.orderId);
  });
  await audit({ actorId: user.id, action: "delete_payment", entity: "order", entityId: p.orderNo, changes: { kind: p.kind, amount: p.amount, paymentStatus: result.status } });
  refresh();
  return { ok: true, message: "Payment removed." };
}

