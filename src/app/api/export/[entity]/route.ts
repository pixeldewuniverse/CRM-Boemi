import { asc, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { audit } from "@/lib/audit";
import { verifyUser } from "@/lib/auth";
import { toCsv } from "@/lib/csv";
import { customerScope } from "@/lib/customers";
import { ymd } from "@/lib/format";
import { ownedBy } from "@/lib/scope";

const EXPORTABLE = ["leads", "accounts", "contacts", "products", "orders"] as const;
type Entity = (typeof EXPORTABLE)[number];

/** CSV download of one entity, limited to what the signed-in user can see. */
export async function GET(_req: Request, ctx: RouteContext<"/api/export/[entity]">) {
  const user = await verifyUser();
  const { entity } = await ctx.params;
  if (!EXPORTABLE.includes(entity as Entity)) return Response.json({ error: "Unknown entity" }, { status: 404 });

  const db = getDb();
  let headers: string[] = [];
  let rows: unknown[][] = [];

  switch (entity as Entity) {
    case "leads": {
      const l = schema.leads;
      const data = await db
        .select({ l, owner: schema.users.name })
        .from(l)
        .leftJoin(schema.users, eq(schema.users.id, l.ownerId))
        .where(ownedBy(user, l.ownerId))
        .orderBy(desc(l.receivedOn));
      headers = ["Company", "PIC", "Phone", "Email", "Segment", "City", "Source", "Status", "Score", "Tier", "Owner", "Received", "Note"];
      rows = data.map(({ l: r, owner }) => [r.company, r.picName, r.phoneE164, r.email, r.segment, r.city, r.source, r.status, r.qualificationScore, r.qualificationTier, owner, r.receivedOn, r.note]);
      break;
    }
    case "accounts": {
      const c = schema.customers;
      const data = await db
        .select({ c, owner: schema.users.name })
        .from(c)
        .leftJoin(schema.users, eq(schema.users.id, c.ownerId))
        .where(customerScope(user))
        .orderBy(asc(c.name));
      headers = ["Name", "Segment", "Status", "City", "Phone", "Email", "Source", "Score", "Tier", "Marketing consent", "Owner", "Created"];
      rows = data.map(({ c: r, owner }) => [r.name, r.businessType, r.status, r.city, r.phoneE164, r.email, r.source, r.qualificationScore, r.qualificationTier, r.marketingConsent ? "yes" : "no", owner, r.createdAt]);
      break;
    }
    case "contacts": {
      const p = schema.contacts;
      const data = await db
        .select({ p, account: schema.customers.name })
        .from(p)
        .innerJoin(schema.customers, eq(schema.customers.id, p.customerId))
        .where(customerScope(user))
        .orderBy(asc(schema.customers.name));
      headers = ["Account", "Name", "Position", "Phone", "Email", "Decision maker"];
      rows = data.map(({ p: r, account }) => [account, r.name, r.position, r.phoneE164, r.email, r.isDecisionMaker ? "yes" : "no"]);
      break;
    }
    case "products": {
      const data = await db.select().from(schema.products).orderBy(asc(schema.products.sku));
      headers = ["SKU", "Name", "Size", "Category", "Retail price", "Stock", "Active"];
      rows = data.map((r) => [r.sku, r.name, r.variant, r.category, r.price, r.stock, r.active ? "yes" : "no"]);
      break;
    }
    case "orders": {
      const o = schema.orders;
      const data = await db
        .select({ o, account: schema.customers.name, sales: schema.users.name })
        .from(o)
        .innerJoin(schema.customers, eq(schema.customers.id, o.customerId))
        .leftJoin(schema.users, eq(schema.users.id, o.salesId))
        .where(ownedBy(user, o.salesId))
        .orderBy(desc(o.orderedAt));
      headers = ["Order no", "Date", "Account", "Sales", "Status", "Subtotal", "Discount %", "PPN", "Total", "Payment", "Paid", "Reference"];
      rows = data.map(({ o: r, account, sales }) => [r.orderNo, r.orderedAt, account, sales, r.status, r.subtotal, r.discountPct, r.taxAmount, r.total, r.paymentStatus, r.paidAmount, r.reference]);
      break;
    }
  }

  await audit({ actorId: user.id, action: "export", entity, changes: { rows: rows.length } });
  return new Response("﻿" + toCsv(headers, rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${entity}-${ymd(new Date())}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
