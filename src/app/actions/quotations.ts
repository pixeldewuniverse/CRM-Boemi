"use server";

import { and, eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { audit } from "@/lib/audit";
import { verifyUser, type CurrentUser } from "@/lib/auth";
import { fieldErrors, formObject, type FormState } from "@/lib/forms";
import { rp, ymd } from "@/lib/format";
import { STAGE } from "@/lib/labels";
import { parseLines, priceLines } from "@/lib/lines";
import { notify } from "@/lib/notifications";
import { managersOf } from "@/lib/notifications/recipients";
import { cancelApprovals, decide, pendingRequestFor, submitForApproval } from "@/lib/approvals";
import { nextDocumentNumber } from "@/lib/numbering";
import { canSell, discountLimitFor, isManager } from "@/lib/permissions";
import { loadAccount, loadQuotation } from "@/lib/records";
import { getSetting } from "@/lib/settings";

const Quote = z.object({
  customerId: z.uuid("Choose an account."),
  opportunityId: z.uuid().optional(),
  issuedOn: z.iso.date("Pick a date.").optional(),
  validUntil: z.iso.date("Pick a date.").optional(),
  discountPct: z.coerce.number("Enter a percentage.").min(0, "0–100%.").max(100, "0–100%.").default(0),
  ppn: z.literal("on").optional(),
  notes: z.string().max(2000).optional(),
  terms: z.string().max(3000).optional(),
  items: z.string().optional(),
});

const addDays = (date: string, days: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/** Validates the form and prices it on the server. */
async function prepare(user: CurrentUser, fd: FormData, keepProducts: Set<string> = new Set()) {
  const parsed = Quote.safeParse(formObject(fd));
  if (!parsed.success) return { error: fieldErrors(parsed.error) } as const;
  const d = parsed.data;
  const account = await loadAccount(user, d.customerId);
  if (!account) return { error: { ok: false, error: "Account not found.", fieldErrors: { customerId: "Choose one of your accounts." } } } as const;
  if (!account.editable) return { error: { ok: false, error: "Only the account owner or a manager can quote this account." } } as const;
  if (d.opportunityId) {
    const [deal] = await getDb()
      .select({ id: schema.opportunities.id })
      .from(schema.opportunities)
      .where(and(eq(schema.opportunities.id, d.opportunityId), eq(schema.opportunities.customerId, account.id)));
    if (!deal) return { error: { ok: false, error: "That deal belongs to another account.", fieldErrors: { opportunityId: "Choose a deal of this account." } } } as const;
  }
  const lines = parseLines(d.items);
  if (!lines.ok) return { error: { ok: false, error: lines.error, fieldErrors: { items: lines.error } } } as const;
  const priced = await priceLines(lines.lines, account.segment, d.discountPct, Boolean(d.ppn), keepProducts);
  if (!priced.ok) return { error: { ok: false, error: priced.error, fieldErrors: { items: priced.error } } } as const;

  const settings = await getSetting("quotation");
  const issuedOn = d.issuedOn ?? ymd(new Date());
  const validUntil = d.validUntil ?? addDays(issuedOn, settings.validDays);
  if (validUntil < issuedOn) return { error: { ok: false, error: "Please check the highlighted fields.", fieldErrors: { validUntil: "Must be on or after the issue date." } } } as const;
  const limit = discountLimitFor(user, settings.salesDiscountLimit);
  return { d, account, priced, settings, issuedOn, validUntil, needsApproval: d.discountPct > limit, limit } as const;
}

/** Discount above the role's limit → approval engine (Settings → Approval Workflows). */
async function askApproval(quoteNo: string, ownerId: string, id: string, account: string, discount: number) {
  const res = await submitForApproval({
    entityType: "quotation_discount",
    entityId: id,
    amount: Math.ceil(discount),
    title: `${quoteNo} · ${discount}% discount · ${account}`,
    link: `/sales/quotations/${id}`,
    requesterId: ownerId,
  });
  // No active flow for this discount → nothing to approve.
  if (res.status === "approved") {
    await getDb().update(schema.quotations).set({ approval: "not_required" }).where(eq(schema.quotations.id, id));
  }
}

export async function createQuotation(_prev: FormState, fd: FormData): Promise<FormState> {
  const user = await verifyUser();
  if (!canSell(user)) return { ok: false, error: "Your role can't create quotations." };
  const p = await prepare(user, fd);
  if ("error" in p) return p.error as FormState;
  const { d, account, priced } = p;
  const ownerId = isManager(user) ? (account.ownerId ?? user.id) : user.id;

  const created = await getDb().transaction(async (tx) => {
    const quoteNo = await nextDocumentNumber(tx, "quotation");
    const [q] = await tx
      .insert(schema.quotations)
      .values({
        quoteNo,
        customerId: account.id,
        opportunityId: d.opportunityId ?? null,
        ownerId,
        status: "draft",
        issuedOn: p.issuedOn,
        validUntil: p.validUntil,
        priceTier: priced.tier,
        subtotal: priced.subtotal,
        discountPct: d.discountPct,
        ppn: Boolean(d.ppn),
        taxAmount: priced.taxAmount,
        total: priced.total,
        notes: d.notes ?? null,
        terms: d.terms ?? p.settings.terms,
        approval: p.needsApproval ? "pending" : "not_required",
      })
      .returning({ id: schema.quotations.id, quoteNo: schema.quotations.quoteNo });
    await tx.insert(schema.quotationItems).values(priced.lines.map((l) => ({ ...l, quotationId: q.id })));
    return q;
  });
  await audit({
    actorId: user.id,
    action: "create",
    entity: "quotation",
    entityId: created.quoteNo,
    changes: { account: account.name, total: priced.total, discountPct: d.discountPct },
  });
  if (p.needsApproval) await askApproval(created.quoteNo, ownerId, created.id, account.name, d.discountPct);
  refresh();
  redirect(`/sales/quotations/${created.id}`);
}

export async function updateQuotation(_prev: FormState, fd: FormData): Promise<FormState> {
  const user = await verifyUser();
  const id = z.uuid().safeParse(fd.get("id"));
  if (!id.success) return { ok: false, error: "Invalid quotation." };
  const current = await loadQuotation(user, id.data);
  if (!current?.editable) return { ok: false, error: "Only the owner or a manager can edit this quotation." };
  if (current.quote.status !== "draft") return { ok: false, error: "Only draft quotations can be edited." };
  fd.set("customerId", current.quote.customerId); // the account can't change
  const db = getDb();
  const existing = await db.select({ productId: schema.quotationItems.productId }).from(schema.quotationItems).where(eq(schema.quotationItems.quotationId, id.data));
  const p = await prepare(user, fd, new Set(existing.map((e) => e.productId).filter((x): x is string => Boolean(x))));
  if ("error" in p) return p.error as FormState;
  const { d, priced } = p;
  // An approved discount stays approved while it isn't raised.
  const keepApproved = current.quote.approval === "approved" && d.discountPct <= current.quote.discountPct;
  const approval = !p.needsApproval ? "not_required" : keepApproved ? "approved" : "pending";

  await db.transaction(async (tx) => {
    await tx
      .update(schema.quotations)
      .set({
        opportunityId: d.opportunityId ?? null,
        issuedOn: p.issuedOn,
        validUntil: p.validUntil,
        priceTier: priced.tier,
        subtotal: priced.subtotal,
        discountPct: d.discountPct,
        ppn: Boolean(d.ppn),
        taxAmount: priced.taxAmount,
        total: priced.total,
        notes: d.notes ?? null,
        terms: d.terms ?? null,
        approval,
        ...(approval === "approved" ? {} : { approvedBy: null, approvedAt: null, approvalNote: null }),
      })
      .where(eq(schema.quotations.id, id.data));
    await tx.delete(schema.quotationItems).where(eq(schema.quotationItems.quotationId, id.data));
    await tx.insert(schema.quotationItems).values(priced.lines.map((l) => ({ ...l, quotationId: id.data })));
  });
  await audit({
    actorId: user.id,
    action: "update",
    entity: "quotation",
    entityId: current.quote.quoteNo,
    changes: { total: [current.quote.total, priced.total], discountPct: [current.quote.discountPct, d.discountPct] },
  });
  if (approval === "pending") {
    // (Re)submit: the discount may have changed since the last request.
    await askApproval(current.quote.quoteNo, current.quote.ownerId ?? user.id, id.data, current.account, d.discountPct);
  } else if (current.quote.approval === "pending") {
    await cancelApprovals("quotation_discount", id.data);
  }
  refresh();
  return { ok: true, message: "Quotation saved." };
}

export async function deleteQuotation(_prev: FormState, fd: FormData): Promise<FormState> {
  const user = await verifyUser();
  const id = z.uuid().safeParse(fd.get("id"));
  if (!id.success) return { ok: false, error: "Invalid quotation." };
  const q = await loadQuotation(user, id.data);
  if (!q?.editable) return { ok: false, error: "Only the owner or a manager can delete this quotation." };
  if (q.quote.status !== "draft") return { ok: false, error: "Only drafts can be deleted. Mark it rejected instead." };
  await cancelApprovals("quotation_discount", id.data);
  await getDb().delete(schema.quotations).where(eq(schema.quotations.id, id.data));
  await audit({ actorId: user.id, action: "delete", entity: "quotation", entityId: q.quote.quoteNo });
  refresh();
  redirect("/sales/quotations");
}

const Status = z.object({ id: z.uuid(), status: z.enum(["sent", "accepted", "rejected"]), note: z.string().max(500).optional() });

/** draft → sent → accepted / rejected. (expired is set by the daily job.) */
export async function setQuotationStatus(_prev: FormState, fd: FormData): Promise<FormState> {
  const user = await verifyUser();
  const parsed = Status.safeParse(formObject(fd));
  if (!parsed.success) return { ok: false, error: "Invalid request." };
  const { id, status, note } = parsed.data;
  const q = await loadQuotation(user, id);
  if (!q?.editable) return { ok: false, error: "Only the owner or a manager can change this quotation." };
  const from = q.quote.status;
  if (status === "sent") {
    if (from !== "draft") return { ok: false, error: "Only drafts can be sent." };
    if (q.quote.approval === "pending") return { ok: false, error: "Waiting for a manager to approve the discount." };
    if (q.quote.approval === "rejected") return { ok: false, error: "The discount was rejected. Lower it and save again." };
  } else if (from !== "sent") {
    return { ok: false, error: "Only sent quotations can be accepted or rejected." };
  }
  const nowTs = new Date();
  await getDb()
    .update(schema.quotations)
    .set(status === "sent" ? { status, sentAt: nowTs } : { status, decidedAt: nowTs, notes: note ? [q.quote.notes, `Customer: ${note}`].filter(Boolean).join("\n") : q.quote.notes })
    .where(eq(schema.quotations.id, id));
  await audit({ actorId: user.id, action: status === "sent" ? "send" : status, entity: "quotation", entityId: q.quote.quoteNo, changes: { status: [from, status] } });
  if (status === "sent" && q.quote.opportunityId) {
    // Sending a quote moves an early-stage deal to "Quotation".
    const [deal] = await getDb().select({ stage: schema.opportunities.stage }).from(schema.opportunities).where(eq(schema.opportunities.id, q.quote.opportunityId));
    if (deal && ["new", "contacted", "sampling"].includes(deal.stage)) {
      await getDb()
        .update(schema.opportunities)
        .set({ stage: "quotation", probability: STAGE.quotation.probability })
        .where(eq(schema.opportunities.id, q.quote.opportunityId));
    }
  }
  if (status === "accepted") {
    await notify({
      userIds: await managersOf(q.quote.ownerId, [user.id]),
      type: "quote.accepted",
      title: `${q.quote.quoteNo} accepted by ${q.account}`,
      body: rp(q.quote.total),
      link: `/sales/quotations/${id}`,
    });
  }
  refresh();
  return { ok: true, message: status === "sent" ? "Marked as sent." : `Marked as ${status}.` };
}

const Review = z.object({ id: z.uuid(), decision: z.enum(["approved", "rejected"]), note: z.string().max(500).optional() });

/** Approver decides on a discount above the sales limit (current step of its approval request). */
export async function reviewDiscount(_prev: FormState, fd: FormData): Promise<FormState> {
  const user = await verifyUser();
  const parsed = Review.safeParse(formObject(fd));
  if (!parsed.success) return { ok: false, error: "Invalid request." };
  const { id, decision, note } = parsed.data;
  if (decision === "rejected" && !note) return { ok: false, error: "Please check the highlighted fields.", fieldErrors: { note: "Tell the rep why." } };
  const pending = await pendingRequestFor("quotation_discount", id);
  if (!pending) return { ok: false, error: "This discount is not waiting for approval." };
  const res = await decide(user, pending.req.id, decision, note);
  if (!res.ok) return { ok: false, error: res.error };
  refresh();
  if (res.final === null) return { ok: true, message: "Approved — sent to the next approver." };
  return { ok: true, message: decision === "approved" ? "Discount approved." : "Discount rejected." };
}

/** Accepted quotation → confirmed order with the quoted prices. Marks the deal won. */
export async function convertQuotationToOrder(_prev: FormState, fd: FormData): Promise<FormState> {
  const user = await verifyUser();
  const id = z.uuid().safeParse(fd.get("id"));
  if (!id.success) return { ok: false, error: "Invalid quotation." };
  const q = await loadQuotation(user, id.data);
  if (!q?.editable) return { ok: false, error: "Only the owner or a manager can convert this quotation." };
  if (q.quote.status !== "accepted") return { ok: false, error: "Only accepted quotations can become orders." };
  const db = getDb();
  const [already] = await db.select({ id: schema.orders.id }).from(schema.orders).where(eq(schema.orders.quotationId, id.data));
  if (already) redirect(`/sales/orders/${already.id}`);

  const items = await db.select().from(schema.quotationItems).where(eq(schema.quotationItems.quotationId, id.data));
  const orderSettings = await getSetting("order");
  const order = await db.transaction(async (tx) => {
    const orderNo = await nextDocumentNumber(tx, "order");
    const [o] = await tx
      .insert(schema.orders)
      .values({
        orderNo,
        customerId: q.quote.customerId,
        opportunityId: q.quote.opportunityId,
        salesId: q.quote.ownerId ?? user.id,
        quotationId: q.quote.id,
        status: "confirmed",
        subtotal: q.quote.subtotal,
        discountPct: q.quote.discountPct,
        ppn: q.quote.ppn,
        taxAmount: q.quote.taxAmount,
        total: q.quote.total,
        depositPct: orderSettings.defaultDepositPct,
        channel: q.segment,
        reference: q.quote.quoteNo,
      })
      .returning({ id: schema.orders.id, orderNo: schema.orders.orderNo });
    if (items.length) {
      await tx.insert(schema.orderItems).values(items.map((i) => ({ orderId: o.id, productId: i.productId, quantity: i.quantity, unitPrice: i.unitPrice, subtotal: i.subtotal })));
    }
    await tx.update(schema.customers).set({ status: "active" }).where(and(eq(schema.customers.id, q.quote.customerId), eq(schema.customers.status, "prospect")));
    return o;
  });
  await audit({ actorId: user.id, action: "convert", entity: "quotation", entityId: q.quote.quoteNo, changes: { order: order.orderNo, total: q.quote.total } });

  if (q.quote.opportunityId) {
    const [deal] = await db
      .select({ stage: schema.opportunities.stage, title: schema.opportunities.title, ownerId: schema.opportunities.ownerId })
      .from(schema.opportunities)
      .where(eq(schema.opportunities.id, q.quote.opportunityId));
    if (deal && deal.stage !== "won") {
      await db
        .update(schema.opportunities)
        .set({ stage: "won", probability: 100, value: q.quote.total, lostReason: null })
        .where(eq(schema.opportunities.id, q.quote.opportunityId));
      await audit({ actorId: user.id, action: "update", entity: "opportunity", entityId: deal.title, changes: { stage: [deal.stage, "won"], via: order.orderNo } });
      await notify({
        userIds: await managersOf(deal.ownerId, [user.id]),
        type: "deal.won",
        title: `Deal won: ${deal.title}`,
        body: `${q.account} · ${rp(q.quote.total)} · order ${order.orderNo}`,
        link: `/sales/orders/${order.id}`,
      });
    }
  }
  refresh();
  redirect(`/sales/orders/${order.id}`);
}
